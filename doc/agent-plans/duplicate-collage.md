# Duplicate a collage

**Ticket/Source:** none (rough idea of the developer, 2026-11-14)
**Branch:** none
**Status:** planning

## Goal

The user duplicates an existing collage. The copy is a new, independent collage of the same user with all
settings, all photos (database rows **and** a copy of each photo file on disk), all photo props (frames,
borders, ...) and all overlay texts. After the copy, changing or deleting one collage has no effect on the
other.

## Scope

**In scope:** a "Duplicate" action that creates a full copy of one collage: `collages.settings`, all
`photos` rows with their `props`, a copy of each photo file, all `collage_texts` rows.
**Out of scope:** to be decided in the grilling. Expected: copying a collage to another user, duplicating
single photos or texts inside a collage, sharing files between collages (copy-on-write / hard links),
templates (copy only the settings).

## Rough Architecture / Concept

Not decided yet (planning phase). Expected: a backend endpoint plus a small frontend action.

- Backend: new endpoint, e.g. `POST /api/collages/{id}/duplicate` → returns the new `CollageSummary`.
  The copy runs in one transaction (`Transactor.InTx`, see `backend/internal/collage/service.go`):
  create the collage row, copy the photo rows, copy the text rows.
- Photo files: each photo file is stored at `FileName` relative to the photo directory, built by
  `fileName(collageID, photoID, ext)` (`backend/internal/photo/service.go`, e.g. `"12/345.jpg"`). The new
  photo row gets a new id and a new collage id, so the file must be copied to the new path. The existing
  pattern `GormStore.CreateWithFile` (`backend/internal/photo/store.go`) inserts the row, writes the file
  with `DiskStorage.Save` (temp file + rename) and removes the file again on error — reuse it.
- **Photo ids in JSON documents must be remapped (old id → new id):** the collage settings contain photo
  ids: `center.centerPhotoId` and `background.image.photoId` (`frontend/src/app/core/models/collage.ts`).
  Photo props and texts must be checked for photo ids too. The settings JSON is owned by the frontend, so
  the remapping is either done in the backend with knowledge of these two fields, or in the frontend
  (decision for the grilling).
- Layering: the `collage` package must not import `photo` (today `photo` imports `collage`; `collage`
  talks to photos through the `collage.Photos` interface, implemented by `photo.CollagePhotos` in
  `backend/internal/photo/collage_photos.go`). A duplicate method for photos fits into that interface.
- Frontend: a "Duplicate" item in the collage list (`frontend/src/app/features/collages/`, beside rename
  and delete), probably with a name dialog (default e.g. "<name> (copy)"), API call in the collages
  service in `frontend/src/app/core/`.

## Open questions (for the grilling)

- Where is the action: collage list only, or also in the editor toolbar? Open the new collage after the
  copy, or stay in the list?
- Name of the copy: fixed "<name> (copy)", or a dialog to enter the name? Name length limit
  (`COLLAGE_NAME_MAX_LENGTH` = 200) with the suffix.
- Remap photo ids in settings (`center.centerPhotoId`, `background.image.photoId`): in the backend (it
  then knows two fields of the frontend-owned JSON) or in the frontend (e.g. the backend returns an
  old → new id map and the frontend saves the fixed settings)?
- Unsaved changes in the editor: duplicate the stored state only, or save first?
- Photo source fields: keep `ConnectorID` and `SourceAssetID` (so the import skip-duplicate logic works in
  the copy as in the original)? The unique index `(collage_id, connector_id, source_asset_id)` is per
  collage, so a copy does not conflict.
- File copy: stream copy (`Open` + `Save`) is the simple way. Hard links would save disk space but make
  delete and storage quota (`doc/agent-plans/user-storage-quota.md`) more complex — expected: real copy.
- Error handling: if a file copy fails in the middle, roll back the transaction and remove the copied
  files (no half collage).
- Storage quota: if `user-storage-quota` is implemented first, the copy must count against the quota.
- Large collages: time limit / progress, or a plain synchronous request?

## Context for a new agent

- **Read first:** `AGENTS.md`, `doc/architecture.md` (layering, data model, API),
  `doc/agent-plans/done/poc-implementation.md` (history).
- **Facts from the code (2026-11-14):**
  - `collage.Service` (`backend/internal/collage/service.go`): `Create`, `Get`, `Detail`, `Rename`,
    `Delete`, `SaveLayout` (one transaction: settings + photo props + texts); interfaces `Store`, `Photos`,
    `Transactor`.
  - Routes in `backend/internal/collage/handler.go`: `GET/POST /api/collages`,
    `GET/PATCH/DELETE /api/collages/{id}`, `PUT /api/collages/{id}/layout`.
  - `collage.CollageText` (`backend/internal/collage/model.go`, table `collage_texts`).
  - `photo.Photo` (`backend/internal/photo/model.go`): `CollageID`, `ConnectorID` (nil for upload),
    `SourceAssetID`, `FileName`, `MimeType`, `WidthPx`, `HeightPx`, `Props` (JSON owned by the frontend).
  - `photo.DiskStorage` (`backend/internal/photo/storage.go`): `Save` (temp file + rename), `Open`;
    paths relative to the photo directory, guarded by `os.Root`.
  - `photo.CollagePhotos` (`backend/internal/photo/collage_photos.go`): implements `collage.Photos`
    (`CountByCollages`, `ListForCollage`, `UpdateProps`, `DeleteAllForCollage`).
- **Commands:** `cd backend && go build ./... && go vet ./...`; `cd frontend && npx ng build`; dev via
  `make dev-up`, `make backend-run`, `make frontend-serve` (see `Makefile`).

## Decision log

(empty — fill during grilling)

## Testing strategy

To be decided (project rule: no automated tests, manual review per step).

## Steps

To be defined after the grilling.

## Current state / Next action

Idea only. Next: start the feature workflow (research + grilling) on this file.
