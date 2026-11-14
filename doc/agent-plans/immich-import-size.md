# Immich import size (preview or original)

**Ticket/Source:** none (rough idea of the developer, 2026-11-14)
**Branch:** none
**Status:** planning

## Goal

When the user imports photos from an Immich connector, the user chooses the image size in the import
dialog: the big Immich thumbnail ("preview", as today) or the original size. The original gives a better
quality in a print export at high DPI.

## Scope

**In scope:** a size choice (preview / original) in the import dialog for Immich imports; the backend
downloads the chosen size.
**Out of scope:** to be decided in the grilling. Expected: changing the size of photos that are already
imported (re-import / upgrade), a per-connector default setting, sizes for the local upload (has its own
processing), RAW/video support.

## Rough Architecture / Concept

Not decided yet (planning phase). Expected:

- **API:** `POST /api/collages/{id}/import` body `{connectorId, assetIds}` gets a new field, e.g.
  `size: "preview" | "original"` (default `preview` when missing).
- **Backend, photo domain:** `photo.Source.Preview(ctx, assetID)` (`backend/internal/photo/service.go`)
  gets a size parameter, or a second method (e.g. `Original`). `Service.Import` → `importAll` → `importOne`
  pass the size through.
- **Backend, Immich:** `previewSource` (`backend/internal/connector/immich/service.go`) uses
  `Client.Thumbnail(..., ThumbnailSizePreview)` today. Original: new client method for
  `GET /assets/{id}/original` (Immich API), or the Immich `fullsize` thumbnail size (converted full
  resolution JPEG, if the Immich server version has it) — to decide.
- **Processing of originals:** originals can be HEIC, PNG, TIFF, RAW, large JPEGs with EXIF orientation.
  `readPreview` (`backend/internal/photo/preview.go`) accepts only `image/jpeg` and `image/webp` and max
  `maxPreviewBytes` = 50 MiB. Options: reuse the upload pipeline (`processUpload` in `process.go`: decode,
  orientation, scale to `maxUploadEdge` = 2560 px, re-encode JPEG, decode slots), or store the original
  bytes as they are (only for formats the browser and the export can draw). Note: `processUpload` scales to
  2560 px, so "original" would need its own (higher or no) edge limit.
- **Frontend:** import dialog (`frontend/src/app/features/editor/import/import-dialog.*`) gets a choice
  (e.g. radio buttons / button toggle) and sends the field. i18n for the labels.
- **Related:** `doc/agent-plans/user-storage-quota.md` — originals are much larger and count toward the
  storage limit.

## Open questions (for the grilling)

- "Original" = Immich original file (`/assets/{id}/original`) or Immich `fullsize` (JPEG, full
  resolution)? Which Immich server versions must be supported?
- Formats of originals to accept (HEIC, PNG, TIFF, RAW, videos/live photos → skip with message?).
- Store originals as they are, or re-encode (JPEG quality, max edge, EXIF orientation)? Size limit per file?
- Memory/CPU: decode of large originals (pixel limit like `maxUploadPixels`, decode slots).
- Should the choice be remembered (per user/connector, browser storage), or always default to preview?
- Does the canvas need a smaller display copy for large originals (editor performance)?

## Context for a new agent

- **Read first:** `doc/architecture.md` (layering, connectors, API); `doc/agent-plans/local-upload-connector.md`
  (upload processing pipeline); `doc/agent-plans/done/poc-implementation.md` (Immich import decisions).
- **Facts from the code (2026-11-14):**
  - `immich.Client.Thumbnail(ctx, assetID, size)` (`backend/internal/connector/immich/client.go`) calls
    `/assets/{id}/thumbnail?size=...`; sizes `ThumbnailSizeThumbnail`, `ThumbnailSizePreview`
    (`types.go`). No original download today.
  - `previewSource.Preview` (`backend/internal/connector/immich/service.go`) implements `photo.Source` with
    `ThumbnailSizePreview`.
  - `photo.Service.Import` / `importAll` / `importOne` → `download` → `readPreview` → `createPhoto`
    (`backend/internal/photo/service.go`, `preview.go`).
  - `readPreview` accepts `image/jpeg`, `image/webp`, max 50 MiB.
  - Upload pipeline: `processUpload` / `checkUploadConfig` in `backend/internal/photo/process.go`
    (`MaxUploadBytes` 50 MiB, `maxUploadPixels` 60 MP, `maxUploadEdge` 2560 px, `maxConcurrentDecodes` 2).
  - Import dialog: `frontend/src/app/features/editor/import/import-dialog.{ts,html}`.
- **Commands:** in `backend/`: `go build ./... && go vet ./...`; in `frontend/`: `npx ng build`; dev via
  `make dev-up`, `make backend-run`, `make frontend-serve` (see `Makefile`). Immich test key in `/.env`.

## Decision log

(empty — fill during grilling)

## Testing strategy

To be decided (PoC: no automated tests, manual review per step). Manual: import the same asset with both
sizes against the test Immich server, compare pixel size and export quality.

## Steps

To be defined after the grilling.
