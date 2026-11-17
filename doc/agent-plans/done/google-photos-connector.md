# Google Photos connector

**Ticket/Source:** none (idea of the developer, 2026-11-17: "new connector for Google Photos")
**Branch:** none — work directly on `main` (decision of the developer)
**Status:** done

## Goal

New connector type `googlephotos`: the user imports photos from the own Google Photos library into a collage,
like with the Immich and Synology connectors. Because Google removed library read access for third-party
apps (2025-03-31), the photos are selected in Google's own picker page (Google Photos **Picker API**), not
browsed inside Collage-o-mat. After the selection, the Collage-o-mat import dialog shows the picked photos
in the usual grid; the user imports them in preview or original size.

Each connector has its **own Google OAuth client** (client ID + secret) that the user creates in an own
Google Cloud project. The README documents the Google Cloud setup.

## Scope

**In scope:**
- README section "Connect Google Photos": Google Cloud setup and connector fields.
- New connector type `googlephotos` (create, edit, test) with config client ID, client secret, redirect URI.
- OAuth 2.0 sign-in per import (no stored token), access token cached in server memory for 30 min.
- Picker flow in a popup window, picked photos shown in the import dialog grid (thumbnails proxied by the
  backend), "Pick more photos" (append), import in preview (`=w2048-h2048`) or original (`=d`) size.
- Videos are dropped from the picked items; the dialog shows how many were skipped.

**Out of scope:**
- Stored refresh tokens / "stay connected" (rejected, see decision log).
- Browsing albums or the library inside Collage-o-mat (not possible with the Picker API).
- Videos (import of a video frame).
- A server-wide OAuth client (env vars or admin settings) — rejected, see decision log.
- `login_hint` / Google account field in the connector form.
- Keeping a selection when the import dialog is closed and opened again.
- Google Library API, uploads/writes to Google Photos.

## Rough Architecture / Concept

- **Backend package** `backend/internal/connector/googlephotos/`, built like `connector/immich` and
  `connector/synology`: `kind.go` (`connector.Kind`), `client.go` (Picker REST calls with `net/http`),
  OAuth with `golang.org/x/oauth2` (+ `golang.org/x/oauth2/google` endpoint), in-memory state (token cache,
  pending OAuth states, picks), `service.go` (pick flow, thumbnail proxy, `photo.Sources`), `handler.go`.
  Registered in `backend/cmd/collageomat/main.go` and in the `photo.SourcesByType` map.
- **Flow of one import:**
  1. Dialog button "Open Google Photos" opens an empty popup **synchronously** (popup blocker), then calls
     `POST /api/connectors/{id}/googlephotos/picks` → `{pickId, openUrl}` and sets the popup location.
  2. No cached token → `openUrl` = Google OAuth URL (`state` = random, bound to user + connector + pick).
     Google redirects the popup to `GET /api/googlephotos/oauth/callback?code&state` → server exchanges the
     code, caches the access token for the connector, creates a picker session, 302 to
     `<pickerUri>/autoclose`. Cached token → server creates the picker session at once and `openUrl` =
     `<pickerUri>/autoclose`.
  3. The user picks photos in Google's page and clicks "Done"; the popup closes itself (`/autoclose`).
  4. The dialog polls `GET /api/connectors/{id}/googlephotos/picks/{pickId}`; the server calls Google
     `sessions.get` until `mediaItemsSet=true`, then lists all items (`mediaItems.list`), drops videos and
     keeps the items (with `baseUrl`) in memory.
  5. The dialog shows the photos in `AssetGrid`, user imports via the existing
     `POST /api/collages/{id}/import`; the `googlephotos` Source finds the item (`baseUrl`) in the in-memory
     picks of user + connector and downloads it with the cached access token.
  6. Closing the dialog → `DELETE .../picks/{pickId}` (Google `sessions.delete` + memory removed).
- **Why:** per-import OAuth avoids refresh-token storage, refresh/revocation logic and the 7-day refresh
  token expiry of Google apps in "Testing" status (most self-made apps stay in Testing). A 30-min token cache
  allows several imports without a new sign-in. Per-connector OAuth client: no env var / server restart; in
  Testing status each user adds only the own Google account as test user. The redirect URI comes from the
  browser and is stored in the config: no env var and no trust in `Host`/`X-Forwarded-*` headers.

## Context for a new agent

### Sources read (summarized)

**Google Photos Picker API** (official docs, read 2026-11-17):
- Since 2025-03-31 the Library API gives access only to media the app created. To read existing photos,
  use the **Picker API**. Scope: `https://www.googleapis.com/auth/photospicker.mediaitems.readonly`
  (create/get/delete sessions, list picked items). Service accounts are not supported (user OAuth only).
- `POST https://photospicker.googleapis.com/v1/sessions` (body: `PickingSession`, only `pickingConfig`
  settable; `pickingConfig.maxItemCount` default/max 2000). Response `PickingSession`: `id`, `pickerUri`,
  `pollingConfig{pollInterval, timeoutIn}` (durations like `"3.5s"`, only while `mediaItemsSet=false`),
  `expireTime`, `mediaItemsSet`. Errors: `FAILED_PRECONDITION` (user has no Google Photos account),
  `RESOURCE_EXHAUSTED` (too many sessions → always `sessions.delete` after use).
- `GET https://photospicker.googleapis.com/v1/sessions/{id}` = poll. **Note:** the sessions guide shows
  host `photoslibrary.googleapis.com` in its polling example; the create/list endpoints use
  `photospicker.googleapis.com`. Verify the host live in step 3.
- `DELETE https://photospicker.googleapis.com/v1/sessions/{id}`.
- `pickerUri`: open in a new tab/window, **never in an iframe**. Append `/autoclose` for web apps → the
  window closes after "Done". After "Done" the `pickerUri` does not work any more (new session for more
  picks). The user must be signed in to the same Google account in the browser.
- `GET https://photospicker.googleapis.com/v1/mediaItems?sessionId=..&pageSize=100&pageToken=..`
  (pageSize default 50, max 100). `FAILED_PRECONDITION` if the user has not finished picking. Response
  `mediaItems[]` (`PickedMediaItem`), `nextPageToken`. `PickedMediaItem`: `id` (persistent), `createTime`,
  `type` (`PHOTO`, `VIDEO`, `TYPE_UNSPECIFIED`), `mediaFile{baseUrl, mimeType, filename,
  mediaFileMetadata{width, height, cameraMake, cameraModel, photoMetadata|videoMetadata}}`.
- `baseUrl`: valid **60 min**, request needs `Authorization: Bearer <access token>`. Must be used with
  `=d` or with both `w` and `h`. `=w<N>-h<N>` = fit in box keeping aspect ratio (`-c` = crop),
  `=d` = original bytes with all EXIF except location. Not documented: whether HEIC originals stay HEIC.
- Picker UI shows recent photos; albums are found via search by album title.

**Google OAuth 2.0 for web server apps:** auth endpoint `https://accounts.google.com/o/oauth2/v2/auth`,
token endpoint `https://oauth2.googleapis.com/token` (both in `golang.org/x/oauth2/google.Endpoint`).
Params `client_id`, `redirect_uri` (exact match with a registered URI), `response_type=code`, `scope`,
`state` (CSRF), `prompt` (not sent, see decision log). Redirect URI rules: HTTPS required except
`localhost`, no raw IPs except localhost, no wildcards/fragments. Token errors (RFC 6749 §5.2):
`invalid_grant` (bad code), `invalid_client`, `unauthorized_client`, `redirect_uri_mismatch`.

**Google Cloud "Testing" status:** max 100 test users; refresh tokens and consent of test users expire 7
days after consent. Not a problem here (no refresh token; at worst the consent screen appears again).

### Key files and directories
- `backend/internal/connector/kind.go` — `connector.Kind` (`Type`, `BuildConfig(input, stored)`,
  `PublicConfig(stored)`, `Test(ctx, stored)`), `TestResult{OK, ServerVersion, Error}`, `Registry`.
- `backend/internal/connector/service.go` — `connector.Service`, `LoadConfig(ctx, userID, id)`.
- `backend/internal/connector/synology/kind.go` — pattern for `Config`/`publicConfig`/`decodeInput`
  (`DisallowUnknownFields`), "empty secret keeps stored one", `ParseConfig`.
- `backend/internal/connector/synology/session.go` — pattern for an in-memory cache per connector id that
  is replaced when the stored config changes (`sessionCache.forConnector`).
- `backend/internal/connector/immich/{client,service,handler}.go` — HTTP client pattern, `upstream(err)` →
  `apperr.Upstream`, thumbnail proxy headers (`Cache-Control: private, max-age=86400`,
  `X-Content-Type-Options: nosniff`), `Source` → `photo.Source`.
- `backend/internal/photo/service.go` — `photo.Sources`, `photo.Source.Image(ctx, assetID, size)`,
  `SourceImage{Body, ContentType, Fallback}`, `SizePreview`/`SizeOriginal`.
- `backend/internal/photo/sources.go` — `SourcesByType` (map connector type → `Sources`).
- `backend/internal/httpapi/` — router, `Module`, `PathID`, `WriteJSON`, `WriteServiceError`,
  `RequireJSON` (mutating requests need `Content-Type: application/json`).
- `backend/cmd/collageomat/main.go` — composition root (`newConnectorService`, kinds, services, handlers,
  `photo.NewSourcesByType`).
- `frontend/src/app/features/connectors/` — `connector-types.ts`, `connector-dialog.ts`, config forms
  (`immich-config-form.ts`, `synology-config-form.ts`).
- `frontend/src/app/core/models/connector.ts` — `ConnectorType`, public config / config input unions.
- `frontend/src/app/core/models/source.ts` — neutral `SourceAlbum`, `SourceAsset`, `SourceAssetPage`.
- `frontend/src/app/features/editor/import/` — `synology-import-dialog.*` (pattern), `asset-grid.ts`
  (`AssetGrid<T extends SourceAsset>`, thumbnail URL as function input), `import-size.ts`,
  `original-size.ts`, `import-result-message.ts`.
- `frontend/src/app/features/editor/editor.page.{ts,html}` — import menu, `openImport(connector)` opens
  the dialog of the connector type.
- `README.md` — user docs per connector ("Connect an Immich server", "Connect a Synology Photos NAS").
- `doc/architecture.md` — architecture, data model, API table.

### Existing patterns to follow
- Synology connector for every part (backend package layout, config form, own import dialog with shared
  `AssetGrid`). `doc/architecture.md` for layering (handler → service → client, `apperr` errors,
  `httpapi` helpers; `HttpClient` only in `frontend/src/app/core/api/`).
- All UI texts English with i18n ids (`i18n="@@<feature>.<key>"`, `$localize`).

### Commands
```sh
make dev-up && make dev-shell                 # host: start + enter the dev container
make backend-run                              # container: Go server on :8080
make frontend-serve                           # container: ng serve on :4200 (proxy /api -> :8080)
cd backend && go get golang.org/x/oauth2      # container: add the dependency (step 2)
cd backend && go build ./... && go vet ./...  # backend verification
cd frontend && npx ng build                   # frontend verification
```

### Environment / prerequisites
- A Google Cloud project of the developer with the "Google Photos Picker API" enabled and a "Web
  application" OAuth client whose redirect URI is `http://localhost:4200/api/googlephotos/oauth/callback`
  (dev; `ng serve` proxies `/api` to `:8080`). Setup steps: README section "Connect Google Photos".
- Client ID/secret are entered in the connector form only; never written to repo files.

### Domain terms
- **Picker session:** a Google `PickingSession` (id, `pickerUri`); one selection round in Google's page.
- **Pick:** the Collage-o-mat in-memory record of one picker session (`pickId`, user, connector, Google
  session id, picked items). A dialog can have several picks ("Pick more photos").
- **Media item:** a picked Google photo (`PickedMediaItem`); its `id` is stored as
  `photos.source_asset_id`.
- **baseUrl:** short-lived (60 min) download URL of a media item, needs the access token.

### External references
- https://developers.google.com/photos/picker/guides/get-started-picker
- https://developers.google.com/photos/picker/guides/sessions
- https://developers.google.com/photos/picker/guides/media-items
- https://developers.google.com/photos/picker/reference/rest/v1/sessions
- https://developers.google.com/photos/picker/reference/rest/v1/mediaItems/list
- https://developers.google.com/photos/overview/authorization
- https://developers.google.com/photos/overview/configure-your-app
- https://developers.google.com/identity/protocols/oauth2/web-server
- https://support.google.com/cloud/answer/15549945 (Testing status: 7-day expiry, test users)

## Decision log

- **API:** Google Photos Picker API — *Rationale:* only API that can read existing photos since
  2025-03-31. Consequence: selection in Google's page, no album browsing in Collage-o-mat.
- **OAuth client location:** per connector (client ID + secret in the encrypted connector config) —
  *Rationale:* self-service per user, no env var/restart, in Testing status each user only adds the own
  account as test user. *Rejected:* env vars `COLLAGEOMAT_GOOGLE_CLIENT_ID/_SECRET` (one client for the
  server), admin settings in DB. Trade-off accepted: each user needs an own Google Cloud project.
- **Redirect URI:** the config form shows `window.location.origin + "/api/googlephotos/oauth/callback"`
  read-only with a copy button; the frontend sends it in the config, it is stored and used by the backend —
  *Rationale:* no env var, no trust in `Host`/`X-Forwarded-*`, works in dev (`:4200` proxy) and behind
  reverse proxies. *Rejected:* `COLLAGEOMAT_PUBLIC_URL` env var, derive from request headers. Backend
  validation: absolute URL, path exactly `/api/googlephotos/oauth/callback`, scheme `https`, or `http` only
  for host `localhost` / `127.0.0.1`.
- **Tokens:** OAuth sign-in per import, no stored token; the access token is cached **in server memory per
  connector for 30 min** (capped at token expiry − 1 min; dropped when the stored config changes; lost on
  restart) so several imports in a short time need no new sign-in — *Rationale:* no 7-day refresh token
  expiry problem (Testing status), no refresh/revocation code, no token in the DB. *Rejected:* stored
  refresh token with "reconnect" flow.
- **Import UX:** after "Done" the dialog shows the picked photos in `AssetGrid` (all pre-selected),
  preview/original toggle, Import button — *Rationale:* same look as Immich/Synology, user can deselect.
  *Rejected:* import all picked photos directly.
- **Selection lifetime:** "Pick more photos" starts a new picker session and **appends** to the grid
  (duplicates by media item id removed). Closing the dialog deletes all its picks (Google session + memory).
  Re-opening starts empty. *Rejected:* replace on "pick more"; keep the selection for re-opening.
- **Preview size:** `=w2048-h2048` (long edge 2048 px) — *Rationale:* close to Synology `xl` (short side
  1280) and Immich preview. **Original:** `=d`. If the item `mimeType` (or response Content-Type) is not
  `image/jpeg|png|webp`, the original request uses the preview (`SourceImage.Fallback = true`), like
  Synology. **Grid thumbnail:** `=w400-h400`.
- **Connection test:** exchange a dummy authorization code at the token endpoint with the stored client
  ID/secret/redirect URI: `invalid_grant` → OK; `invalid_client` / `unauthorized_client` → "Client ID or
  client secret is wrong"; `redirect_uri_mismatch` → "Redirect URI is not registered in Google Cloud";
  other → error with Google's code. The real answers must be verified live in step 2. *Rejected:* config
  check only; full sign-in test in the settings page.
- **Videos:** items with `type != PHOTO` are dropped when the items are listed; the pick status reports
  `skippedVideos`; the dialog shows a hint. *Rejected:* import a video frame.
- **Window:** popup window (`window.open('', name, 'popup,width=1000,height=800')`) opened synchronously on
  the button click, location set after the POST — *Rationale:* popup blockers; Google forbids iframes;
  editor stays visible. *Rejected:* new tab.
- **Google account choice:** no `prompt` and no `login_hint` parameter; Google shows its account chooser
  only when needed — *Rationale:* fewest clicks. *Rejected:* `prompt=select_account`, account hint field.
- **Library:** `golang.org/x/oauth2` (approved by the developer 2026-11-17). Picker REST calls stay plain
  `net/http`. *Rejected:* hand-written OAuth.
- **Connector type name:** `googlephotos`; routes `/api/connectors/{id}/googlephotos/...` and the callback
  `/api/googlephotos/oauth/callback` (connector-independent path, so one redirect URI per server origin).
- **Callback auth:** the callback route requires the session cookie (`SameSite=Lax` cookies are sent on the
  top-level GET navigation from Google) and the `state` must belong to the session user. Errors (unknown or
  expired `state`, `error=access_denied`, token or session failure) → small HTML page "Sign-in failed:
  <reason>. Close this window." The dialog sees the pick status `error`.
- **Branch:** none, work on `main`.

## Testing strategy

No automated tests (project rule in `AGENTS.md`). Each step: `go build ./... && go vet ./...` in
`backend/`, `npx ng build` in `frontend/`, then manual test steps by the developer with an own Google Cloud
project and Google account.

## Steps

### Step 1 — README: Google Cloud setup documentation
- **Status:** done (reviewed 2026-11-17)
- **What:** new section "Connect Google Photos" in `README.md` (after the Synology section) and the feature
  list entry: how the connector works (Picker page, popup, no album browsing, sign-in per import, 30-min
  cache), Google Cloud setup (project, enable "Google Photos Picker API", Google Auth Platform: Branding,
  Audience = External + Testing + own account as test user, Data access = Picker scope, Clients = Web
  application with redirect URI), the connector form fields, limits (videos skipped, max 2000 per pick,
  popups must be allowed, HTTPS required except localhost, Testing-status consent expires after 7 days).
- **Acceptance criteria:** the developer can create a working OAuth client by following the README only.
- **Notes:** `README.md` has the feature list entry and the section "Connect Google Photos" (user flow,
  sign-in per import + 30-min cache, subsection "Create a Google OAuth client" with 7 steps, notes on
  redirect URI, Testing status, popups, videos, 1-hour selection lifetime). The connector page is reached
  with the toolbar link "Connectors" (not "Settings"). The developer followed the README in the Google
  Cloud Console on 2026-11-17: all menu names and steps matched. The developer now has a project with the
  Picker API enabled, consent screen in Testing with the own account as test user, the scope
  `photospicker.mediaitems.readonly`, and a Web client with the redirect URI
  `http://localhost:4200/api/googlephotos/oauth/callback` (client ID/secret only with the developer).

### Step 2 — Backend Kind + config form + connection test
- **Status:** done (reviewed 2026-11-17)
- **What:** `go get golang.org/x/oauth2`; `backend/internal/connector/googlephotos/kind.go` (`Type =
  "googlephotos"`, `Config{ClientID, ClientSecret, RedirectURI}` JSON `clientId, clientSecret,
  redirectUri`; public `{clientId, clientSecretSet, redirectUri}`; client ID required; secret required on
  create, empty on update keeps stored one; redirect URI rules from the decision log; `Test` with dummy
  code exchange); register the kind in `main.go`. Frontend: `ConnectorType` + models in
  `core/models/connector.ts`, `connector-types.ts`, new `google-photos-config-form.ts` (client ID, client
  secret, read-only redirect URI with copy button, hint to the README), wiring in `connector-dialog.ts`.
- **Acceptance criteria:** create/edit a Google Photos connector; secret never returned; "Test" OK with
  correct credentials, clear errors with a wrong secret / wrong client ID / unregistered redirect URI
  (verify the live Google answers and record them in Notes).
- **Notes:** `backend/internal/connector/googlephotos/kind.go` exports `Type`, `CallbackPath`, `Scope`,
  `ParseConfig`, `OAuthConfig(cfg) *oauth2.Config`. `golang.org/x/oauth2 v0.38.0` added. **Deviation:** the
  endpoint is `golang.org/x/oauth2/endpoints.Google` with `AuthStyle = AuthStyleInParams`, not
  `golang.org/x/oauth2/google` — that package pulls in `cloud.google.com/go/compute/metadata` (extra
  module). Test: dummy code `collageomat-connection-test`, 15 s timeout; result mapping as in the decision
  log, plus "Google answered with HTTP status N" (no code) and "Google cannot be reached: …". Live probe
  (fake client): token endpoint → HTTP 401 `{"error":"invalid_client","error_description":"The OAuth
  client was not found."}`; `GET https://photospicker.googleapis.com/v1/sessions/x` → 401,
  `photoslibrary.googleapis.com` → 404 ⇒ `sessions.get` uses **photospicker**. Not verified yet (needs the
  real client): `invalid_grant` and `redirect_uri_mismatch` answers. Frontend: models in
  `core/models/connector.ts`, `google-photos-config-form.ts` (copy button with `@angular/cdk/clipboard`),
  connector card subtitle via new `connectorDetail()` in `connectors.page.ts` (Google Photos shows the
  client ID). No type icons (no icon concept exists). Editor import menu lists the Google Photos connector
  `[disabled]` until step 4.

### Step 3 — Backend OAuth flow, picker sessions, routes, thumbnail, import source
- **Status:** done (reviewed 2026-11-17)
- **What:** in `backend/internal/connector/googlephotos/`: in-memory state with mutex and lazy cleanup
  (token cache per connector id + config hash, TTL from the decision log; pending `state` → {userID,
  connectorID, pickID}, 10 min; picks `pickId` → {userID, connectorID, googleSessionID, status, items,
  skippedVideos, expiry ~55 min after listing}); Picker client (`sessions.create/get/delete`,
  `mediaItems.list` all pages with pageSize 100, `baseUrl` download with bearer token; verify the
  `sessions.get` host live); service + handler routes:
  - `POST /api/connectors/{id}/googlephotos/picks` → `{pickId, openUrl}`
  - `GET /api/googlephotos/oauth/callback?code&state[&error]` → 302 `<pickerUri>/autoclose` or HTML error
  - `GET /api/connectors/{id}/googlephotos/picks/{pickId}` → `{status: "signin"|"picking"|"done"|"error",
    pollIntervalMs, error?, items: [{id, fileName, width, height, mimeType}], skippedVideos}`
  - `DELETE /api/connectors/{id}/googlephotos/picks/{pickId}` → 204
  - `GET /api/connectors/{id}/googlephotos/picks/{pickId}/items/{itemId}/thumbnail` (`=w400-h400`)
  - `Service.Source` (implements `photo.Sources`), registered in `photo.NewSourcesByType` in `main.go`;
    asset id = media item id, looked up in the picks of user + connector; missing → validation error
    "The Google Photos selection expired. Pick the photos again."
  Ownership: every route checks the connector (`LoadConfig`, type `googlephotos`) and that the pick
  belongs to the user + connector (else 404).
- **Acceptance criteria:** with browser devtools (logged in on `:4200`): POST picks → open `openUrl` →
  sign in → picker → "Done" → GET pick shows `done` with items; thumbnail URL shows an image; import via
  `POST /api/collages/{id}/import` works for preview and original; second POST within 30 min gives a
  `pickerUri` directly; DELETE removes the pick.
- **Notes:** files `googlephotos/{types,client,state,service,handler}.go`; `main.go` registers
  `googlephotos.NewService(connectorSvc)` (also in the `photo.NewSourcesByType` map) and the handler. One
  `state` struct per `Service` (one mutex): token cache `connectorID → {sha256(config), token,
  validUntil = min(now+30m, expiry−1m)}`; OAuth states (32 random bytes base64url, 10 min, single use);
  picks (18 random bytes id; expiry 1 h after creation, 55 min after listing). Lazy `sweep()` at each
  service call; expired picks with a cached token get a best-effort Google `sessions.delete`. Per-pick
  `polling` flag (no parallel Google polls). `pollInterval` clamped 1–10 s (default 3 s). Picker base
  `https://photospicker.googleapis.com/v1`; `mediaItems.list` pageSize 100, max 50 pages. Client: 30 s
  timeout, max 5 redirects, JSON limit 8 MiB, `baseUrl`/`pickerUri` must be https, errors never contain
  token or URL. Poll errors: 401 → "Google sign-in expired. Start again."; 404 → session expired;
  network/5xx → stays `picking` (retry on next poll). Callback failure page = HTTP 400 HTML
  (`html/template`); no session → JSON 401 from `RequireAuth`. **Additions (not in the original plan):**
  401 on `sessions.create` with a cached token → token dropped, sign-in URL returned; max 20 open picks
  per user (→ 429); an expired OAuth state sets its pick to `error` ("The Google sign-in was not finished
  in time. Start again."). Verified with a throwaway fake-Google test (deleted). Live test still needed
  (see Open questions).

### Step 4 — Frontend import dialog
- **Status:** done (reviewed 2026-11-17)
- **What:** `core/models/google-photos.ts`, `core/api/google-photos.api.ts`, new
  `features/editor/import/google-photos-import-dialog.{ts,html,scss}`: states start ("Open Google
  Photos"), waiting (spinner, Cancel; poll with `pollIntervalMs`; popup closed while `signin`/`picking` →
  cancelled), grid (`AssetGrid`, all pre-selected, hint for skipped videos, "Pick more photos" = append
  with dedupe, size toggle with `import-size.ts`, Import → existing import call and result message); on
  close DELETE all picks of the dialog. `editor.page.ts` `openImport` opens it for `googlephotos`.
- **Acceptance criteria:** full flow from the editor import menu; popup closes after "Done"; grid shows
  photos; import in both sizes; "Pick more" appends; error messages for denied sign-in and expired
  selection.
- **Notes:** added `core/models/google-photos.ts`, `core/api/google-photos.api.ts` (`GooglePhotosApi`
  `createPick`/`getPick`/`deletePick`), `features/editor/import/google-photos-import-dialog.{ts,html,scss}`;
  `editor.page.{ts,html}` opens the dialog for `googlephotos` (the `[disabled]` from step 2 is removed;
  empty-state text "Import photos from Immich, Synology or Google Photos."). Phases `start | waiting |
  grid | error`. Popup opened synchronously before `createPick`; `null` → "popup blocked" error. Polling
  with a `setTimeout` chain (first poll after 1 s, then `pollIntervalMs`), generation counter drops stale
  results. Cancel detection: `popup.closed` read before each poll; if closed and the status is still
  `signin`/`picking` after that poll → cancelled, pick deleted, back to the previous phase. All pick ids
  of the dialog are deleted on destroy. **Additions:** "Show picked photos" button in the error phase
  (keeps the earlier selection after a failed "Pick more"); two Cancel buttons in the waiting phase
  (content Cancel stops the pick, dialog Cancel closes the dialog); empty `done` pick shows "No photos were
  picked."; `skippedVideos` summed over all picks. **Bug found in the developer's test (2026-11-17), fixed:** `photos.google.com` sends
  `Cross-Origin-Opener-Policy: same-origin-allow-popups` (enforced; `accounts.google.com` sends it only
  report-only). The browser severs the popup reference, `popup.closed` reads `true` while the picker is
  open → the dialog cancelled and sent DELETE → Google session deleted → "Done" in Google failed ("Fotos
  konnten nicht hinzugefügt werden"). Confirmed by the developer (DELETE in the Network tab a few seconds
  after the picker opened; Chrome console: "Cross-Origin-Opener-Policy policy would block the
  window.closed call"). **Fix:** the dialog never reads `popup.closed` and does not touch the popup after
  `popup.location.href = openUrl` (only closes its own `about:blank` popup if `createPick` fails or the
  user cancels during `createPick`). Polling runs until `done`/`error`, content Cancel, or dialog destroy.
  Waiting text has a second line "If you closed the Google window, click Cancel."
  (`@@editor.googlePhotosImport.waitingClosedHint`). Do not re-add `popup.closed` detection. `connectors.page.html` empty-state text still names only
  Immich and Synology.

### Step 5 — Architecture docs, finish
- **Status:** done (reviewed 2026-11-17)
- **What:** `doc/architecture.md` (overview, package table, Google Photos connector section, data model
  `connectors.type` / `photos.source_asset_id`, API table, domain terms); set **Status:** done; move this
  file to `doc/agent-plans/done/`.
- **Acceptance criteria:** docs match the code.
- **Notes:** `doc/architecture.md`: overview, package table, security, connectors section, new section
  "Google Photos connector", frontend table, data model, API table, domain terms. `doc/development.md`:
  subsection "Google Photos connector" (dev redirect URI, restart loses tokens and picks). The plan
  moved to `done/`; the link in the architecture section points to `agent-plans/done/google-photos-connector.md`.

## Open questions

- Not separately verified: whether `=d` returns HEIC originals as HEIC (the code falls back to the preview
  for non-JPEG/PNG/WebP item MIME types and Content-Types), the `redirect_uri_mismatch` answer of the
  connection test, media item id length (≤ 200 chars for `photos.source_asset_id`; no problem seen).

## Current state / Next action

Done. All steps implemented and tested by the developer on 2026-11-17 (connector, connection test, sign-in,
picker, "Done", grid, import; the `popup.closed` COOP bug found in the test is fixed). Plan moved to
`doc/agent-plans/done/`. No commit made.
