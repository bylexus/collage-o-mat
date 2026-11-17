# Architecture

## Overview

```
Browser (Angular SPA, Konva canvas)
   │  JSON over /api/...  (session cookie)
   ▼
collageomat (one Go binary)
   ├─ /api/...   httpapi router → domain modules (auth, collage, photo, connector, immich, synology, profile, admin, settings)
   ├─ /*         embedded SPA (internal/web, go:embed, fallback to index.html)
   ├─ SQLite     <DATA_DIR>/collageomat.db   (WAL, foreign keys on)
   ├─ files      <DATA_DIR>/photos/<collageId>/<photoId>.<ext>
   └─ Immich, Synology Photos   server-side proxy (the browser never talks to Immich or the NAS directly)
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
| `auth` | Users, sessions (cookie token, SHA-256 hash in DB), login rate limit (`LoginLimiter`), `RequireAuth` (rejects inactive users), `RequireAdmin` (403 for non-admins, used after `RequireAuth`), `auth.UserID(r)`, `auth.SessionID(r)`. `PasswordChanger` (implements `profile.Passwords`, uses the same `LoginLimiter` instance as the login). Declares `AvatarVersions` (implemented by `profile.Service`) for the user DTO. Older code, no store/service split |
| `collage` | Collages, texts, layout save (one transaction) |
| `photo` | Photo rows and files, connector import (preview: stored as downloaded; original: `process.go` calls `imaging`, no scaling; `SourcesByType` in `sources.go` picks the `Sources` of the connector type), local upload (`process.go`: calls `imaging`, long edge ≤ 2560 px), file serving |
| `connector` | Connectors per user, `Kind` registry (strategy per connector type), config encrypted with `secretbox` |
| `connector/immich` | Immich HTTP client, album/asset listing, thumbnail proxy |
| `connector/synology` | Synology Photos (DSM 7) Web API client with session cache, album/folder/item listing, thumbnail proxy, import source. See [Synology connector](#synology-connector) |
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
- Connector secrets (Immich API key, Synology password) are stored encrypted and are never returned by the
  API (`apiKeySet: true` / `passwordSet: true` only).

### Connectors and import sources

- A connector type is a `connector.Kind` (`Type`, `BuildConfig`, `PublicConfig`, `Test`), registered in
  `newConnectorService` in `main.go`. Types: `immich` (`connector/immich`), `synology`
  (`connector/synology`). `connector.Service` does not know the concrete types.
- Each type has its own service + handler with type-specific browse routes
  (`/api/connectors/{id}/<type>/...`); the service checks ownership (`connector.Service.LoadConfig`) and the
  connector type (wrong type → validation error).
- Import: `photo.Service` takes one `photo.Sources`. In `main.go` this is `photo.SourcesByType`
  (`internal/photo/sources.go`) with a map connector type → `Sources` (`immich.Service`,
  `synology.Service`). It loads the connector, picks the `Sources` of its type (unknown type → validation
  error) and delegates. It is in `photo` because `connector` cannot import `photo` (import cycle).

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
tree) and the albums that other NAS users shared with the account ("Shared with me"). No Photo Station
(DSM 6), no Shared Space (`SYNO.FotoTeam.*`), no public share links, no 2FA. Videos are hidden (`photo`
and `live` items are shown).

Package `backend/internal/connector/synology/`:

| File | Content |
|---|---|
| `kind.go` | `Kind` (`Type = "synology"`): config `{url, account, password, skipTlsVerify}` (URL stored as `scheme://host[:port]`, a path like `/photo/` is removed; an empty password on update keeps the stored one); public config `{url, account, passwordSet, skipTlsVerify}`. Two shared `*http.Client`s: normal and one with `InsecureSkipVerify`, chosen by `skipTlsVerify`. `Test` logs in with its own session, reads one album and logs out. `Client(connectorID, stored)` returns a client with the cached session of the connector |
| `client.go` | Web API client: POST/GET to `<url>/webapi/entry.cgi`, `_sid` param, JSON envelope `success`/`data`/`error.code` (a JSON answer to a thumbnail/download is an error), login (`SYNO.API.Auth` v6, `format=sid`, POST), album/item/folder listing, thumbnail, original download. Same-host redirects only, 30 s timeout. `APIError` messages are user-safe (never contain password or sid) |
| `session.go` | `session` (sid, one login at a time, login failure cooldown), `passphraseCache` (shared album id → share token), `sessionCache` (one session + passphrase cache per connector id; replaced when the stored config changes) |
| `service.go` | `Service`: albums and shared albums (all pages, sorted by name), album/shared album/folder items (pages of 250), folder with subfolders, thumbnail proxy, `Source` (implements `photo.Sources`), `parseAssetRef` (both asset id forms) |
| `handler.go` | Routes `/api/connectors/{id}/synology/...` (see [API](#api)) |
| `types.go` | API names/versions, error codes, NAS response types |

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
shared album = `s:<albumId>:<itemId>`. `parseAssetRef` parses both, for the thumbnail route and the import.

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

## Frontend (`frontend/`)

Angular 22 standalone components, signals, `inject()`, new control flow, OnPush, Angular Material. No state
library. UI language English, all texts marked for i18n (build-time Angular i18n, source locale `en`).

| Path | Content |
|---|---|
| `src/app/app.routes.ts` | Routes: `login` (own layout); `AppShell` with `authGuard` and the children `collages`, `collages/:id` (editor), `settings/connectors`, `profile`, `about`, `admin` (`adminGuard`; tab children `users`, `settings`) |
| `src/app/layout/app-shell.*` | `AppShell`: base layout of all signed-in pages (main toolbar + page outlet). Toolbar: round profile button (`UserAvatar`) opens a `mat-menu` (username, Admin badge, Profile, Log out); for admins an icon button `manage_accounts` (Administration) left of About |
| `src/app/core/api/` | One API service per resource (`CollageApi`, `PhotoApi`, `ConnectorApi`, `ImmichApi`, `SynologyApi`, `AuthApi`, `ProfileApi`, `AdminApi`) |
| `src/app/core/models/` | Typed DTOs and JSON props models (`collage.ts`, `photo.ts`, `text.ts`, `shadow.ts`, `layout.ts`); connector DTOs (`connector.ts`, `immich.ts`, `synology.ts`) and the neutral import types `SourceAlbum`, `SourceAsset`, `SourceAssetPage` (`source.ts`) |
| `src/app/features/editor/` | Editor page and store (`editor.store.ts`), undo history, auto save |
| `features/editor/canvas/` | Konva rendering, transformers, crop mode, viewport, export renderer, adjusted/blurred image copies |
| `features/editor/arrange/` | Pure arrangement functions (grid, center, random heap, masonry, lanes, justified lines) |
| `features/editor/toolbar/` | `SelectionToolbar`: floating toolbar below the selected photo or text (anchor from `CollageRenderer`, hidden during gestures and crop mode, only the Swap button in swap mode); actions and movable CDK overlay popovers |
| `features/editor/photo-panel/`, `text-panel/` | Popover sections of the selection toolbar (photo: border, shadow, adjustments; text: edit, outline, shadow) |
| `features/editor/settings-panel/` | Collage settings in the right panel (the only content of the right panel) |
| `features/editor/fields/` | Shared form fields (colour, number, `BorderFields`, `ShadowFields` + `SHADOW_LIMITS`) |
| `features/editor/geometry/` | Pure math: crop, units (mm/pt/px), gradients, snap grid |
| `features/editor/import/`, `upload/` | Connector import dialogs, local file upload. The editor toolbar "Import" button opens a `mat-menu` that lists the user's connectors (name + type; loaded with `ConnectorApi.list()` each time the menu opens; "Add a connector" links to the connector settings if there is none). An entry opens the dialog of the connector's type with that connector (`ImportDialogData.connector`): Immich (`import-dialog.*`: albums) or Synology (`synology-import-dialog.*`: tabs "Albums" / "Folders" / "Shared with me", folder navigation with breadcrumb). Both dialogs share the generic presentational components `AssetGrid<T extends SourceAsset>` (`asset-grid.ts`, thumbnail URL as function input) and `AlbumList<T extends SourceAlbum>` (`album-list.ts`), `import-size.ts` (preview/original choice in localStorage) and `original-size.ts` |
| `src/app/features/connectors/` | Connector settings page ("Add connector" menu per type), connector dialog, one config form per type (`immich-config-form.ts`, `synology-config-form.ts`), `connector-types.ts` |
| `features/editor/export/` | PNG/JPG export dialog |
| `src/app/features/admin/` | Admin page (tab nav): Users tab (table with avatar, flags, counts; create, edit and type-username delete dialogs), Settings tab (storage limit in GB, 1 GB = 10⁹ bytes) |
| `src/app/features/profile/` | Profile page: info (username, Admin badge, member since), avatar card (upload, remove), change password card |
| `src/app/shared/` | `ConfirmDialog`, `NotificationService`, `errorMessage(err)`, `UserAvatar` (round avatar image or first letter of the username) |

Rules: only `core/api` services use `HttpClient`. Page components load data and hold state; dialogs and
presentational components use `input()`/`output()` and do no API calls.

## Data model

All tables have `created_at`, `updated_at`. JSON columns are `TEXT`.

| Table | Columns |
|---|---|
| `users` | `id`, `username` unique, `password_hash` (bcrypt), `is_admin`, `is_active` (DB default `true`) |
| `system_settings` | `key` PK, `value` JSON |
| `sessions` | `id`, `token_hash` unique, `user_id` FK, `expires_at` |
| `user_avatars` | `user_id` PK + FK (`ON DELETE CASCADE`), `data` BLOB (JPEG, square, ≤ 500×500 px), `mime_type`. Own table, because `RequireAuth` loads the `users` row on each request |
| `collages` | `id`, `user_id` FK, `name`, `settings` JSON |
| `collage_texts` | `id` (UUID from frontend), `collage_id` FK, `props` JSON |
| `connectors` | `id`, `user_id` FK, `type` (`immich`, `synology`), `name`, `config` (encrypted JSON) |
| `photos` | `id`, `collage_id` FK, `connector_id` (NULL for uploads), `source_asset_id` (Immich id, Synology item id, `s:<albumId>:<itemId>` for a Synology shared album photo, or `sha256:<hex>`), `file_name`, `mime_type`, `width_px`, `height_px`, `props` JSON |

Units: page and element geometry in mm (frame centre `cxMm/cyMm`, rotation around the centre), font size
in pt, crop as normalized rectangle (0..1) of the source image. `z` is shared between photos and texts.
The exact JSON shapes are the TypeScript models in `frontend/src/app/core/models/`.

Photo look: the collage settings hold `defaultBorder` and `defaultShadow`; each photo's props can override
them (`border`: per-field `null` = default; `shadow`: missing or `null` = default, else a full own
`Shadow`, `enabled: false` = no shadow for this photo). Texts and photos use the same `Shadow` type.
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
| POST | `/api/collages/{id}/import` | Import connector assets (Immich or Synology; `connectorId`, `assetIds`, `size` = `"preview"` (default) or `"original"`) → `photos`, `skipped`, `previewFallbacks` (original requests that were answered with the preview) |
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
| GET | `/api/connectors/{id}/synology/assets/{assetId}/thumbnail?key=<thumbnailKey>` | Proxied thumbnail (`m`); `assetId` = `<itemId>` or `s:<albumId>:<itemId>` (URL-encoded) |

Unknown `/api/...` paths always return a JSON 404, never the SPA.

## Domain terms

- **Collage / Page:** one page (size in mm, DPI for export) with photos and texts, owned by one user.
- **Frame:** the rectangle of a photo on the page. **Crop:** the visible part of the source image.
- **Cover:** crop with the frame aspect, as large as possible (frame filled, image cut).
- **Arrangement / mode:** algorithm that sets all frames at once (`grid`, `center`, `heap` = random heap,
  `masonry` = justified rows or columns, free placement).
- **Connector:** a configured external photo source of a user (`immich` or `synology`).
- **Personal Space (Synology):** the own photos (folder tree) and own albums of the account in Synology
  Photos. The Shared Space / Team Space is not supported.
- **Shared with me album (Synology):** an album of another NAS user that is shared with the connector
  account. Read with its **passphrase** (share token), which never leaves the server.
- **Layout:** collage settings + all photo props + all texts, saved together.
- **Drop shadow (photo):** drawn by an unclipped rect under the clipped photo content
  (`canvas/photo-view.ts`); offset is not rotated with the photo (same light direction for all).
