# Storage limit per user

**Ticket/Source:** none (rough idea of the developer, 2026-11-14)
**Branch:** none
**Status:** planning

## Goal

Each user can store only a limited total amount of photo bytes. The size of each stored image file is saved
in the `photos` table. A new photo (upload, maybe also import) is refused when it would make the user's total
larger than the limit. The limit is configurable for the server; default 2 GB.

## Scope

**In scope:**
- New column with the file size in bytes in `photos` (`Photo` model).
- Server-wide configurable limit (env variable), default 2 GB, applied per user (sum over all collages of
  the user).
- Refuse a new photo over the limit with a clear error; the frontend shows the message.

**Out of scope:** to be decided in the grilling. Expected: different limits per user, an admin UI, usage
statistics pages, limits on the number of collages/photos, backend-wide disk limit.

## Rough Architecture / Concept

Not decided yet (planning phase). Expected:

- **Model:** `Photo` (`backend/internal/photo/model.go`) gets e.g. `SizeBytes int64 gorm:"not null;default:0"`.
  `AutoMigrate` (`backend/internal/db/db.go`) adds the column. Existing rows: backfill once at startup from
  the file size on disk (`os.Stat` via `FileStorage`), or accept 0 — to decide.
- **Config:** `backend/internal/config/config.go` gets e.g. `COLLAGEOMAT_MAX_USER_STORAGE` (byte count or a
  size string like `2G` / `500M`, default `2G`; `0` = no limit?). Documented in `doc/development.md` and
  `doc/deployment.md`.
- **Check:** in `photo.Service` (`backend/internal/photo/service.go`) before/in `createPhoto`: sum of
  `size_bytes` of all photos in the user's collages (join `photos` → `collages.user_id`) + size of the new
  file > limit → `apperr` error (new kind, e.g. HTTP 413 or 409/422 with a clear message). The check and the
  insert must not race (two parallel uploads): check inside the same DB transaction as the insert
  (`store.CreateWithFile`) or use a per-user lock.
- **Size counted:** the stored file is what uses disk: uploads are re-encoded as JPEG (`processUpload`, long
  edge ≤ 2560 px), imports store the downloaded preview (`preview.data`). So `len(img.data)` is the natural
  value — to confirm (the idea says "uploaded photo bytes").
- **Frontend:** the upload/import error message shows "storage limit reached" (i18n). Optional: show used /
  total storage somewhere (API field, e.g. in a `/api/me` or collages list response) — to decide.
- **Delete:** deleting a photo or a collage frees its bytes automatically (sum query over existing rows).

## Open questions (for the grilling)

- Count only local uploads, or also Immich imports (both store a file on disk)?
- Count the stored (processed) file size or the size of the original uploaded bytes?
- Unit/format of the config value (`2G`, `2GiB`, bytes)? Is 2 GB = 2·10⁹ or 2·2³⁰? `0` = unlimited?
- Backfill of existing photos: stat files at startup (one-time migration) or leave 0?
- Batch import (several Immich assets in one request, `MaxImportAssets`): refuse all, or import until the
  limit and report the rest as not imported?
- HTTP status and error code for "limit reached"; message text in the frontend.
- Show the used storage to the user (where, how)?
- Duplicate collage (`POST /api/collages/{id}/duplicate`, `collage.Service.Duplicate`,
  `photo.CollagePhotos.CopyAllForCollage`) copies all photo files of a collage. The duplicate must check
  the quota and count the copied bytes (see `doc/agent-plans/duplicate-collage.md`).

## Context for a new agent

- **Read first:** `doc/architecture.md` (layering, `apperr`, data model, API); `doc/development.md` (env
  vars); `doc/deployment.md`; `doc/agent-plans/local-upload-connector.md` (upload feature).
- **Facts from the code (2026-11-14):**
  - `Photo` (`backend/internal/photo/model.go`): `ID, CollageID, ConnectorID, SourceAssetID, FileName,
    MimeType, WidthPx, HeightPx, Props, CreatedAt, UpdatedAt`. No size column.
  - `Collage.UserID` (`backend/internal/collage/model.go`) links photos to the user.
  - `photo.Service` (`backend/internal/photo/service.go`): `Import` → `importAll` → `importOne`,
    `Upload` → `readUpload` (max `MaxUploadBytes` = 50 MiB per file) → `processLimited` → `createPhoto`.
    `createPhoto` builds the row and saves the file inside `store.CreateWithFile`.
  - `preview` (`backend/internal/photo/preview.go`): `data []byte, mimeType, ext, width, height` — the bytes
    that are written to disk.
  - Config (`backend/internal/config/config.go`): `FromEnv()` reads `COLLAGEOMAT_*` variables with
    `envOr`.
  - Schema: `gdb.AutoMigrate(models...)` in `backend/internal/db/db.go`; models list in
    `backend/cmd/collageomat/main.go` (`models()`).
- **Commands:** in `backend/`: `go build ./... && go vet ./...`; in `frontend/`: `npx ng build`; dev via
  `make dev-up`, `make backend-run`, `make frontend-serve` (see `Makefile`).

## Decision log

(empty — fill during grilling)

## Testing strategy

To be decided (PoC: no automated tests, manual review per step). Manual: set a small limit via env, upload
until refused, delete a photo, upload again.

## Steps

To be defined after the grilling.
