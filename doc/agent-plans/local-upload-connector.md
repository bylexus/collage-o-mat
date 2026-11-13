# Local file upload connector

**Ticket/Source:** Backlog of `doc/agent-plans/poc-implementation.md` (requested by the developer
2026-11-13; was out of the PoC scope)
**Branch:** none
**Status:** planning

## Goal

A second photo source besides Immich: the user uploads image files from the local computer into a
collage.

## Scope

**In scope:** uploading local image files into a collage so they behave like imported Immich photos
(arrangement, editing, export).
**Out of scope:** to be decided in the grilling.

## Rough Architecture / Concept

Not decided yet (planning phase). The PoC already prepared extension points:
- Backend: `internal/connector` uses a Strategy `Kind` interface + `NewRegistry(kinds...)`; photo import is
  connector-agnostic via `photo.Sources` / `Source{Preview(ctx, assetID)}`. An upload is a push (multipart
  from the browser), not a pull from an external server, so it may not fit the `Source` interface — decide
  in the grilling.
- Frontend: connector types = one form component + one `@case` (`features/connectors/connector-types.ts`);
  import dialog in `features/editor/import/`.

## Context for a new agent

- **Read first:** `doc/agent-plans/poc-implementation.md` — "Architecture conventions", "Data model"
  (`photos`: `connector_id` nullable, `source_asset_id`, `file_name`, `mime_type`, `width_px`,
  `height_px`, `props`; unique index `(collage_id, connector_id, source_asset_id)`), "API", step 4 + 5
  Notes (connectors, import, storage), "Commands", sandbox notes in "Current state".
- **Constraints from the PoC:**
  - JSON bodies are limited to 1 MiB (`httpapi.DecodeJSON`); mutating requests need
    `Content-Type: application/json` (`httpapi.RequireJSON`, CSRF rule) → an upload endpoint with
    `multipart/form-data` needs an explicit, safe exception.
  - Stored photo formats: JPEG or WebP; pixel size read with `image.DecodeConfig` (jpeg + webp
    registered). The import checks that the decoded format matches the Content-Type.
  - Photo files: `data/photos/<collageId>/<photoId>.<ext>` via `photo.DiskStorage` (`os.Root`, atomic
    writes); `GormStore.CreateWithFile` inserts row + file in one transaction.
  - Immich imports store previews of about 1440 px; export uses these stored files.
- **Key files:** `backend/internal/connector/{kind,service,handler}.go`, `backend/internal/connector/immich/`,
  `backend/internal/photo/{service,storage,preview,store,handler}.go`, `backend/internal/httpapi/`,
  `frontend/src/app/features/connectors/`, `frontend/src/app/features/editor/import/`,
  `frontend/src/app/core/api/photo.api.ts`, `frontend/src/app/core/models/photo.ts`.

## Decision log

(empty — fill during grilling)

## Testing strategy

To be decided (PoC: no automated tests, manual review per step).

## Steps

To be defined after the grilling.

## Open questions (for the grilling)

- A configured connector (row in `connectors`, type `local`) or a plain "Upload" button without a
  connector (`connector_id = NULL`)?
- Accepted formats: JPEG, PNG, WebP, HEIC? Conversion on the server (pure Go, no CGO) or in the browser?
- Size limits per file / per request; downscale to ~1440 px like Immich previews, or keep the original?
- EXIF orientation (rotated phone photos) — applied when?
- Upload UI: file picker, drag & drop onto the editor, progress, many files at once?
- Duplicate detection (hash of the file as `source_asset_id`?).
- Arrangement after upload: same rule as after an Immich import?

## Current state / Next action

- Nothing implemented. Next: research + grilling (feature-workflow phase 1/2).
