# Synology connector

**Ticket/Source:** none (idea of the developer, 2026-11-16: "Synology connector: like the immich connector,
but for Synology Photo stations")
**Branch:** none — work directly on `main` (decision of the developer)
**Status:** done

## Goal

A second connector type besides Immich: the user configures a Synology NAS (DSM 7, app "Synology Photos") as
a photo source and imports photos from it into a collage, the same way as from Immich: browse own albums
**and folders** of the Personal Space, select photos, import them in preview or original size.

## Scope

**In scope:**
- New connector type `synology` in the connector settings (create, edit, test connection). Config: NAS URL,
  account, password, "skip TLS verification" option.
- Browse the **Personal Space** of the account: own albums (flat list) and the folder tree (subfolders +
  photos of the current folder, breadcrumb navigation).
- Thumbnails in the import dialog (proxied by the backend).
- Import of selected photos in preview size (`xl` thumbnail, short side 1280 px) and original size (original
  file; fallback to `xl` if the backend cannot decode the original).
- Editor toolbar: the "Import from Immich" button becomes an "Import" menu that lists the user's connectors
  (changed after review, see decision log "Import menu lists connectors").

**Out of scope:**
- Photo Station (DSM 6) and any DSM older than 7.
- 2-factor authentication (OTP, device token). Accounts with 2FA get a clear error message.
- Albums shared with the account ("Shared with me", `SYNO.Foto.Sharing.Misc`), public share links
  (passphrase), the Shared Space / Team Space (`SYNO.FotoTeam.*`).
- Timeline, persons, places, tags, search, conditional-album special handling (they are listed like normal
  albums, see decision log).
- Videos (hidden). Write access to the NAS. Sync of later changes on the NAS.
- Album covers (the API has no cover field; icons are shown).

## Rough Architecture / Concept

- **Backend package** `backend/internal/connector/synology/`, built like `backend/internal/connector/immich/`:
  `kind.go` (implements `connector.Kind`), `client.go` (HTTP client of the Synology Web API with session
  handling), `types.go`, `service.go` (albums, folders, items, thumbnail proxy, `photo.Source`),
  `handler.go` (routes `/api/connectors/{id}/synology/...`). Registered in `backend/cmd/collageomat/main.go`.
  The browser never talks to the NAS; the Go server is the proxy.
- **Auth:** account + password → `SYNO.API.Auth` login with `format=sid` → session id `sid`, sent as `_sid`
  form parameter in every request. Sessions are cached in memory per connector and renewed automatically when
  the NAS reports an expired/invalid session.
- **Import dispatch:** `photo.NewService` takes one `photo.Sources`. A small dispatcher (new) looks up the
  connector type and delegates to `immich.Service` or `synology.Service`.
- **Frontend:** new connector type `synology` with its own config form; a **separate** Synology import dialog
  (albums/folders tabs, folder navigation). The presentational components `asset-grid` and `album-list` are
  **shared** with the Immich dialog through neutral types and a thumbnail-URL input.
- *Why:* follows the existing `connector.Kind` registry pattern (a new type = a new Kind, no change to
  `connector.Service`); no new libraries; separate dialog keeps the Immich flow stable while the Synology
  dialog has its own folder navigation; shared grid/list avoids duplicating ~200 lines of selection UI.

## Context for a new agent

### Sources read (summarized)

**1. Official "DSM Login Web API Guide"** (Synology, last updated 2023-04-19, applies to DSM 7;
PDF: https://global.download.synology.com/download/Document/Software/DeveloperGuide/Os/DSM/All/enu/DSM_Login_Web_API_Guide_enu.pdf):
- Request: `/webapi/entry.cgi?api=<API>&version=<V>&method=<M>[&params][&_sid=<sid>]`. GET or POST. If
  `SYNO.API.Info` says `"requestFormat":"JSON"` for an API, parameter values are JSON-encoded (strings may be
  quoted; verified: unquoted values also work for the calls below).
- Response: `{"success":true,"data":{...}}` or `{"success":false,"error":{"code":N}}` — **also with HTTP 200**.
  Downloads (thumbnail, file) return the binary body instead of JSON.
- `SYNO.API.Info` `query` (`query=all`) at `/webapi/entry.cgi` (no login) lists path, minVersion,
  maxVersion of all APIs.
- `SYNO.API.Auth` (versions 3–7, 6 recommended), method `login`: `account`, `passwd`, optional `session`,
  `format` (`cookie` default | `sid`), `otp_code`, `enable_syno_token`, `enable_device_token`,
  `device_name`, `device_id`. Response `data`: `sid`, `did`, `synotoken` (only with
  `enable_syno_token=yes`). Method `logout`.
- Common error codes: 100 unknown, 101 missing api/method/version, 102 API does not exist, 103 method does
  not exist, 104 version not supported, 105 no permission, **106 session timeout, 107 session interrupted by
  duplicate login**, 108–118 misc/busy, **119 invalid session**, 150 source IP does not match login IP.
- Auth error codes: **400 no such account or incorrect password, 401 disabled account, 402 denied
  permission, 403 2FA code required, 404 2FA code failed, 406 2FA enforced, 407 blocked IP source**, 408
  expired password cannot change, 409 expired password, 410 password must be changed.
- No API keys / app passwords exist for DSM (not in the guide; a third-party source states DSM has no app
  passwords). `SYNO.API.Auth.Key` exists on the test NAS, purpose unknown — not used.

**2. Community docs of the undocumented `SYNO.Foto.*` API** (used as starting point, then verified live):
https://github.com/zeichensatz/SynologyPhotosAPI, https://github.com/N4S4/synology-api
(`synology_api/photos.py`), https://docs.rs/nology-api/0.0.2/src/nology_api/album.rs.html,
https://github.com/rsov/synology-photo-frame (`src/synology.rs`). Issue #19 of zeichensatz reports that on
DSM 7.3.2 the FotoTeam thumbnail needed the path `/synofoto/api/v2/t/Thumbnail/get`; **on the test NAS the
normal `/webapi/entry.cgi` works for `SYNO.Foto.Thumbnail`**.

**3. Live probe against the test NAS (2026-11-16, read-only calls, account of the developer).** These are the
verified facts the implementation relies on:

| Call | Verified behaviour |
|---|---|
| `SYNO.API.Info` | `/webapi/entry.cgi` and `/photo/webapi/entry.cgi` give the same answer. Max versions: `SYNO.API.Auth` 7, `SYNO.Foto.Browse.Album` 5, `SYNO.Foto.Browse.Item` 7, `SYNO.Foto.Browse.Folder` 2, `SYNO.Foto.Thumbnail` 2, `SYNO.Foto.Download` 2, `SYNO.Foto.UserInfo` 1, `SYNO.Foto.Sharing.Misc` 2. All at path `entry.cgi`, `requestFormat` JSON. |
| Login | POST `/webapi/entry.cgi`: `api=SYNO.API.Auth&version=6&method=login&format=sid&account=..&passwd=..` → `data.sid`, `data.did`, `data.is_portal_port`. **With `session=<custom name>` the login fails with code 402** → do not send `session`. The account has access to the Photos app only (no DSM desktop) and the login works. |
| Session | `_sid=<sid>` as form/query param is enough (no `SynoToken`, no cookie). Invalid or missing sid → `{"success":false,"error":{"code":119}}`, also from the thumbnail URL (HTTP 200, `application/json`). Logout: `api=SYNO.API.Auth&version=6&method=logout&_sid=..` → `{"success":true}`. |
| Album list | `api=SYNO.Foto.Browse.Album&version=1&method=list&offset=0&limit=100` (v1 and v5 identical). Item fields: `id` (int), `name`, `item_count`, `type` (`normal` / `condition`), `shared`, `passphrase`, `owner_user_id`, `create_time`, `start_time`, `end_time`, `sort_by`, `sort_direction`, ... **No cover field.** **`limit=0` returns an empty list** → always page with a limit. |
| Album items | `api=SYNO.Foto.Browse.Item&version=1&method=list&album_id=42&offset=0&limit=100&additional=["thumbnail","resolution","orientation"]` (v1 = v7). **The album param is `album_id`; with `id=42` the filter is silently ignored and the whole library is returned.** Item: `id` (int), `filename`, `filesize`, `time`, `folder_id`, `owner_user_id`, `type` (`photo`; community docs: also `video`, `live`), `additional.resolution.{width,height}` (= displayed size, EXIF rotation already applied), `additional.orientation`, `additional.thumbnail.{cache_key, unit_id, sm, m, xl, preview}` (sizes are `"ready"`/`"broken"`; `preview` was always `"broken"`). |
| Folders | `api=SYNO.Foto.Browse.Folder&version=2&method=get` without `id` → root folder `{"folder":{"id":978,"name":"/","parent":978,...}}` (root's `parent` = its own id). `method=get&id=980` → `{"folder":{"id":980,"name":"/Ordner 1/Sub-Ordner 1","parent":979,...}}` (`name` is the full path). `method=list&id=979&offset=0&limit=100` → direct subfolders `{"list":[{"id":980,"name":"/Ordner 1/Sub-Ordner 1","parent":979,...}]}`; without `id` → children of root. `method=count&id=978` → `{"count":1}`. |
| Folder items | `SYNO.Foto.Browse.Item` `list` with `folder_id=<id>` → **only the direct photos** of that folder (not recursive; test library: 12 + 6 + 7 = 25 = all). `method=count&folder_id=978` → `{"count":12}`. |
| Thumbnail | GET `api=SYNO.Foto.Thumbnail&version=2&method=get&id=271530&cache_key="271530_1649087747"&type="unit"&size="m"&_sid=..` → `image/jpeg`, `Content-Disposition: inline; filename="1772.jpg"`. Sizes: short side `sm` 240, `m` 320, `xl` 1280 (e.g. 6000×4000 → xl 1920×1280); **no upscaling** (499×333 stays 499×333 in xl). Thumbnails are **already rotated** (no EXIF). `cache_key` is **not validated** (a wrong key returns the same image) — it only busts caches. Unquoted values (`type=unit&size=m`) also work. |
| Original | POST `api=SYNO.Foto.Download&version=2&method=download&unit_id=[271530]&_sid=..` → raw original file (`image/jpeg`, `Content-Disposition: inline; filename="1772.jpg"`), with EXIF orientation (stored pixels 1181×1772, orientation 6). v1 = v2. **Two ids → `application/zip` `download.zip`.** Unknown id → HTTP 200 `{"success":false,"error":{"code":117}}`. |
| Other | `SYNO.Foto.UserInfo` `me` → user info (`data.name`, `data.is_admin`, ...). `SYNO.Foto.Sharing.Misc` `list_shared_with_me_album` (v2) works (0 albums). `SYNO.FotoTeam.Browse.Folder` `list` → error `801` (no Shared Space access). |

Test library on the NAS: 25 JPEG photos (no HEIC, no video, no Live Photo), 1 album "Testalbum 1" (id 42,
4 photos), folders `/`, `/Ordner 1`, `/Ordner 1/Sub-Ordner 1`. Some photos have EXIF orientation 6.

### Key files and directories
- `backend/internal/connector/kind.go` — `connector.Kind` interface (`Type`, `BuildConfig(input, stored)`,
  `PublicConfig(stored)`, `Test(ctx, stored)`), `TestResult{OK, ServerVersion, Error}`, `Registry`.
- `backend/internal/connector/service.go` — `connector.Service` (ownership, name, `secretbox` encryption,
  storage); `LoadConfig(ctx, userID, id) (Connector, json.RawMessage, error)`.
- `backend/internal/connector/immich/` — the pattern to copy: `kind.go` (`Config`, `publicConfig`,
  `decodeInput` with `DisallowUnknownFields`, `normalizeURL`, empty key keeps stored one), `client.go`
  (`StatusError`, `NewHTTPClient` with same-host redirects only, `doJSON` checks Content-Type is JSON,
  `maxJSONResponse` limit), `service.go` (`Connectors` interface, `client()` checks `c.Type`, `Thumbnail`
  rejects non-image Content-Type, `Source` → `imageSource.Image`, `upstream(err)` → `apperr.Upstream`),
  `handler.go` (routes, `albumResponse`, `assetResponse`, `assetPageResponse`, `pageParam`, thumbnail
  headers `Cache-Control: private, max-age=86400`, `X-Content-Type-Options: nosniff`).
- `backend/internal/photo/service.go` — `photo.Sources` (`Source(ctx, userID, connectorID) (Source, error)`),
  `photo.Source` (`Image(ctx, assetID, size) (SourceImage, error)`), `SourceImage{Body, ContentType,
  Fallback}`, `ImageSize` (`SizePreview`, `SizeOriginal`), `download()` (original → `processOriginal`,
  preview/fallback → `readPreview`), `ImportResult.PreviewFallbacks`.
- `backend/internal/imaging/imaging.go` — decodes only `image/jpeg`, `image/png`, `image/webp`; handles EXIF
  orientation; pixel limit `imaging.MaxPixels` (60 MP).
- `backend/cmd/collageomat/main.go` — composition root: `immich.NewKind(nil)`,
  `newConnectorService(secret, gdb, immichKind)`, `immich.NewService(connectorSvc, immichKind)`,
  `photo.NewService(photoStore, photoFiles, collageSvc, immichSvc, decoder)`, handler list with
  `immich.NewHandler(immichSvc)`.
- `frontend/src/app/core/models/connector.ts` — `ConnectorType = 'immich'`, `ImmichPublicConfig`,
  `ImmichConfigInput`, unions `ConnectorPublicConfig` / `ConnectorConfigInput`.
- `frontend/src/app/core/models/immich.ts` — `ImmichAlbum`, `ImmichAsset`, `ImmichAssetPage`,
  `immichThumbnailUrl()`.
- `frontend/src/app/core/api/immich.api.ts` — `ImmichApi.albums()`, `.assets()`.
- `frontend/src/app/features/connectors/` — `connector-types.ts`, `connector-dialog.ts`,
  `immich-config-form.ts`, `connectors.page.*`.
- `frontend/src/app/features/editor/import/` — `import-dialog.{ts,html,scss}` (Immich dialog: album →
  assets for the connector from `ImportDialogData.connector`, paging, selection, size toggle stored in localStorage `collageomat.importSize`),
  `album-list.ts`, `asset-grid.ts`, `original-size.ts` (`supportsOriginalSize`),
  `import-result-message.ts`. (`connector-list.ts` was deleted after review: the menu lists connectors.)
- `frontend/src/app/features/editor/editor.page.{ts,html}` — `importLabel` (`@@editor.importMenu.button`,
  since step 3), toolbar button with the `importMenu` `mat-menu` (step 3), connector entries loaded in
  `loadImportConnectors()` on `menuOpened`, `openImport(connector)` (change after review).
- `frontend/src/app/core/models/source.ts` — neutral `SourceAlbum`, `SourceAsset`, `SourceAssetPage<T>`
  (step 3).
- `doc/architecture.md` — architecture, data model, API table (update in step 5).

### Existing patterns to follow
- Immich connector (backend and frontend) for every part; `doc/architecture.md` for layering (handler →
  service → client/store, `apperr` errors, `httpapi` helpers; `HttpClient` only in `core/api/`).
- All UI texts English with i18n ids (`i18n="@@<feature>.<key>"`, `$localize`).

### Commands
```sh
make dev-up && make dev-shell                 # host: start + enter the dev container
make backend-run                              # container: Go server on :8080
make frontend-serve                           # container: ng serve on :4200 (proxy /api -> :8080)
cd backend && go build ./... && go vet ./...  # backend verification
cd frontend && npx ng build                   # frontend verification
```

### Environment / prerequisites
- Test NAS: `https://bollyeahnas.synology.me:60333` (Synology Photos also reachable at `/photo/`). The
  developer has an account with access to the Photos app only. Credentials are never written to files in the
  repo; the developer enters them in the connector form.
- Manual probing with curl: send the password with `--data-urlencode "passwd@<file>"`, never on the command
  line; keep the sid out of logs; log out after probing.

### Domain terms
- **Personal Space**: the user's own photos in Synology Photos (folder tree under the user's `Photos` home
  folder) and own albums. API family `SYNO.Foto.*`.
- **Shared Space / Team Space**: shared photo folder, API family `SYNO.FotoTeam.*` (out of scope).
- **Item / unit**: a photo/video in Synology Photos; for thumbnails/downloads the `unit_id` equals the item
  `id` for normal photos.
- **cache_key**: `<id>_<timestamp>` from `additional.thumbnail.cache_key`, used as cache buster.
- **sid**: DSM session id from the login.

### External references
- DSM Login Web API Guide (DSM 7, 2023-04-19) — URL above.
- https://github.com/zeichensatz/SynologyPhotosAPI (incl. issue #19) — unofficial.
- https://github.com/N4S4/synology-api — unofficial (Python).
- https://docs.rs/nology-api/0.0.2/src/nology_api/album.rs.html — unofficial (Rust); source of
  `album_id` and `list_shared_with_me_album`.
- https://github.com/rsov/synology-photo-frame — unofficial (Rust), login `format=sid`, `_sid` param.

## Decision log

- **Product:** Synology Photos on DSM 7.x only — *Rationale:* Photo Station is legacy (DSM 6); the developer
  asked for the "new Synology" (DSM ≥ 7).
- **Authentication:** account + password only, no 2FA support; the UI recommends a dedicated NAS user with
  read access to Photos and without 2FA — *Rationale:* DSM has no API keys/app passwords; 2FA with device
  tokens adds UI flow and failure states; a dedicated read-only user limits damage if the stored password
  leaks. *Rejected:* optional 2FA with OTP + stored device token (`did`) — too complex for now.
- **Login details:** `SYNO.API.Auth` version 6, POST to `/webapi/entry.cgi`, `format=sid`, no `session`
  param (a custom session name gives 402), no `enable_syno_token` — *Rationale:* verified on the test NAS;
  POST keeps the password out of URLs/logs.
- **Session handling:** sid cached in memory per connector (keyed by connector id and invalidated when the
  stored config changes, e.g. compare a hash of the config); one login at a time per connector (mutex); on
  error code 106, 107 or 119 log in again **once** and repeat the request; **no automatic retry after login
  errors** (400, 401, 402, 403, 404, 406, 407, 408–410) — *Rationale:* DSM auto-block blocks the server IP
  after repeated failed logins (407).
- **Login error messages** (for the connector test and upstream errors): 400 "wrong account or password",
  401 "account is disabled", 402 "account has no permission", 403/404/406 "account uses 2-factor
  authentication; use an account without 2FA", 407 "the NAS blocked this server's IP address (auto-block)",
  408–410 "the password of the account has expired / must be changed". Exact texts are decided in step 1.
- **Sources:** Personal Space only: own albums + folder tree — *Rationale:* many Synology users organise
  photos only in folders, albums alone would show nothing for them. *Rejected / out of scope:* albums shared
  with me (test account has none, can come later), Shared Space (`SYNO.FotoTeam`, test account gets 801).
- **Conditional albums** (`type: "condition"`): listed like normal albums; their items are listed with the
  same `album_id` call. If that does not work on the NAS, they are hidden (decide in step 2, record here).
- **Frontend structure:** separate Synology import dialog; `asset-grid` and `album-list` are shared through
  neutral types and a thumbnail-URL input; the Immich dialog changes only in types/imports, not in
  behaviour — *Rationale (developer):* keep the Immich flow stable, Synology needs folder navigation.
  *Rejected:* one shared dialog with per-type adapters (developer's choice); fully separate copy of grid and
  list (duplication of selection UI).
- **Toolbar (superseded by "Import menu lists connectors"):** the "Import from Immich" button becomes an "Import" button that opens a menu with "Immich" and
  "Synology"; each entry opens its dialog — *Rationale:* developer's choice; one toolbar icon for all
  connector imports. *Rejected:* separate toolbar button per type; buttons only for types the user has.
- **Album cover:** none; `album-list` shows the `photo_album` icon (existing fallback); folders show the
  `folder` icon — *Rationale:* the album list API has no cover field; a cover would cost one NAS request per
  album.
- **TLS:** per-connector option "Skip TLS certificate verification", off by default, with a warning text in
  the form — *Rationale (developer):* home NAS devices often use self-signed certificates. Implementation:
  two shared `*http.Client`s (normal, and one with `InsecureSkipVerify`), chosen per connector config;
  redirects only to the same host, like Immich.
- **Config shape:** stored `{"url","account","password","skipTlsVerify"}`; public `{"url","account",
  "passwordSet","skipTlsVerify"}`; input `{"url","account","password","skipTlsVerify"}` with
  `DisallowUnknownFields`. URL: http(s), no user info/query/fragment; **stored as `scheme://host[:port]`, any
  path (e.g. `/photo/`) is removed**. Account required. Password required on create; on update an empty
  password keeps the stored one (like the Immich API key).
- **Connector test:** login, then `SYNO.Foto.Browse.Album` `list` with `limit=1` (checks Photos access);
  `ServerVersion` empty. A failed check is `TestResult{OK:false, Error:<message>}`.
- **Item filter:** `photo` and `live` items are shown; `video` and any other type are hidden. Order = NAS
  default order (no `sort_by`).
- **Paging:** albums and folder children: the backend loads all pages (limit 500 per request) and returns
  one list sorted by name (case-insensitive). Items: pages of 250 for the frontend (`?page=N`, 1-based); the
  backend requests `limit=251` to know whether a next page exists and returns `nextPage` (null on the last
  page) — same response shape as Immich.
- **Asset id:** the Synology item `id` as decimal string; stored in `photos.source_asset_id`. Thumbnail
  route takes the `cache_key` as query param `key` (passed through to the NAS) so that the browser cache
  changes after an edit on the NAS.
- **Image sizes:** grid thumbnail = `m`; preview import = `xl` (`SourceImage.Fallback=false`); original
  import = `SYNO.Foto.Download` with exactly one `unit_id` (raw file). If the original's Content-Type is not
  `image/jpeg`, `image/png` or `image/webp` (HEIC, Live Photo, ZIP, ...), the source closes it and returns
  the `xl` thumbnail with `Fallback=true` (existing "preview fallback" message in the UI). A JSON body
  (error) is an upstream error. Frontend: a Synology photo is "unavailable in original" only if
  `width*height > 60 MP`.
- **Import dispatch:** a small dispatcher implementing `photo.Sources` loads the connector (via
  `connector.Service`), switches on `Connector.Type` and calls `immich.Service.Source` or
  `synology.Service.Source`; unknown types give an `apperr` validation error — *Rationale:* `photo` stays
  independent of connector types. Location decided in step 4 (e.g. `backend/internal/connector/sources.go`
  or `main.go`).
- **Login failure cooldown (decided 2026-11-16, implement in step 2):** after a failed login (auth error
  400–410 or any login failure), the session of the connector remembers the error for **1 minute**; all
  requests in that time fail fast with the same user-safe message, without contacting the NAS. After
  1 minute the next request logs in again. A config change (new session cache key) clears it. The connector
  test (own session) is not affected. — *Rationale (developer):* fastest recovery; a wrong password gives
  at most about 1 failed login per minute, which limits the DSM auto-block risk. *Rejected:* until config
  change (needs a re-save after a fix on the NAS side); until config change or 5 minutes.
- **Workflow (developer, 2026-11-16):** implement all steps one after another with sub-agents, without a
  review stop after each step; the developer tests at the end. Stop and ask only for real decisions.
- **Branch:** no feature branch, work on `main`; no commits unless the developer asks.
- **Connector test session (step 1):** `Kind.Test` logs in with its own session (not the cached one),
  reads one album and logs out — *Rationale:* `connector.Kind.Test` gets no connector id, so it cannot use
  the per-connector cache; a fresh login also checks the stored password every time. Changing the
  `connector.Kind` interface was rejected (would touch Immich).
- **Session cache details (step 1):** the cache is in the `synology.Kind` (in memory, map connector id →
  session + `Config`); a different `Config` replaces the entry without logout of the old sid (the old
  credentials may be invalid). Entries of deleted connectors stay in memory until restart (tiny).
- **Login messages (step 1, final texts):** prefix "Synology login failed: " + 400 "wrong account or
  password", 401 "the account is disabled", 402 "the account has no permission to log in", 403/404/406
  "the account uses 2-factor authentication; use an account without 2-factor authentication", 407 "the
  NAS blocked the IP address of this server (auto-block); unblock it in DSM", 408–410 "the password of
  the account has expired or must be changed", other "error code N". API errors: 105 no permission,
  106/107/119 session no longer valid, 102–104 "Synology Photos on DSM 7 is needed", other "Synology
  request <api> failed (error code N)". Transport errors never contain the request URL (it can contain
  the sid); a TLS certificate error adds a hint to the skip-TLS option.
- **Password handling (step 1):** the password is not trimmed (spaces can be part of it); the account is
  trimmed.
- **Add connector UI (step 1):** the "Add connector" button opens a `mat-menu` with the connector types
  (Immich, Synology); the dialog gets the type from the page — *Rationale:* the create dialog had no type
  choice; a menu mirrors the planned "Import" menu and keeps the dialog unchanged.
- **Testing:** no automated tests (project rule in `AGENTS.md`); verification by builds + manual tests
  against the test NAS.
- **Login cooldown details (step 2):** implemented in `session` (`loginCooldown = 1 min`). Every failed
  login counts (auth error codes, transport errors, missing sid), also the re-login after 106/107/119. In
  the cooldown, `session.get` returns the stored error (same message) without a NAS request; a successful
  login clears it. The connector test uses its own `session`, so it is not affected.
- **Shared grid/list types (step 3):** `AssetGrid<T extends SourceAsset>` and `AlbumList<T extends
  SourceAlbum>` are generic components; the type-specific DTO extends the neutral type (Synology:
  `SynologyAsset extends SourceAsset` with `thumbnailKey`), and the thumbnail/cover URL comes in as a
  function input typed with `T`, so step 4 needs no casts. *Rejected:* non-generic inputs with
  `SourceAsset` (Synology would need a cast for `thumbnailKey`); passing the connector type into the grid.
- **Original-size check (step 3):** `original-size.ts` is neutral in its input type (`SourceAsset`) and
  exports `withinOriginalPixelLimit` (60 MP only) besides the Immich rule `supportsOriginalSize`. The
  Synology dialog builds its own `unavailableIds` set with `withinOriginalPixelLimit` (decision log "Image
  sizes": Synology is unavailable only over 60 MP) and passes it to the grid as before.
- **Import menu (step 3):** the button keeps its icon and primary style; label "Import" (new i18n id
  `@@editor.importMenu.button`), entries "Immich" / "Synology" (ids `@@editor.importMenu.immich` /
  `.synology`); the entries are always shown (Synology disabled until step 4), independent of which
  connectors the user has (as decided in "Toolbar"). *Superseded by "Import menu lists connectors".*
- **Import menu lists connectors (developer, 2026-11-16):** the "Import" menu lists the user's connectors
  (one entry per connector, name + type label as secondary text, API order) instead of the connector
  types. The list is loaded with `ConnectorApi.list()` each time the menu opens (`menuOpened`), so
  changes in the settings show without reload. While loading: one disabled entry "Loading connectors…";
  on error: one disabled entry "Connectors could not be loaded: <message>"; no connectors: entry "Add a
  connector" → `/settings/connectors`. An entry opens the dialog of the connector's type with the chosen
  connector (`ImportDialogData.connector`); both dialogs start at the album (Immich) or albums/folders
  (Synology) step, the connector-choice step is removed (`connector-list.ts` deleted). — *Rationale
  (developer):* one click less; the user sees directly which connectors exist; a type entry without a
  connector led to an empty dialog. Supersedes "Toolbar" and "Import menu (step 3)".
- **Preview thumbnail key (step 4):** the import gets only asset ids, so the `xl` thumbnail is requested
  with the derived cache key `<id>_0` (the NAS does not validate `cache_key`, verified live) instead of
  loading the item for its real key — *Rationale:* simplest; no extra NAS request and no change of the
  import API. *Rejected:* `SYNO.Foto.Browse.Item get` per photo (extra request, unverified method);
  sending the keys with the import request.
- **Import dispatcher location (step 4):** `photo.SourcesByType` in `backend/internal/photo/sources.go`,
  configured in `main.go` with a map connector type → `photo.Sources` — *Rationale:* `connector` cannot
  import `photo` (import cycle, `photo` imports `connector`); `main.go` is wiring only
  (`doc/architecture.md`); the map keeps `photo` free of concrete connector types. It loads the connector
  once for the type; the delegated service loads it again (one extra DB read per import).
- **Asset id form (step 4):** the import accepts only canonical decimal ids (`strconv.FormatInt(id) ==
  assetID`), so one photo always has one `source_asset_id` and "Imported" marks stay correct.
- **Synology dialog details (step 4):** tabs with `mat-tab-nav-bar` (like the admin page), hidden while an
  album is open; the folder breadcrumb is built from the visited path (the API gives only `parentId`), the
  root is always requested as `root` (listing the root's children with its numeric id is unverified);
  changing album, folder or tab clears the selection; the album list is cached per connector, the folder
  is reloaded when the tab is opened again. Root label "Personal Space".
- **Shared import code (step 4):** size storage moved to `import-size.ts`; `AssetGrid.unavailableReason`
  became an input (default = Immich text); the request/loading helper (`load`, `cancelLoad`) and the
  selection bar markup are duplicated in the Synology dialog (the Immich dialog stays unchanged in
  behaviour, as decided in "Frontend structure").
- **Ids in the browse API (step 2):** album, folder and asset ids are **decimal strings** in JSON (same JSON
  type as the Immich ids, so the shared frontend types of step 3 fit). Path params are parsed as positive
  int64; invalid → 400.
- **Asset field set (step 2, final):** `{id, fileName, width, height, mimeType, thumbnailKey}`. `width`/
  `height` = `additional.resolution` (displayed size). `mimeType` from the file extension with a fixed map
  (`.jpg/.jpeg` → `image/jpeg`, `.png`, `.webp`, `.gif`, `.bmp`, `.tif/.tiff` → `image/tiff`, `.heic`,
  `.heif`, `.avif`), otherwise `""` (e.g. RAW); no `mime.TypeByExtension` (depends on the OS tables).
  `thumbnailKey` = `additional.thumbnail.cache_key`. `orientation` is requested but not returned.
- **Conditional albums (step 2):** listed like normal albums; their items use the same `album_id` call.
  **Not verified** (no conditional album on the test NAS, no NAS access in step 2). If the developer finds
  that it does not work, filter `type == "condition"` out in `Service.Albums`.
- **Thumbnail key (step 2):** the query param `key` is required; it must be 1–100 characters of
  `[A-Za-z0-9_-]` (else 400 "invalid thumbnail key"). It is sent JSON-quoted as `cache_key`, with
  `type="unit"`, `size="m"`, `id=<item id>` (item id, not `unit_id`).
- **Root folder (step 2):** `folders/root` → `get` without `id`; response `id` = the real root id (e.g.
  `"978"`), `name` = `""`, `path` = `"/"`, `parentId` = `null` (root = `parent == id`, also when the root
  is requested by its number). Children of the root are listed without `id` (verified form).
  `folders/root/assets` first reads the root folder to get its id (one extra NAS request), then
  `folder_id=<root id>`.
- **Limits (step 2):** album/folder lists stop after 100 pages of 500 (50,000 entries) with an upstream
  error (protection against a NAS that ignores `offset`); item pages are limited to `page ≤ 1,000,000`
  (offset overflow).

## Testing strategy

No automated tests, manual review only. After every step: `cd backend && go build ./... && go vet ./...`
and `cd frontend && npx ng build`, then the manual test steps of that step against the test NAS
`https://bollyeahnas.synology.me:60333` with the developer's account.

## Steps

### Step 1 — Synology client, Kind and connector settings
- **Status:** done (reviewed 2026-11-16)
- **What:**
  - Backend `backend/internal/connector/synology/`: `client.go` (POST/GET to `<url>/webapi/entry.cgi`,
    JSON envelope `success`/`data`/`error.code`, Content-Type checks, size limit, login/logout, session
    cache + one re-login on 106/107/119, error type with user-safe messages that never contain password or
    sid), `kind.go` (`Type() = "synology"`, `Config`, `BuildConfig`, `PublicConfig`, `Test`, HTTP client
    choice by `skipTlsVerify`), `types.go`. Register the Kind in `newConnectorService` in
    `backend/cmd/collageomat/main.go`.
  - Frontend: `ConnectorType` gets `'synology'`; `SynologyPublicConfig`, `SynologyConfigInput` in
    `core/models/connector.ts`; new `features/connectors/synology-config-form.ts` (URL, account, password,
    "Skip TLS certificate verification" checkbox with warning, hint "use a dedicated NAS account without
    2-factor authentication"); register it in `connector-types.ts` / `connector-dialog.ts`.
- **Acceptance criteria:** In the connector settings, create a Synology connector with
  `https://bollyeahnas.synology.me:60333/photo/` → stored URL shown without `/photo`. "Test" gives OK. Edit
  with an empty password keeps the password (Test still OK). Wrong password → clear error, no repeated
  login attempts. Builds and vet pass.
- **Notes:**
  - Created `backend/internal/connector/synology/`:
    - `types.go` — API names/versions (`SYNO.API.Auth` v6, `SYNO.Foto.Browse.Album` v1), error code
      constants, `envelope`, `loginData`.
    - `client.go` — `Client` (`newClient(cfg, httpClient, session)`), `NewHTTPClient(skipTLSVerify)`
      (30 s timeout, same-host redirects only), `APIError{API, Code, Login}` with user-safe messages,
      `StatusError`, `isSessionError` (106/107/119). Extension points for steps 2–4:
      `call(ctx, params) (json.RawMessage, error)` (POST form, JSON envelope → `data`) and
      `download(ctx, httpMethod, params) (body, contentType, error)` (GET = query, POST = form; a JSON
      answer is an error); build params with `apiParams(api, version, method)`. Both go through
      `withSession` (gets a sid, one re-login + repeat on 106/107/119, login errors are never retried).
      `probeAlbums` (album list `limit=1`), `Logout`. `download` is not used yet.
    - `session.go` — `session` (sid + one login at a time: callers that arrive while a login runs wait
      for it and get the same result, also a failure; the login runs with `context.WithoutCancel`),
      `sessionCache` (one session per connector id, replaced when the `Config` struct differs = any
      change of URL, account, password or TLS option).
    - `kind.go` — `Type = "synology"`, `Config`, `publicConfig`, `NewKind()` (two shared HTTP clients),
      `BuildConfig`, `PublicConfig`, `Test`, `Client(connectorID, stored)` (for step 2), `ParseConfig`,
      `decodeInput`, `normalizeURL`.
  - Changed `backend/cmd/collageomat/main.go`: `synology.NewKind()` registered in `newConnectorService`.
  - Frontend: `core/models/connector.ts` (`ConnectorType` + `'synology'`, `SynologyPublicConfig`,
    `SynologyConfigInput`, unions; `ConnectorSummary` is now a discriminated union
    `ImmichConnectorSummary | SynologyConnectorSummary`); new
    `features/connectors/synology-config-form.ts`; `connector-types.ts` (`CONNECTOR_TYPES`, label
    "Synology"); `connector-dialog.ts` (data gets `type`; one typed config group per type, `@case`
    for `synology`); `connectors.page.{ts,html}` ("Add connector" opens a `mat-menu` with the types;
    empty text mentions Synology). Immich behaviour unchanged.
  - Small decisions (see decision log): connector test uses its own session + logout; session code in an
    extra file `session.go` (deviation from the file list); "Add connector" type menu; password is not
    trimmed; login-failure handling only for concurrent callers (open question below).
  - Verified with a temporary local Go test against an `httptest` server (deleted again): URL
    normalization, password keep-on-empty, re-login once on 119, wrong password → one login and the
    message "Synology login failed: wrong account or password", 20 concurrent calls with a wrong password
    → one login. Not yet tested against the real NAS.

### Step 2 — Backend browse routes
- **Status:** done (reviewed 2026-11-16)
- **What:** `service.go` + `handler.go` with routes (all need a session, connector must belong to the user and
  be of type `synology`):
  - `GET /api/connectors/{id}/synology/albums` → `[{id, name, assetCount, thumbnailAssetId: null}]`
  - `GET /api/connectors/{id}/synology/albums/{albumId}/assets?page=N` → `{items:[{id, fileName, width,
    height, mimeType, thumbnailKey}], nextPage}`
  - `GET /api/connectors/{id}/synology/folders/{folderId}` (`folderId` = `root` or a number) → `{id, name,
    path, parentId (null for root), folders:[{id, name, path}]}` (`name` = last path segment)
  - `GET /api/connectors/{id}/synology/folders/{folderId}/assets?page=N` → same page shape as albums
  - `GET /api/connectors/{id}/synology/assets/{assetId}/thumbnail?key=<cache_key>` → JPEG (`m`), headers like
    the Immich thumbnail proxy; non-image responses are rejected.
  - `mimeType` is derived from the file extension (may be empty) — final field set decided in this step and
    recorded in the notes.
- **Acceptance criteria:** logged in at `:4200`, the URLs return the album "Testalbum 1" (4 photos), the root
  folder with subfolder "Ordner 1" and 12 photos, a thumbnail image. Another user's connector id → 404.
- **Notes:**
  - Changed `backend/internal/connector/synology/session.go`: login failure cooldown (`loginCooldown`,
    fields `failErr`, `failUntil`; see decision log "Login cooldown details").
  - Changed `types.go`: API names/versions `SYNO.Foto.Browse.Item` v1, `SYNO.Foto.Browse.Folder` v2,
    `SYNO.Foto.Thumbnail` v2; types `Album`, `Item` (+ `itemAdditional`), `ItemPage`, `Folder`
    (`IsRoot()`), `FolderContent`, `listData[T]`, `folderData`; item type constants.
  - Changed `client.go`: `listAlbums`, `listItems(filterParam album_id|folder_id, ...)` with
    `additional=["thumbnail","resolution","orientation"]`, `getFolder` / `listFolders` (id 0 = root, no
    `id` param), `thumbnail(id, cacheKey, size)` (GET via `download`), helpers `setRange`, `callInto`.
  - New `service.go`: `Connectors` interface, `Service` / `NewService(connectors, kind)`, `Albums` (all
    pages, limit 500, sorted by name case-insensitive, then id), `AlbumItems`, `Folder`, `FolderItems`
    (pages of 250, request limit 251, filter `photo` + `live`), `Thumbnail` (size `m`, rejects non-image
    Content-Types; a JSON error body with HTTP 200 is already an error in `Client.download`), `client()`
    (type check → validation error), `RootFolderID`, `FolderName`, `MimeType`, `upstream`. No
    `photo.Sources` yet (step 4).
  - New `handler.go`: routes `GET /api/connectors/{id}/synology/albums`, `.../albums/{albumId}/assets`,
    `.../folders/{folderId}` (`root` or number), `.../folders/{folderId}/assets`,
    `.../assets/{assetId}/thumbnail?key=<cache_key>`; thumbnail headers like Immich
    (`Cache-Control: private, max-age=86400`, `X-Content-Type-Options: nosniff`). Response shapes:
    album `{id, name, assetCount, thumbnailAssetId: null}`; page `{items:[{id, fileName, width, height,
    mimeType, thumbnailKey}], nextPage}`; folder `{id, name, path, parentId, folders:[{id, name, path}]}`.
  - Changed `backend/cmd/collageomat/main.go`: `synology.NewService(connectorSvc, synologyKind)` and
    `synology.NewHandler(synologySvc)` in the module list.
  - Small decisions: see decision log entries "(step 2)". No deviation from the plan's route list.
  - Verified with a temporary Go test against an `httptest` fake NAS (deleted again, also a temporary
    export file in `internal/auth`): sent params (`album_id`, `folder_id`, `additional`, `limit=251`,
    `offset`, quoted `cache_key`/`type`/`size`), album paging over 620 albums + sort, item paging (300
    items → page 1 with `nextPage` 2, page 2 with `nextPage` null, videos removed), root/sub folder
    responses, thumbnail: JPEG passed, JSON error → 502, `text/html` → 502, missing/invalid key → 400,
    other user → 404, invalid ids/page → 400; cooldown: 5 calls with a wrong password → 1 login, after
    expiry → new login, config change → new login, `Kind.Test` logs in every time. Not tested against the
    real NAS.

### Step 3 — Frontend: shared grid/list and "Import" menu (no behaviour change)
- **Status:** done (reviewed 2026-11-16)
- **What:** neutral types (e.g. `SourceAlbum`, `SourceAsset`, `SourceAssetPage` in `core/models/`) used by
  `album-list.ts` and `asset-grid.ts`; the thumbnail URL comes in as an input function. The Immich dialog and
  Immich models adapt to them without behaviour change. Editor toolbar: "Import" button with `mat-menu`
  entries "Immich" (opens the existing dialog) and "Synology" (disabled until step 4).
- **Acceptance criteria:** Immich import works exactly as before, now opened from the "Import" menu. Build
  passes.
- **Notes:**
  - New `frontend/src/app/core/models/source.ts`: `SourceAlbum {id, name, assetCount}`, `SourceAsset {id,
    fileName, width, height, mimeType}`, `SourceAssetPage<T extends SourceAsset = SourceAsset> {items: T[],
    nextPage}`.
  - Changed `core/models/immich.ts`: `ImmichAlbum extends SourceAlbum` (+ `thumbnailAssetId`),
    `ImmichAsset = SourceAsset`, `ImmichAssetPage = SourceAssetPage<ImmichAsset>`; `immichThumbnailUrl`
    unchanged. `immich.api.ts` unchanged (same type names).
  - `features/editor/import/asset-grid.ts`: generic `AssetGrid<T extends SourceAsset>`; input
    `connectorId` removed, new required input `thumbnailUrl: (asset: T) => string`. Everything else
    (selection, `importedIds`, `unavailableIds`, `disabled`, `toggled`, texts, i18n ids) unchanged.
  - `features/editor/import/album-list.ts`: generic `AlbumList<T extends SourceAlbum>`; input
    `connectorId` removed, new required input `coverUrl: (album: T) => string | null` (`null` → the
    `photo_album` icon, as before); `selected` emits `T`.
  - `features/editor/import/import-dialog.{ts,html}`: computed `assetThumbnailUrl` / `albumCoverUrl`
    (functions bound to the chosen connector id; a new function reference per connector) passed to the
    grid/list. No other change.
  - `features/editor/import/original-size.ts`: takes `SourceAsset`; new exported
    `withinOriginalPixelLimit(asset)` (60 MP check only, for any source); `supportsOriginalSize` keeps
    the Immich rules (AVIF/GIF/BMP + 60 MP) and uses it.
  - `features/editor/editor.page.{ts,html}`: the toolbar button (same icon `add_photo_alternate`, same
    `toolbar-primary` style) opens `mat-menu #importMenu` (`xPosition="before"`) with "Immich"
    (`openImport()`, unchanged dialog) and "Synology" (`disabled`, no click handler yet). `MatMenuModule`
    imported. Tooltip/aria-label text "Import from Immich" → "Import" with the new id
    `@@editor.importMenu.button` (old id `@@editor.importButton` removed); menu entries
    `@@editor.importMenu.immich`, `@@editor.importMenu.synology`.
  - Not changed (still mention Immich, decide in step 4/5 if needed): editor hint `@@editor.noPhotos`
    ("Import photos from Immich."), Immich dialog title `@@import.title`, the grid's unavailable reason
    `@@import.assets.originalUnavailableReason` (lists the Immich rules AVIF/GIF/BMP + 60 MP; for Synology
    only 60 MP applies — step 4 can add an input for the reason text if wanted).
  - i18n: the project has no `extract-i18n` script and no messages file (source locale `en` only), so
    nothing to regenerate.
  - Verified: `npx ng build` without errors or warnings. Not tested in the browser.

### Step 4 — Synology import
- **Status:** done (reviewed 2026-11-16)
- **What:**
  - Backend: `synology.Service.Source` → `imageSource.Image` (preview = `xl`, original = download with
    fallback, see decision log); `photo.Sources` dispatcher by connector type; wiring in `main.go`.
  - Frontend: `core/api/synology.api.ts`, `core/models/synology.ts`, new
    `features/editor/import/synology-import-dialog.{ts,html,scss}`: connector choice (Synology connectors
    only; link to settings if none), tabs "Albums" / "Folders", folder navigation (subfolders + photos of the
    current folder, breadcrumb, back), shared `asset-grid`, selection, "Load more", preview/original toggle
    (same localStorage key as Immich), import via `ImportDialogData.importPhotos`, result message.
    Enable the "Synology" menu entry.
- **Acceptance criteria:** import photos from "Testalbum 1" and from "/Ordner 1/Sub-Ordner 1" in preview and
  original size; rotated photos (EXIF orientation 6) appear upright; already imported photos are marked
  "Imported"; Immich import still works.
- **Notes:**
  - Backend `backend/internal/connector/synology/`:
    - `types.go`: `SYNO.Foto.Download` v2 (`apiDownload`, `apiDownloadVersion`).
    - `client.go`: `original(ctx, id)` → POST `SYNO.Foto.Download` `download` with `unit_id=[<id>]`
      (exactly one id) through `download` (a JSON answer is an error, e.g. code 117 for an unknown id).
    - `service.go`: `Service.Source` (implements `photo.Sources`, `var _ photo.Sources`), `imageSource.Image`:
      asset id must be a positive decimal in canonical form (`parseAssetID`; `"01"`, `"+1"`, `"-1"`,
      `"abc"` → validation error); preview = `xl` thumbnail; original = download, kept only for
      Content-Type `image/jpeg|png|webp` (`originalTypes`), else the body is closed and the `xl` thumbnail
      is returned with `Fallback=true`. NAS errors → `apperr` upstream errors.
  - New `backend/internal/photo/sources.go`: `photo.SourcesByType` (`NewSourcesByType(connectors,
    map[type]Sources)`), own consumer interface `photo.Connectors` (`LoadConfig`); unknown type →
    validation error "photos cannot be imported from connectors of type ...". `photo/service.go`: only
    comments (Sources implementers, Synology preview size).
  - `backend/cmd/collageomat/main.go`: `photo.NewSourcesByType(connectorSvc, {immich.Type: immichSvc,
    synology.Type: synologySvc})` passed to `photo.NewService`.
  - Frontend:
    - New `core/models/synology.ts` (`SynologyAlbum`, `SynologyAsset` with `thumbnailKey`,
      `SynologyAssetPage`, `SynologyFolderRef`, `SynologyFolder`, `SYNOLOGY_ROOT_FOLDER = 'root'`,
      `synologyThumbnailUrl(connectorId, asset)` — uses `<id>_0` as key if `thumbnailKey` is empty, because
      the route needs a key).
    - New `core/api/synology.api.ts` (`SynologyApi.albums`, `albumAssets`, `folder`, `folderAssets`).
    - New `features/editor/import/import-size.ts`: `readStoredSize` / `storeSize` (localStorage key
      `collageomat.importSize`) moved out of `import-dialog.ts`; both dialogs use it (Immich behaviour
      unchanged).
    - `features/editor/import/asset-grid.ts`: `unavailableReason` is now an input; the default is the
      old Immich text (same i18n id `@@import.assets.originalUnavailableReason`).
    - New `features/editor/import/synology-import-dialog.{ts,html,scss}` (`SynologyImportDialog`, takes
      `ImportDialogData`): connector choice (Synology only, auto-choice if one, link to the settings if
      none); `mat-tab-nav-bar` "Albums" / "Folders" (hidden while an album is open); Albums: shared
      `AlbumList` (`coverUrl` always `null`) → album photos; Folders: breadcrumb (root = "Personal
      Space"), subfolder list (`folder` icon), photos of the current folder below (folder + first page
      loaded together with `forkJoin`); shared `AssetGrid`, selection, "Load more", size toggle,
      `withinOriginalPixelLimit`, Synology reason text; Back = album → albums, folder → parent folder,
      else → connectors (if more than one). Styles: `import-dialog.scss` (shared via `styleUrls`) +
      the new scss for tabs/breadcrumb.
    - `features/editor/editor.page.{ts,html}`: "Synology" menu entry enabled → `openSynologyImport()`;
      `openImport()` and it share `openImportDialog(component)` (same data, size, result message).
      `@@editor.noPhotos` text → "This collage has no photos yet. Import photos from Immich or Synology."
  - New i18n ids: `@@import.synology.title`, `.tabs.ariaLabel`, `.tabs.albums`, `.tabs.folders`,
    `.folders.trailAriaLabel`, `.folders.root`, `.folders.noPhotos`, `.connectors.none`,
    `.originalUnavailableReason` ("Not available in original size: images over 60 megapixels are not
    supported. Use the preview size."). Same-text ids of the Immich dialog are reused (`@@import.assets.*`,
    `@@import.size.*`, `@@import.back`, ...).
  - Verified: `go build ./... && go vet ./...`, `npx ng build` (no errors/warnings); new files are
    prettier-clean. Temporary Go test with an `httptest` fake NAS (deleted again): preview → `xl` GET with
    `cache_key="<id>_0"`; original JPEG → POST `unit_id=[1]`, no fallback; HEIC and ZIP → `xl` with
    `Fallback=true`; JSON error 117 → upstream error; invalid ids → validation error; dispatcher → right
    service, unknown type → validation error, other user → not found. Not tested against the real NAS or
    in the browser.
  - **Change after review (2026-11-16, decision log "Import menu lists connectors"):** the "Import" menu
    lists connectors (`editor.page.{ts,html,scss}`: `loadImportConnectors()`, `openImport(connector)`,
    `openConnectorSettings()`, type label via `connectorTypeLabel` from `features/connectors/
    connector-types.ts`); `ImportDialogData.connector` added; connector step, "no connector" message and
    Back-to-connectors removed from both dialogs; `connector-list.ts` deleted. i18n: new
    `@@editor.importMenu.loading`, `.loadError`, `.addConnector`; removed `@@editor.importMenu.immich`,
    `.synology`, `@@import.connectors.none`, `@@import.connectors.choose`,
    `@@import.synology.connectors.none`. Verified: `npx ng build` (no errors/warnings). Not tested in the
    browser.

### Step 5 — Documentation
- **Status:** done (reviewed 2026-11-16)
- **What:** update `doc/architecture.md` (connector type `synology`, package, routes in the API table,
  session handling, dispatcher) and `doc/development.md` if needed. **`README.md`:** add Synology Photos to
  the feature list with the note that Synology Photos on DSM 7 or newer is required. **Note for future
  agents** in `doc/architecture.md` (Synology section): the connector depends on the **undocumented**
  `SYNO.Foto.*` Web API (reverse-engineered, verified live on 2026-11-16 with DSM 7 / Synology Photos);
  DSM or Synology Photos updates can change it, so on errors it must be re-investigated (probe with
  `SYNO.API.Info` and read-only calls; the verified facts are in
  `doc/agent-plans/done/synology-connector.md`). Then set this plan to `done` and move it to
  `doc/agent-plans/done/`.
- **Acceptance criteria:** the developer reviews the docs.
- **Notes:**
  - `README.md`: Synology Photos (DSM 7 or newer) in the feature list; new section "Connect a Synology
    Photos NAS" (Personal Space albums and folders, account + password, no 2FA, dedicated read-only account
    recommended, skip-TLS option); `COLLAGEOMAT_SECRET` row mentions passwords.
  - `doc/architecture.md`: overview diagram and module list with `synology`; package table rows `photo`
    (`SourcesByType`) and `connector/synology`; new sections "Connectors and import sources" (Kind registry,
    per-type routes, `photo.SourcesByType` dispatcher) and "Synology connector" (note for future agents
    about the undocumented `SYNO.Foto.*` API with the known pitfalls, scope, file table, session handling
    with re-login on 106/107/119 and 1-minute login failure cooldown, skip-TLS clients, image sizes);
    security bullet (encrypted Synology password, `passwordSet`); frontend table (`SynologyApi`, models
    incl. `source.ts`, Import menu, Synology import dialog, shared generic `AssetGrid`/`AlbumList`, new row
    `features/connectors/`); data model (`connectors.type`, `source_asset_id`); API table (import route
    text, 5 Synology routes); domain terms (Connector, Personal Space).
  - `doc/development.md`: new subsection "Synology connector" under Verification (manual test needs,
    safe manual API probing).
  - `AGENTS.md`: short description mentions the Synology NAS as photo source.
  - Plan not moved to `done/` yet: the developer tests first. The links in `doc/architecture.md` already
    point to `doc/agent-plans/done/synology-connector.md`.

## Open questions

- Live Photos and HEIC originals are not in the test library; their behaviour (download returns HEIC or
  ZIP?) is unverified. The generic fallback to `xl` covers both; verify if test data becomes available.
- Conditional albums (`type: "condition"`) are not in the test library; step 2 lists them and uses
  `album_id` (unverified); see decision log "Conditional albums (step 2)".
- Live Photos: the thumbnail is requested with the item `id` (and `type="unit"`); if the
  `additional.thumbnail.unit_id` of a Live Photo differs from its item id, its thumbnail can fail. Unverified (no Live Photo in the test data).
- The error code of `SYNO.Foto.Browse.Folder get` for an unknown folder id is unknown; it gives a 502
  upstream error (not 404).
- The behaviour of `SYNO.API.Auth.Key` (exists on the NAS) is unknown and not used.
- Original downloads use the shared HTTP client with a 30 s timeout including the body (step 1). Very
  large originals over a slow NAS upload can time out (upstream error); not seen on the test NAS. If it
  happens, a longer timeout for `SYNO.Foto.Download` is needed (developer decision).
- The `xl` thumbnail with the derived key `<id>_0` relies on "cache_key is not validated" (verified
  2026-11-16); if a DSM update starts to validate it, preview imports fail and the real key must be sent.

## Current state / Next action

Feature done and approved by the developer (2026-11-16) after the final manual test (connector settings,
Synology import from albums and folders in preview and original size, "Import" menu with the connector
list, Immich import unchanged). No open work; remaining unverified points are listed under
"Open questions". Not committed yet (commit only on the developer's request).
