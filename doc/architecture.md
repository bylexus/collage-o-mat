# Architecture

## Overview

```
Browser (Angular SPA, Konva canvas)
   │  JSON over /api/...  (session cookie)
   ▼
collageomat (one Go binary)
   ├─ /api/...   httpapi router → domain modules (auth, collage, photo, connector, immich, synology, googlephotos, profile, admin, settings)
   ├─ /*         embedded SPA (internal/web, go:embed, fallback to index.html)
   ├─ SQLite     <DATA_DIR>/collageomat.db   (WAL, foreign keys on)
   ├─ files      <DATA_DIR>/photos/<collageId>/<photoId>.<ext>
   └─ Immich, Synology Photos, Google Photos   server-side proxy (the browser never talks to Immich, the NAS
                 or the Google APIs directly; only Google's sign-in and picker pages open in a popup)
```

Main principles:

- **One static binary** (`CGO_ENABLED=0`), no separate web server. Subcommands: `serve`, `user add`,
  `user passwd`.
- **Frontend owns geometry.** Arrangement algorithms, crop math, rendering and export run in the browser
  (TypeScript + Konva). The backend never renders a collage.
- **Typed key columns + JSON props.** Tables have typed columns only for identity, ownership and file data.
  Layout and settings data is one JSON `TEXT` column per row (`collages.settings`, `photos.props`,
  `collage_texts.props`). The frontend owns the JSON structure; the backend checks that it is valid JSON
  and checks ownership. A change of the editor model needs no DB migration.
- **Schema migration:** GORM `AutoMigrate` at start (`models()` in `backend/cmd/collageomat/main.go`).
  New fields in JSON props need frontend defaults for old rows.
- **Editor save model:** the editor keeps the full layout (settings + photo props + texts) in memory. Each
  change makes an undo snapshot and a debounced (1 s) `PUT /api/collages/{id}/layout` with the full layout.

## Backend (`backend/`)

Go module `collageomat`. Wiring only in the composition root `backend/cmd/collageomat/main.go`. No
package-level mutable state.

### Domain packages (`internal/<domain>/`)

| File | Role |
|---|---|
| `model.go` | GORM models only |
| `store.go` | `GormStore` / `NewGormStore(db)` — the only layer that uses `*gorm.DB` |
| `service.go` | Business rules: validation, ownership, transactions. No `net/http`. Declares the `Store` interface it needs |
| `handler.go` | HTTP only: parse, call service, write result. Implements `httpapi.Module` |

| Package | Responsibility |
|---|---|
| `auth` | Users, sessions (cookie token, SHA-256 hash in DB), login rate limit (`LoginLimiter`), `RequireAuth` (rejects inactive users; updates `users.last_active_at` max. once per hour), `RequireAdmin` (403 for non-admins, used after `RequireAuth`), `auth.UserID(r)`, `auth.SessionID(r)`. `PasswordChanger` (implements `profile.Passwords`, uses the same `LoginLimiter` instance as the login). Declares `AvatarVersions` (implemented by `profile.Service`) for the user DTO. Older code, no store/service split |
| `collage` | Collages, texts, layout save (one transaction) |
| `photo` | Photo rows and files, connector import (preview: stored as downloaded; original: `process.go` calls `imaging`, no scaling; `SourcesByType` in `sources.go` picks the `Sources` of the connector type), local upload (`process.go`: calls `imaging`, long edge ≤ 2560 px), file serving |
| `connector` | Connectors per user, `Kind` registry (strategy per connector type), config encrypted with `secretbox` |
| `connector/immich` | Immich HTTP client, album/asset listing, thumbnail proxy |
| `connector/synology` | Synology Photos (DSM 7) Web API client with session cache, album/folder/item listing (Personal Space, shared albums, Shared Space), thumbnail proxy, import source. See [Synology connector](#synology-connector) |
| `connector/googlephotos` | Google Photos Picker API: OAuth sign-in per import (`golang.org/x/oauth2`), in-memory token cache and picks (selections), picker session client, thumbnail proxy, import source. See [Google Photos connector](#google-photos-connector) |
| `profile` | Profile of the session user: password change (through the `Passwords` interface), avatar (upload → `imaging` square ≤ 500×500 JPEG, store, serve, delete) |
| `admin` | User management for admins (`/api/admin/users...`): list with usage counts, create, update (admin/active flags, new password), delete with all data. Rules: an admin cannot change, set the password of or delete the own account; at least one active admin always remains (checked in the same transaction). Deactivate and new password delete the user's sessions. Delete: each collage through `collage.Service.Delete` (rows + photo directory), then the `users` row (FK cascade). Interfaces: `Collages` (`*collage.Service`), `Usage` (`collage.UserUsage`), `Avatars` (`*profile.Service`) |
| `settings` | System-wide settings (`/api/admin/settings`): typed `Settings` struct, one `system_settings` row per field (key = JSON name), defaults in `Defaults()`, rules in `validate()`. New setting = new field, no migration. `maxUserStorageBytes` (default 2·10⁹, 0 = unlimited) is stored but not enforced yet |

Rules:

- Cross-domain access only through small interfaces declared by the consumer and implemented by an adapter
  in the provider package (example: `collage.Photos` implemented in `internal/photo/collage_photos.go`).
- Ownership: service methods take the session `userID`. A missing record **or** one of another user gives
  `apperr.ErrNotFound` → 404.
- Errors: services return `apperr` errors; `httpapi.WriteServiceError` maps them to HTTP status +
  `{"error": "..."}`. Unknown errors → 500, real error logged. Wrap errors with context (`%w`).

### Shared packages

| Package | Content |
|---|---|
| `httpapi` | Router (`NewRouter`), `Module` interface, JSON read/write, `PathID`, middleware (logging, recover, require JSON content type), error mapping |
| `apperr` | `ErrNotFound`, `ErrConflict`, `ErrTooLarge`, `ErrTooManyRequests`, validation error, upstream error |
| `db` | Open SQLite with pragmas, `AutoMigrate`, transactor |
| `jsoncol` | GORM column type for JSON stored as `TEXT` |
| `imaging` | Uploaded images (JPEG, PNG, WebP): format check, header check (≤ 60 MP), decode, EXIF orientation, flatten on white, optional square center crop, downscale, JPEG encode. `DecodeLimiter`: one instance per server (made in `main.go`, 2 slots), shared by `photo` and `profile` |
| `config` | `COLLAGEOMAT_*` environment variables (see [development.md](development.md#environment-variables)) |
| `secretbox` | AES-256-GCM, key = SHA-256(`COLLAGEOMAT_SECRET`) |
| `web` | Embedded SPA from `internal/web/dist` (filled by `make build` or the Dockerfile) |

### Security

- All `/api` routes need a session, except `GET /api/health` and `POST /api/auth/login`.
- `/api/admin/...` routes also need `users.is_admin` (`RequireAdmin`, else 403). Inactive users
  (`users.is_active = false`) cannot log in (generic 401) and their sessions are rejected.
- Mutating `/api` requests must have `Content-Type: application/json`. Exceptions (see
  `httpapi.RequireJSON`): `POST /api/collages/{id}/uploads` and `PUT /api/profile/avatar` also accept
  `image/jpeg|png|webp`. With the `SameSite=Lax` cookie this is the CSRF protection.
- Password change (`PUT /api/profile/password`) needs the current password. Wrong current passwords count
  in the login rate limit (same `LoginLimiter`, same key username + client IP; blocked → 429). A wrong
  current password gives 400, not 401, because the frontend logs out on 401. Success deletes all other
  sessions of the user; the current session stays.
- Connector secrets (Immich API key, Synology password, Google OAuth client secret) are stored encrypted
  and are never returned by the API (`apiKeySet: true` / `passwordSet: true` / `clientSecretSet: true`
  only).
- The Google OAuth callback (`GET /api/googlephotos/oauth/callback`) needs the session cookie (the
  `SameSite=Lax` cookie is sent on the top-level redirect from Google) and a valid, unexpired `state` that
  belongs to the session user (single use). Google access tokens stay in server memory only; they are never
  sent to the browser and never part of error messages or logs.

### Connectors and import sources

- A connector type is a `connector.Kind` (`Type`, `BuildConfig`, `PublicConfig`, `Test`), registered in
  `newConnectorService` in `main.go`. Types: `immich` (`connector/immich`), `synology`
  (`connector/synology`), `googlephotos` (`connector/googlephotos`). `connector.Service` does not know the
  concrete types.
- Each type has its own service + handler with type-specific browse routes
  (`/api/connectors/{id}/<type>/...`; Google Photos also has the connector-independent OAuth callback
  `/api/googlephotos/oauth/callback`); the service checks ownership (`connector.Service.LoadConfig`) and the
  connector type (wrong type → validation error).
- Import: `photo.Service` takes one `photo.Sources`. In `main.go` this is `photo.SourcesByType`
  (`internal/photo/sources.go`) with a map connector type → `Sources` (`immich.Service`,
  `synology.Service`, `googlephotos.Service`). It loads the connector, picks the `Sources` of its type
  (unknown type → validation error) and delegates. It is in `photo` because `connector` cannot import `photo` (import cycle).

### Synology connector

> **Note for future agents:** the Synology connector depends on the **undocumented** `SYNO.Foto.*` Web
> API of Synology Photos. It is reverse-engineered (community docs) and was verified live on 2026-11-16
> against DSM 7 / Synology Photos. DSM or Synology Photos updates can change it without notice. If
> Synology calls fail after an update, re-investigate the API: probe with `SYNO.API.Info` (`query=all`, no
> login) and read-only calls only. Known pitfalls:
>
> - The album filter of `SYNO.Foto.Browse.Item` `list` is `album_id`. With `id` the filter is silently
>   ignored and the whole library is returned.
> - Do not send the `session` param at login: a custom session name gives error 402.
> - `limit=0` returns an empty list: always page with a limit.
> - Errors come as HTTP 200 with JSON `{"success":false,"error":{"code":N}}`, also from thumbnail and
>   download URLs.
> - The preview import requests the `xl` thumbnail with the derived `cache_key` `<id>_0`. This works only
>   because the NAS does not validate `cache_key`.
>
> The verified calls, params and responses are in
> [agent-plans/done/synology-connector.md](agent-plans/done/synology-connector.md) ("Live probe").

Scope: Synology Photos on DSM 7 or newer, **Personal Space** of the account (own albums and the folder
tree), the albums that other NAS users shared with the account ("Shared with me") and the folder tree of
the **Shared Space** (`SYNO.FotoTeam.*`, only if the account has access). No Photo Station (DSM 6), no
Shared Space albums, no public share links, no 2FA. Videos are hidden (`photo` and `live` items are
shown).

Package `backend/internal/connector/synology/`:

| File | Content |
|---|---|
| `kind.go` | `Kind` (`Type = "synology"`): config `{url, account, password, skipTlsVerify}` (URL stored as `scheme://host[:port]`, a path like `/photo/` is removed; an empty password on update keeps the stored one); public config `{url, account, passwordSet, skipTlsVerify}`. Two shared `*http.Client`s: normal and one with `InsecureSkipVerify`, chosen by `skipTlsVerify`. `Test` logs in with its own session, reads one album and logs out. `Client(connectorID, stored)` returns a client with the cached session of the connector |
| `client.go` | Web API client: POST/GET to `<url>/webapi/entry.cgi`, `_sid` param, JSON envelope `success`/`data`/`error.code` (a JSON answer to a thumbnail/download is an error), login (`SYNO.API.Auth` v6, `format=sid`, POST), album/item/folder listing, thumbnail, original download (folder/item/thumbnail/download calls take a `space`). Same-host redirects only, 30 s timeout. `APIError` messages are user-safe (never contain password or sid) |
| `session.go` | `session` (sid, one login at a time, login failure cooldown), `passphraseCache` (shared album id → share token), `sessionCache` (one session + passphrase cache per connector id; replaced when the stored config changes) |
| `service.go` | `Service`: albums and shared albums (all pages, sorted by name), album/shared album/folder items (pages of 250), folder with subfolders (Personal Space and Shared Space), Shared Space availability (`SharedSpaceAvailable`), thumbnail proxy, `Source` (implements `photo.Sources`), `parseAssetRef` (all three asset id forms) |
| `handler.go` | Routes `/api/connectors/{id}/synology/...` (see [API](#api)) |
| `types.go` | API names/versions (`SYNO.Foto.*`, `SYNO.FotoTeam.*`), `space` (`personalSpace`, `sharedSpace`), error codes, NAS response types |

Session handling:

- The session id (sid) is cached in memory per connector (`Kind`). Concurrent callers wait for one login.
- NAS error 106, 107 or 119 (session timeout / interrupted / invalid) → log in again **once** and repeat
  the request.
- Login errors are never retried. After a failed login, the session returns the same error for **1
  minute** (`loginCooldown`) without a NAS request. *Why:* DSM auto-block blocks the server IP after
  repeated failed logins. A config change gives a new session (ends the cooldown). The connector test is
  not affected (own session).

Image sizes: grid thumbnail = `m` (short side 320 px); preview import = `xl` (short side 1280 px, already
rotated); original import = `SYNO.Foto.Download` with one `unit_id`. If the original is not JPEG, PNG or
WebP (e.g. HEIC, Live Photo ZIP), the `xl` thumbnail is used instead (`SourceImage.Fallback`).

Asset ids (`photos.source_asset_id`, canonical decimals): Personal Space photo = `<itemId>`; photo of a
shared album = `s:<albumId>:<itemId>`; Shared Space photo = `t:<itemId>`. `parseAssetRef` parses all three,
for the thumbnail route and the import (the `t:` form selects the Shared Space APIs).

Shared albums ("Shared with me"):

- Listed with `SYNO.Foto.Sharing.Misc` v2 `list_shared_with_me_album`. Each album has a **passphrase**
  (share token generated by Synology). Albums without id or passphrase are dropped.
- The passphrase stays on the server: routes, browser and DB use only the album id. It is cached in memory
  (album id → passphrase) in the connector's `sessionCache` entry (a config change clears it). A cache miss
  loads the shared-album list once more; a still unknown album → 404.
- API forms (`_sid` always sent): items = `SYNO.Foto.Browse.Item` `list` with `passphrase=<token>`
  **instead of** `album_id` (both → error 120); thumbnail = `SYNO.Foto.Thumbnail` v2 with `id=<item id>`,
  `type="item"` and `passphrase="<token>"` (quoted); original = `SYNO.Foto.Download` v2 with
  `unit_id=[<id>]` and `passphrase="<token>"` (quoted).
- If the NAS refuses the original (Synology API error that is not a login or session error, e.g. "viewer"
  role), the import uses the `xl` thumbnail (`SourceImage.Fallback`).
- These API forms are based on
  [esp32-photoframe-server PR #63](https://github.com/aitjcize/esp32-photoframe-server/pull/63) (DSM 7.4.1)
  and were verified on 2026-11-17 by listing and importing from a shared album on the test NAS. Not
  separately verified: the "viewer"-role fallback and whether `_sid` is needed with the passphrase.
  Details and open questions: [agent-plans/done/synology-shared-albums.md](agent-plans/done/synology-shared-albums.md).

Shared Space (Team Space):

- A folder tree that the NAS admin shares with several users (folder-based, no passphrase: access is a
  permission of the account). API family `SYNO.FotoTeam.*`, which mirrors the Personal Space APIs.
- **Space:** the client calls `getFolder`, `listFolders`, `listItems`, `thumbnail` and `original` take a
  `space` (struct of API refs name + version for `browseFolder`, `browseItem`, `thumbnail`, `download`):
  `personalSpace` (`SYNO.Foto.*`, built from the existing constants) or `sharedSpace` (`SYNO.FotoTeam.*`).
  Methods and params are the same for both spaces. The `photo` package and the import API are unchanged.
- **Availability:** `SharedSpaceAvailable` reads the Shared Space root folder. NAS error **801** (not a
  login error) → `available: false` (seen on the test NAS for an account without Shared Space access;
  meaning not documented). Other errors → 502. On the folder routes, 801 gives the generic error message.
- Folder navigation and the original fallback work as in the Personal Space (root = `get`/`list` without
  `id`; non-JPEG/PNG/WebP original → `xl` thumbnail with `Fallback=true`).
- **API forms** (from unofficial community docs; verified on 2026-11-17 by the developer's test on the test
  NAS: tab, folder navigation, thumbnails and import work):
  `SYNO.FotoTeam.Browse.Folder` v1 `get`/`list` (root without `id`), `SYNO.FotoTeam.Browse.Item` v1 `list`
  with `folder_id`, `SYNO.FotoTeam.Thumbnail` v1 `get` with the item id and `type="unit"`,
  `SYNO.FotoTeam.Download` v1 `download` with `unit_id=[<id>]`. Alternatives if a call fails after a DSM update: thumbnail
  `type="item"`; root folders with `list_parents`; versions from `SYNO.API.Info`; thumbnail path
  `/synofoto/api/v2/t/Thumbnail/get` (reported for newer DSM). Sources and open questions:
  [agent-plans/done/synology-shared-space.md](agent-plans/done/synology-shared-space.md).

### Google Photos connector

> **Note for future agents:** verified live (2026-11-17, with a fake OAuth client): the token endpoint
> answers an unknown client with HTTP 401 `invalid_client`; `sessions.get` uses the host
> `photospicker.googleapis.com` (`photoslibrary.googleapis.com` gives 404, although the sessions guide
> shows it in an example). **Not verified live yet** (needs the developer's real OAuth client): the
> `invalid_grant` and `redirect_uri_mismatch` answers of the connection test, the full flow (sign-in →
> picker → items → import), whether `=d` returns HEIC originals as HEIC. **Never use `popup.closed`** in the
> import dialog: `photos.google.com` sends `Cross-Origin-Opener-Policy: same-origin-allow-popups`, the
> browser severs the popup reference and `popup.closed` reads `true` while the picker is open (a cancel
> then deletes the Google session and "Done" fails in Google). Details and open questions:
> [agent-plans/done/google-photos-connector.md](agent-plans/done/google-photos-connector.md).

Why the Picker API: since 2025-03-31 the Google Photos Library API gives third-party apps read access only
to media that the app created. To read existing photos, the user selects them in Google's own picker page
(Google Photos **Picker API**, scope `photospicker.mediaitems.readonly`). There is no album or library
browsing in Collage-o-mat. Videos (all items with `type != PHOTO`) are dropped and counted
(`skippedVideos`).

OAuth client per connector: each connector has the OAuth client ("Web application") of the user's own
Google Cloud project. Setup for users: README section "Connect Google Photos".

- Config `{clientId, clientSecret, redirectUri}`; public config `{clientId, clientSecretSet, redirectUri}`.
- Client ID required. Client secret required on create; an empty secret on update keeps the stored one.
- Redirect URI: the config form shows `window.location.origin + "/api/googlephotos/oauth/callback"`
  read-only (copy button) and sends it; the backend stores it (no env var, no trust in `Host` /
  `X-Forwarded-*`). Rules: absolute URL, path exactly `/api/googlephotos/oauth/callback`, no user info,
  query or fragment, scheme `https` (`http` only for host `localhost` / `127.0.0.1`).
- OAuth endpoint: `golang.org/x/oauth2/endpoints.Google` with `AuthStyleInParams` (not
  `golang.org/x/oauth2/google`: it pulls in an extra module). No `prompt` and no `login_hint`.

In-memory state (one `state` per `Service`, one mutex, lazy `sweep()` at each service call). **All of it
is lost on a server restart** (the user signs in and picks again):

- **Token cache:** connector id → access token + SHA-256 of the stored config. Valid until
  min(sign-in + 30 min, token expiry − 1 min). Used only for the same config (a config change needs a new
  sign-in). No refresh token, nothing in the DB. A 401 from Google on `sessions.create` drops the token
  (new sign-in).
- **OAuth states:** random `state` → {user, connector, pick}, 10 min, single use. An expired state sets
  its pick to `error` ("not finished in time").
- **Picks:** random `pickId` → {user, connector, Google session id, status, items, `skippedVideos`}. TTL
  1 h after creation, 55 min after the items are listed (`baseUrl` is valid 60 min). Max 20 open picks
  per user (→ 429). Status: `signin` (waits for the callback), `picking` (Google session exists),
  `done` (items listed), `error` (user-safe message). Expired picks with a still cached token get a
  best-effort Google `sessions.delete`.

Flow of one import:

1. The dialog opens an empty popup synchronously on the click (popup blockers), then
   `POST .../googlephotos/picks` → `{pickId, openUrl}` and sets the popup location.
2. Cached token → the server creates the picker session at once, `openUrl` = `<pickerUri>/autoclose`. No
   token → `openUrl` = Google sign-in URL with a new `state`; Google redirects the popup to
   `GET /api/googlephotos/oauth/callback?code&state` → the server exchanges the code, caches the token,
   creates the picker session and answers 302 to `<pickerUri>/autoclose`. A failure gives an HTML page
   (HTTP 400) "Sign-in failed: <reason>. Close this window." and the pick status `error`.
3. The user picks photos in Google's page and clicks "Done"; the popup closes itself (`/autoclose`).
4. The dialog polls `GET .../picks/{pickId}` with `pollIntervalMs` (Google's interval, clamped 1–10 s,
   default 3 s). The server calls `sessions.get` (one poll per pick at a time) until `mediaItemsSet`, then
   `mediaItems.list` (all pages, page size 100, max 50 pages) and keeps the photos with `baseUrl` in
   memory. Poll errors: 401 → `error` (sign-in expired), 404 → `error` (session expired), network / 5xx →
   stays `picking`.
5. The grid shows the photos (thumbnails through the proxy). Import with the normal
   `POST /api/collages/{id}/import`: the `googlephotos` Source finds the media item in the `done`, unexpired
   picks of user + connector (latest listed wins) and downloads it with the cached token. Not found → "The
   Google Photos selection expired. Pick the photos again."; no token → "The Google sign-in expired. Pick
   the photos again."
6. Closing the dialog → `DELETE .../picks/{pickId}` for each pick (memory + Google `sessions.delete` if a
   token is cached).

Package `backend/internal/connector/googlephotos/`:

| File | Content |
|---|---|
| `kind.go` | `Kind` (`Type = "googlephotos"`): config validation (see above), public config, `Test`; exports `CallbackPath`, `Scope`, `ParseConfig`, `OAuthConfig(cfg)` |
| `client.go` | Picker API client (`https://photospicker.googleapis.com/v1`): `sessions.create/get/delete`, `mediaItems.list`, `baseUrl` download with `Authorization: Bearer`. 30 s timeout, max 5 redirects, JSON limit 8 MiB, `pickerUri`/`baseUrl` must be https. `APIError` messages are user-safe (never contain the token or a `baseUrl`) |
| `state.go` | In-memory state: token cache, OAuth states, picks, TTLs, `sweep` |
| `service.go` | `Service`: `CreatePick`, `Callback` (code exchange, picker session), `Pick` (poll, list items, drop videos), `DeletePick`, `Thumbnail`, `Source` (implements `photo.Sources`) |
| `handler.go` | Routes `/api/connectors/{id}/googlephotos/...` and the OAuth callback (see [API](#api)); HTML failure page (`html/template`) |
| `types.go` | Picker API response types (`PickingSession`, `PickedMediaItem`, error body) |

Image sizes (`baseUrl` suffix): grid thumbnail = `=w400-h400`; preview import = `=w2048-h2048` (fits in
2048×2048 px); original import = `=d`. If the item `mimeType` or the response Content-Type of `=d` is not
JPEG, PNG or WebP (e.g. HEIC), the preview is used instead (`SourceImage.Fallback`). A response that is not
`image/*` is rejected.

Asset ids (`photos.source_asset_id`): the Google media item id (persistent: the same photo always has the
same id).

Connection test: a real test needs a sign-in, so `Test` exchanges the dummy code
`collageomat-connection-test` at Google's token endpoint (15 s timeout). Google checks the client and the
redirect URI before the code: `invalid_grant` → OK; `invalid_client` / `unauthorized_client` → "Client ID
or client secret is wrong"; `redirect_uri_mismatch` → "Redirect URI is not registered in Google Cloud";
other code → "Google answered: <code>"; no code → "Google answered with HTTP status N"; network error →
"Google cannot be reached: …".

## Frontend (`frontend/`)

Angular 22 standalone components, signals, `inject()`, new control flow, OnPush, Angular Material. No state
library. UI language English, all texts marked for i18n (build-time Angular i18n, source locale `en`).

| Path | Content |
|---|---|
| `src/app/app.routes.ts` | Routes: `login` (own layout); `AppShell` with `authGuard` and the children `collages`, `collages/:id` (editor), `settings/connectors`, `profile`, `about`, `admin` (`adminGuard`; tab children `users`, `settings`) |
| `src/app/layout/app-shell.*` | `AppShell`: base layout of all signed-in pages (main toolbar + page outlet). Toolbar: round profile button (`UserAvatar`) opens a `mat-menu` (username, Admin badge, Profile, Log out); for admins an icon button `manage_accounts` (Administration) left of About |
| `src/app/core/api/` | One API service per resource (`CollageApi`, `PhotoApi`, `ConnectorApi`, `ImmichApi`, `SynologyApi`, `GooglePhotosApi`, `AuthApi`, `ProfileApi`, `AdminApi`) |
| `src/app/core/models/` | Typed DTOs and JSON props models (`collage.ts`, `photo.ts`, `text.ts`, `shadow.ts`, `layout.ts`); connector DTOs (`connector.ts`, `immich.ts`, `synology.ts`, `google-photos.ts`) and the neutral import types `SourceAlbum`, `SourceAsset`, `SourceAssetPage` (`source.ts`) |
| `src/app/features/editor/` | Editor page and store (`editor.store.ts`), undo history, auto save |
| `features/editor/canvas/` | Konva rendering, transformers, crop mode, viewport, export renderer, adjusted/blurred image copies |
| `features/editor/arrange/` | Pure arrangement functions (grid, center, random heap, masonry, lanes, justified lines) |
| `features/editor/toolbar/` | `SelectionToolbar`: floating toolbar below the selected photo or text (anchor from `CollageRenderer`, hidden during gestures and crop mode, only the Swap button in swap mode); actions and movable CDK overlay popovers |
| `features/editor/photo-panel/`, `text-panel/` | Popover sections of the selection toolbar (photo: border, shadow, adjustments; text: edit, outline, shadow) |
| `features/editor/settings-panel/` | Collage settings in the right panel (the only content of the right panel) |
| `features/editor/fields/` | Shared form fields (colour, number, `BorderFields` + `borderFormGroup`, `ShadowFields` + `SHADOW_LIMITS`) |
| `features/editor/geometry/` | Pure math: crop, units (mm/pt/px), gradients, snap grid |
| `features/editor/import/`, `upload/` | Connector import dialogs, local file upload. The editor toolbar "Import" button opens a `mat-menu` that lists the user's connectors (name + type; loaded with `ConnectorApi.list()` each time the menu opens; "Add a connector" links to the connector settings if there is none). An entry opens the dialog of the connector's type with that connector (`ImportDialogData.connector`): Immich (`import-dialog.*`: albums) or Synology (`synology-import-dialog.*`: tabs "Albums" / "Folders" / "Shared with me" / "Shared Space"; "Shared Space" is shown only if `SynologyApi.sharedSpace` returns `available: true` (checked when the dialog opens; on an error the tab is shown); folder navigation with breadcrumb, one trail per space (Personal Space, Shared Space)) or Google Photos (`google-photos-import-dialog.*`:
phases `start` ("Open Google Photos"), `waiting` (spinner, Cancel; popup opened synchronously on the
click, polls the pick with `pollIntervalMs` until `done`/`error`/Cancel; the popup is not touched after its
location is set (COOP, see Google Photos connector)), `grid`
(picked photos, all pre-selected, hint for skipped videos, "Pick more photos" appends without
duplicates), `error` (message, "Try again", "Show picked photos" if photos are picked); closing the dialog
deletes all its picks). All dialogs share the generic presentational components `AssetGrid<T extends SourceAsset>` (`asset-grid.ts`, thumbnail URL as function input) and (Immich, Synology) `AlbumList<T extends SourceAlbum>` (`album-list.ts`), `import-size.ts` (preview/original choice in localStorage) and `original-size.ts` |
| `src/app/features/connectors/` | Connector settings page ("Add connector" menu per type), connector dialog, one config form per type (`immich-config-form.ts`, `synology-config-form.ts`, `google-photos-config-form.ts`: client ID, client secret, read-only redirect URI of the current origin with copy button), `connector-types.ts`; the connector card shows the URL (Immich, Synology) or the client ID (Google Photos) |
| `features/editor/export/` | PNG/JPG export dialog |
| `src/app/features/admin/` | Admin page (tab nav): Users tab (table with avatar, flags, last activity date (`DatePipe 'mediumDate'`, `—` if none), counts; create, edit and type-username delete dialogs), Settings tab (storage limit in GB, 1 GB = 10⁹ bytes) |
| `src/app/features/profile/` | Profile page: info (username, Admin badge, member since), avatar card (upload, remove), change password card |
| `src/app/shared/` | `ConfirmDialog`, `NotificationService`, `errorMessage(err)`, `UserAvatar` (round avatar image or first letter of the username) |

Rules: only `core/api` services use `HttpClient`. Page components load data and hold state; dialogs and
presentational components use `input()`/`output()` and do no API calls.

## Data model

All tables have `created_at`, `updated_at`. JSON columns are `TEXT`.

| Table | Columns |
|---|---|
| `users` | `id`, `username` unique, `password_hash` (bcrypt), `is_admin`, `is_active` (DB default `true`), `last_active_at` (nullable; set on login and max. once per hour on authenticated requests by `RequireAuth`, without a change of `updated_at`) |
| `system_settings` | `key` PK, `value` JSON |
| `sessions` | `id`, `token_hash` unique, `user_id` FK, `expires_at` |
| `user_avatars` | `user_id` PK + FK (`ON DELETE CASCADE`), `data` BLOB (JPEG, square, ≤ 500×500 px), `mime_type`. Own table, because `RequireAuth` loads the `users` row on each request |
| `collages` | `id`, `user_id` FK, `name`, `settings` JSON |
| `collage_texts` | `id` (UUID from frontend), `collage_id` FK, `props` JSON |
| `connectors` | `id`, `user_id` FK, `type` (`immich`, `synology`, `googlephotos`), `name`, `config` (encrypted JSON) |
| `photos` | `id`, `collage_id` FK, `connector_id` (NULL for uploads), `source_asset_id` (Immich id, Synology item id, `s:<albumId>:<itemId>` for a Synology shared album photo, `t:<itemId>` for a Synology Shared Space photo, Google media item id, or `sha256:<hex>`), `file_name`, `mime_type`, `width_px`, `height_px`, `props` JSON |

Units: page and element geometry in mm (frame centre `cxMm/cyMm`, rotation around the centre), font size
in pt, crop as normalized rectangle (0..1) of the source image. `z` is shared between photos and texts.
The exact JSON shapes are the TypeScript models in `frontend/src/app/core/models/`.

Photo look: the collage settings hold `defaultBorder` and `defaultShadow`; each photo's props can override
them (`border` and `shadow`: missing or `null` = default, else a full own object). A border
(`BorderSettings`) has a `type` (`none`, `color`, `polaroid`, `corners`) and the values of each type
(`color`: `widthMm`, `color`; `polaroid`: `format` `p600`/`go`/`spectra`, card `color`; `corners`:
`color`, `sizeMode` `fixed`/`relative`, `sizeMm`, `sizePercent`), kept when the type changes. A collage `defaultBorder` without a valid `type` (old format
`{ widthMm, color }`) is normalized to the defaults (type `none`); a photo `border` that is no valid
`BorderSettings` counts as no own border (`features/editor/photo-border.ts`: `effectiveBorder`,
`hasBorderOverride`). `PhotoView` draws the effective border with the pure layout of
`features/editor/border-geometry.ts` (`borderLayout`: fill rect + inner image clip + image rect). Polaroid: the card sizes are
`POLAROID_FORMAT_SIZES`; the card is scaled to the frame (`s = min(frameW / cardW, frameH / cardH)`),
the thick border is always at the bottom of the frame, and the image is cover-fitted into the inner
area (the centred part of the stored crop with the inner aspect, `coverPart`; the stored crop, crop
mode, arrange and swap do not know about the border). Photo corners: the image fills the frame (as
`none`); four closed Konva `Line` triangles lie on top of it at the frame corners, leg = `sizeMm` or
`sizePercent` % of the shorter frame side, clamped to half of it (`cornerLegMm`). The triangles have a
gap g = 2.5 % of the leg to the photo (`CORNER_GAP_RATIO`): the right-angle corner is the frame corner
moved out by g in both directions, the legs lie g outside the frame edges, so the triangles stick out
of the frame (the page background shows in the gap). They are in the outer, not clipped photo group
(above the clipped content), so neither they nor their shadow are cut by the frame; each has a fixed
soft shadow (black, 35 %, blur 8 % / offset 3 % of the leg, down-right). With corners the photo group
reports the frame as its client rect (`PhotoGroup` in `photo-view.ts`), so the selection handles,
resize snapping and the toolbar anchor use the frame only, as for the other types. `BorderFields`
(type select + fields of the type) is used in Appearance and in the photo border popover. An own
`shadow` with `enabled: false` = no shadow for this photo. Texts and photos use the same `Shadow` type.
Re-arrange sets new frames but keeps each photo's own border, shadow and adjustment.

Photo adjustments: each photo's props can have `adjust` (`brightness`, `contrast` -100..100,
`tintColor`, `tintStrength` 0..100 %); missing or `null` = none, there is no collage default. They are
non-destructive: `PhotoView` draws an adjusted copy of the source (`canvas/adjusted-image.ts`, own pixel
pass, same size as the source, so crop and export work unchanged). `ctx.filter` and Konva filters are not
used (Safari has `ctx.filter` only behind a flag; Konva filters need `cache()` per zoom and DPI). The page
background image always shows the original photo.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Health check (public) |
| POST | `/api/auth/login` | Login, sets the session cookie (public) |
| POST | `/api/auth/logout` | Logout |
| GET | `/api/auth/me` | Session user (`id`, `username`, `isAdmin`, `createdAt`, `avatarVersion` = unix ms of the last avatar change or `null`); the login response has the same shape |
| PUT | `/api/profile/password` | Change the own password (`currentPassword`, `newPassword`) → 204 |
| PUT, DELETE | `/api/profile/avatar` | Set the avatar (raw image body, max 10 MiB, max 60 MP), remove it → user DTO |
| GET | `/api/profile/avatar?v=<avatarVersion>` | Own avatar JPEG (immutable cache), 404 if not set |
| GET, POST | `/api/admin/users` | Admin: list users (`isActive`, `collageCount`, `photoCount` added to the user DTO), create (`username`, `password`, `isAdmin`) → 201 |
| PATCH, DELETE | `/api/admin/users/{id}` | Admin: update (`isAdmin`, `isActive` required, `newPassword` optional), delete with all data → 204; rule violations → 409 |
| GET | `/api/admin/users/{id}/avatar?v=<avatarVersion>` | Admin: avatar JPEG of any user |
| GET, PUT | `/api/admin/settings` | Admin: system settings (`maxUserStorageBytes`) |
| GET, POST | `/api/collages` | List, create |
| GET, PATCH, DELETE | `/api/collages/{id}` | Load full collage, rename, delete (rows + photo dir) |
| POST | `/api/collages/{id}/duplicate` | Copy the collage (settings with remapped photo ids, photo rows + files, texts with new ids) in one transaction; skips photos with a missing file (`skippedPhotos`) |
| PUT | `/api/collages/{id}/layout` | Save settings + photo props + texts in one transaction |
| POST | `/api/collages/{id}/import` | Import connector assets (Immich, Synology or Google Photos; `connectorId`, `assetIds`, `size` = `"preview"` (default) or `"original"`) → `photos`, `skipped`, `previewFallbacks` (original requests that were answered with the preview) |
| POST | `/api/collages/{id}/uploads` | Upload one local image (raw body) |
| GET | `/api/collages/{id}/photos/{photoId}/file` | Image bytes (immutable cache) |
| DELETE | `/api/collages/{id}/photos/{photoId}` | Delete photo row and file |
| GET, POST | `/api/connectors` | List, create |
| PUT, DELETE | `/api/connectors/{id}` | Update, delete |
| POST | `/api/connectors/{id}/test` | Test the connection |
| GET | `/api/connectors/{id}/immich/albums` | Immich albums |
| GET | `/api/connectors/{id}/immich/albums/{albumId}/assets?page=N` | Album assets (images, paged); items `{id, fileName, width, height, mimeType}` (`mimeType` = Immich original MIME type) |
| GET | `/api/connectors/{id}/immich/assets/{assetId}/thumbnail` | Proxied thumbnail |
| GET | `/api/connectors/{id}/synology/albums` | Synology albums (Personal Space, all, sorted by name) `[{id, name, assetCount, thumbnailAssetId: null}]` |
| GET | `/api/connectors/{id}/synology/albums/{albumId}/assets?page=N` | Album photos (paged); items `{id, fileName, width, height, mimeType, thumbnailKey}` (`mimeType` from the file extension, can be `""`), `nextPage` |
| GET | `/api/connectors/{id}/synology/shared-albums` | Albums shared with the account (all, sorted by name; same shape as `albums`, no passphrase) |
| GET | `/api/connectors/{id}/synology/shared-albums/{albumId}/assets?page=N` | Shared album photos (paged, same shape as album photos; `id` = `s:<albumId>:<itemId>`); unknown album → 404 |
| GET | `/api/connectors/{id}/synology/folders/{folderId}` | Folder (`folderId` = `root` or an id) with direct subfolders `{id, name, path, parentId, folders: [{id, name, path}]}` |
| GET | `/api/connectors/{id}/synology/folders/{folderId}/assets?page=N` | Direct photos of the folder (paged, same shape as album photos) |
| GET | `/api/connectors/{id}/synology/shared-space` | Shared Space access of the account `{available}` (NAS error 801 → `false`) |
| GET | `/api/connectors/{id}/synology/shared-space/folders/{folderId}` | Shared Space folder (same shape as `folders/{folderId}`) |
| GET | `/api/connectors/{id}/synology/shared-space/folders/{folderId}/assets?page=N` | Direct photos of the Shared Space folder (paged, same shape as album photos; `id` = `t:<itemId>`) |
| GET | `/api/connectors/{id}/synology/assets/{assetId}/thumbnail?key=<thumbnailKey>` | Proxied thumbnail (`m`); `assetId` = `<itemId>`, `s:<albumId>:<itemId>` or `t:<itemId>` (URL-encoded) |
| POST | `/api/connectors/{id}/googlephotos/picks` | Start a pick → 201 `{pickId, openUrl}` (`openUrl` = Google sign-in URL, or `<pickerUri>/autoclose` with a cached token); more than 20 open picks → 429 |
| GET | `/api/connectors/{id}/googlephotos/picks/{pickId}` | Pick state; polls Google while `picking` → `{status: "signin"\|"picking"\|"done"\|"error", pollIntervalMs, error?, items: [{id, fileName, width, height, mimeType}], skippedVideos}` (`items` empty unless `done`; `mimeType` = original MIME type); unknown, expired or foreign pick → 404 |
| DELETE | `/api/connectors/{id}/googlephotos/picks/{pickId}` | Remove the pick and its Google picker session → 204 |
| GET | `/api/connectors/{id}/googlephotos/picks/{pickId}/items/{itemId}/thumbnail` | Proxied thumbnail (`=w400-h400`) |
| GET | `/api/googlephotos/oauth/callback?code&state[&error]` | OAuth redirect target (popup, needs the session): 302 to `<pickerUri>/autoclose`, or HTML failure page (400) |

Unknown `/api/...` paths always return a JSON 404, never the SPA.

## Domain terms

- **Collage / Page:** one page (size in mm, DPI for export) with photos and texts, owned by one user.
- **Frame:** the rectangle of a photo on the page. **Crop:** the visible part of the source image.
- **Cover:** crop with the frame aspect, as large as possible (frame filled, image cut).
- **Arrangement / mode:** algorithm that sets all frames at once (`grid`, `center`, `heap` = random heap,
  `masonry` = justified rows or columns, free placement).
- **Connector:** a configured external photo source of a user (`immich`, `synology` or `googlephotos`).
- **Personal Space (Synology):** the own photos (folder tree) and own albums of the account in Synology
  Photos.
- **Shared Space / Team Space (Synology):** a folder tree of Synology Photos that the NAS admin shares
  with several users (`SYNO.FotoTeam.*`). Read access is a permission of the account (no passphrase).
- **Shared with me album (Synology):** an album of another NAS user that is shared with the connector
  account. Read with its **passphrase** (share token), which never leaves the server.
- **Picker session (Google):** a Google `PickingSession` (`id`, `pickerUri`): one selection round in
  Google's picker page.
- **Pick (Google):** the in-memory record of one picker session (`pickId`, user, connector, Google session
  id, status, picked photos). One import dialog can have several picks ("Pick more photos").
- **Media item / baseUrl (Google):** a picked Google photo (`PickedMediaItem`); its `id` is the asset id
  (`photos.source_asset_id`). `baseUrl` is its short-lived (60 min) download URL; it needs the access token
  and a size suffix (`=w…-h…`, `=d`).
- **Layout:** collage settings + all photo props + all texts, saved together.
- **Drop shadow (photo):** drawn by an unclipped rect under the clipped photo content
  (`canvas/photo-view.ts`); offset is not rotated with the photo (same light direction for all).
