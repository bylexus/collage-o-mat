# Architecture

## Overview

```
Browser (Angular SPA, Konva canvas)
   │  JSON over /api/...  (session cookie)
   ▼
collageomat (one Go binary)
   ├─ /api/...   httpapi router → domain modules (auth, collage, photo, connector, immich, profile, admin, settings)
   ├─ /*         embedded SPA (internal/web, go:embed, fallback to index.html)
   ├─ SQLite     <DATA_DIR>/collageomat.db   (WAL, foreign keys on)
   ├─ files      <DATA_DIR>/photos/<collageId>/<photoId>.<ext>
   └─ Immich     server-side proxy (the browser never talks to Immich directly)
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
| `photo` | Photo rows and files, Immich import (preview: stored as downloaded; original: `process.go` calls `imaging`, no scaling), local upload (`process.go`: calls `imaging`, long edge ≤ 2560 px), file serving |
| `connector` | Connectors per user, `Kind` registry (strategy per connector type), config encrypted with `secretbox` |
| `connector/immich` | Immich HTTP client, album/asset listing, thumbnail proxy |
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
- Connector API keys are stored encrypted and are never returned by the API (`apiKeySet: true` only).

## Frontend (`frontend/`)

Angular 22 standalone components, signals, `inject()`, new control flow, OnPush, Angular Material. No state
library. UI language English, all texts marked for i18n (build-time Angular i18n, source locale `en`).

| Path | Content |
|---|---|
| `src/app/app.routes.ts` | Routes: `login` (own layout); `AppShell` with `authGuard` and the children `collages`, `collages/:id` (editor), `settings/connectors`, `profile`, `about`, `admin` (`adminGuard`; tab children `users`, `settings`) |
| `src/app/layout/app-shell.*` | `AppShell`: base layout of all signed-in pages (main toolbar + page outlet). Toolbar: round profile button (`UserAvatar`) opens a `mat-menu` (username, Admin badge, Profile, Log out); for admins an icon button `manage_accounts` (Administration) left of About |
| `src/app/core/api/` | One API service per resource (`CollageApi`, `PhotoApi`, `ConnectorApi`, `ImmichApi`, `AuthApi`, `ProfileApi`, `AdminApi`) |
| `src/app/core/models/` | Typed DTOs and JSON props models (`collage.ts`, `photo.ts`, `text.ts`, `shadow.ts`, `layout.ts`) |
| `src/app/features/editor/` | Editor page and store (`editor.store.ts`), undo history, auto save |
| `features/editor/canvas/` | Konva rendering, transformers, crop mode, viewport, export renderer, adjusted/blurred image copies |
| `features/editor/arrange/` | Pure arrangement functions (grid, center, random heap, masonry, lanes, justified lines) |
| `features/editor/toolbar/` | `SelectionToolbar`: floating toolbar below the selected photo or text (anchor from `CollageRenderer`, hidden during gestures and crop mode, only the Swap button in swap mode); actions and movable CDK overlay popovers |
| `features/editor/photo-panel/`, `text-panel/` | Popover sections of the selection toolbar (photo: border, shadow, adjustments; text: edit, outline, shadow) |
| `features/editor/settings-panel/` | Collage settings in the right panel (the only content of the right panel) |
| `features/editor/fields/` | Shared form fields (colour, number, `BorderFields`, `ShadowFields` + `SHADOW_LIMITS`) |
| `features/editor/geometry/` | Pure math: crop, units (mm/pt/px), gradients, snap grid |
| `features/editor/import/`, `upload/` | Immich import dialog, local file upload |
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
| `connectors` | `id`, `user_id` FK, `type` (`immich`), `name`, `config` (encrypted JSON) |
| `photos` | `id`, `collage_id` FK, `connector_id` (NULL for uploads), `source_asset_id` (Immich id or `sha256:<hex>`), `file_name`, `mime_type`, `width_px`, `height_px`, `props` JSON |

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
| POST | `/api/collages/{id}/import` | Import Immich assets (`connectorId`, `assetIds`, `size` = `"preview"` (default) or `"original"`) → `photos`, `skipped`, `previewFallbacks` (original requests that Immich answered with the preview) |
| POST | `/api/collages/{id}/uploads` | Upload one local image (raw body) |
| GET | `/api/collages/{id}/photos/{photoId}/file` | Image bytes (immutable cache) |
| DELETE | `/api/collages/{id}/photos/{photoId}` | Delete photo row and file |
| GET, POST | `/api/connectors` | List, create |
| PUT, DELETE | `/api/connectors/{id}` | Update, delete |
| POST | `/api/connectors/{id}/test` | Test the connection |
| GET | `/api/connectors/{id}/immich/albums` | Immich albums |
| GET | `/api/connectors/{id}/immich/albums/{albumId}/assets?page=N` | Album assets (images, paged); items `{id, fileName, width, height, mimeType}` (`mimeType` = Immich original MIME type) |
| GET | `/api/connectors/{id}/immich/assets/{assetId}/thumbnail` | Proxied thumbnail |

Unknown `/api/...` paths always return a JSON 404, never the SPA.

## Domain terms

- **Collage / Page:** one page (size in mm, DPI for export) with photos and texts, owned by one user.
- **Frame:** the rectangle of a photo on the page. **Crop:** the visible part of the source image.
- **Cover:** crop with the frame aspect, as large as possible (frame filled, image cut).
- **Arrangement / mode:** algorithm that sets all frames at once (`grid`, `center`, `heap` = random heap,
  `masonry` = justified rows or columns, free placement).
- **Connector:** a configured external photo source of a user (only `immich`).
- **Layout:** collage settings + all photo props + all texts, saved together.
- **Drop shadow (photo):** drawn by an unclipped rect under the clipped photo content
  (`canvas/photo-view.ts`); offset is not rotated with the photo (same light direction for all).
