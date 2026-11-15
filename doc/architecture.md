# Architecture

## Overview

```
Browser (Angular SPA, Konva canvas)
   │  JSON over /api/...  (session cookie)
   ▼
collageomat (one Go binary)
   ├─ /api/...   httpapi router → domain modules (auth, collage, photo, connector, immich)
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
| `auth` | Users, sessions (cookie token, SHA-256 hash in DB), login rate limit, `RequireAuth`, `auth.UserID(r)`. Older code, no store/service split |
| `collage` | Collages, texts, layout save (one transaction) |
| `photo` | Photo rows and files, Immich import, local upload (`process.go`: decode, EXIF orientation, downscale, JPEG), file serving |
| `connector` | Connectors per user, `Kind` registry (strategy per connector type), config encrypted with `secretbox` |
| `connector/immich` | Immich HTTP client, album/asset listing, thumbnail proxy |

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
| `apperr` | `ErrNotFound`, `ErrConflict`, `ErrTooLarge`, validation error |
| `db` | Open SQLite with pragmas, `AutoMigrate`, transactor |
| `jsoncol` | GORM column type for JSON stored as `TEXT` |
| `config` | `COLLAGEOMAT_*` environment variables (see [development.md](development.md#environment-variables)) |
| `secretbox` | AES-256-GCM, key = SHA-256(`COLLAGEOMAT_SECRET`) |
| `web` | Embedded SPA from `internal/web/dist` (filled by `make build` or the Dockerfile) |

### Security

- All `/api` routes need a session, except `GET /api/health` and `POST /api/auth/login`.
- Mutating `/api` requests must have `Content-Type: application/json` (the upload route also accepts its
  image types, see `httpapi.RequireJSON`). With the
  `SameSite=Lax` cookie this is the CSRF protection.
- Connector API keys are stored encrypted and are never returned by the API (`apiKeySet: true` only).

## Frontend (`frontend/`)

Angular 22 standalone components, signals, `inject()`, new control flow, OnPush, Angular Material. No state
library. UI language English, all texts marked for i18n (build-time Angular i18n, source locale `en`).

| Path | Content |
|---|---|
| `src/app/app.routes.ts` | Routes: `login` (own layout); `AppShell` with `authGuard` and the children `collages`, `collages/:id` (editor), `settings/connectors`, `about` |
| `src/app/layout/app-shell.*` | `AppShell`: base layout of all signed-in pages (main toolbar + page outlet) |
| `src/app/core/api/` | One API service per resource (`CollageApi`, `PhotoApi`, `ConnectorApi`, `ImmichApi`, `AuthApi`) |
| `src/app/core/models/` | Typed DTOs and JSON props models (`collage.ts`, `photo.ts`, `text.ts`, `shadow.ts`, `layout.ts`) |
| `src/app/features/editor/` | Editor page and store (`editor.store.ts`), undo history, auto save |
| `features/editor/canvas/` | Konva rendering, transformers, crop mode, viewport, export renderer, adjusted/blurred image copies |
| `features/editor/arrange/` | Pure arrangement functions (grid, center, random heap, masonry, lanes, justified lines) |
| `features/editor/fields/` | Shared form fields (colour, number, `BorderFields`, `ShadowFields` + `SHADOW_LIMITS`) |
| `features/editor/geometry/` | Pure math: crop, units (mm/pt/px), gradients, snap grid |
| `features/editor/import/`, `upload/` | Immich import dialog, local file upload |
| `features/editor/export/` | PNG/JPG export dialog |
| `src/app/shared/` | `ConfirmDialog`, `NotificationService`, `errorMessage(err)` |

Rules: only `core/api` services use `HttpClient`. Page components load data and hold state; dialogs and
presentational components use `input()`/`output()` and do no API calls.

## Data model

All tables have `created_at`, `updated_at`. JSON columns are `TEXT`.

| Table | Columns |
|---|---|
| `users` | `id`, `username` unique, `password_hash` (bcrypt), `is_admin` |
| `sessions` | `id`, `token_hash` unique, `user_id` FK, `expires_at` |
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
| GET | `/api/auth/me` | Session user |
| GET, POST | `/api/collages` | List, create |
| GET, PATCH, DELETE | `/api/collages/{id}` | Load full collage, rename, delete (rows + photo dir) |
| POST | `/api/collages/{id}/duplicate` | Copy the collage (settings with remapped photo ids, photo rows + files, texts with new ids) in one transaction; skips photos with a missing file (`skippedPhotos`) |
| PUT | `/api/collages/{id}/layout` | Save settings + photo props + texts in one transaction |
| POST | `/api/collages/{id}/import` | Import Immich assets |
| POST | `/api/collages/{id}/uploads` | Upload one local image (raw body) |
| GET | `/api/collages/{id}/photos/{photoId}/file` | Image bytes (immutable cache) |
| DELETE | `/api/collages/{id}/photos/{photoId}` | Delete photo row and file |
| GET, POST | `/api/connectors` | List, create |
| PUT, DELETE | `/api/connectors/{id}` | Update, delete |
| POST | `/api/connectors/{id}/test` | Test the connection |
| GET | `/api/connectors/{id}/immich/albums` | Immich albums |
| GET | `/api/connectors/{id}/immich/albums/{albumId}/assets?page=N` | Album assets (images, paged) |
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
