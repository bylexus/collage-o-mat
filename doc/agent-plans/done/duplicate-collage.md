# Duplicate a collage

**Ticket/Source:** none (rough idea of the developer, 2026-11-14)
**Branch:** none (work on `main`, uncommitted)
**Status:** done

## Goal

The user duplicates an existing collage from the collage list. The copy is a new, independent collage of the
same user with all settings, all photos (database rows **and** a copy of each photo file on disk), all photo
props (frames, borders, shadows, ...) and all overlay texts. After the copy, changing or deleting one collage
has no effect on the other.

## Scope

**In scope:**
- Backend endpoint `POST /api/collages/{id}/duplicate` that copies one collage in one transaction:
  `collages` row (new name, settings with remapped photo ids), all `photos` rows with their props and a
  copy of each photo file, all `collage_texts` rows with new text ids.
- Frontend: a "Duplicate" icon button in the collage list, a name dialog prefilled with
  `"<name> (copy)"`, notification on success (with the number of skipped photos, if any).
- Docs: API row in `doc/architecture.md`, a note in `doc/agent-plans/user-storage-quota.md`.

**Out of scope:**
- Duplicate action in the editor toolbar (list only).
- Opening the copy after duplicate (the user stays in the list).
- Copying a collage to another user.
- Duplicating single photos or texts inside a collage.
- Sharing files between collages (hard links, copy-on-write).
- Templates (copy only the settings).
- Storage quota check (the quota feature is not implemented yet; see Open questions).
- Progress bar, background job, time limits for large collages.

## Rough Architecture / Concept

One synchronous backend request does the full copy in one database transaction (`Transactor.InTx`).
The `collage` service orchestrates: it creates the new collage row, asks the photo domain (through the
`collage.Photos` interface — `collage` must not import `photo`) to copy all photos with their files and
return an old → new photo id map, remaps the two photo-id fields in the settings JSON, and copies the
texts with new UUIDs. Photo files are real stream copies (`DiskStorage.Open` + `DiskStorage.Save`). If
anything fails, the transaction rolls back and the new collage's photo directory is removed, so no
partial copy is left. A photo whose **source file does not exist** is skipped (logged + counted); every
other error fails the whole copy.

Why: one request is atomic (no half-remapped copy), reuses the existing patterns
(`GormStore.CreateWithFile`, `DiskStorage.Save`, `DeleteAllForCollage`), adds no dependency, and is fast
enough for typical collages (local disk, files < 2 MB).

## Context for a new agent

- **Sources read:** `AGENTS.md` (rules: no commits unless asked; no automated tests; verify with
  `go build ./... && go vet ./...` in `backend/` and `npx ng build` in `frontend/`; UI texts English and
  i18n-marked `i18n="@@<feature>.<key>"` / `$localize`; no new libraries without approval),
  `doc/architecture.md` (layering, API table at the "/api/collages" rows).
- **Key files and directories:**
  - `backend/internal/collage/service.go` — `Service` (`Create`, `Rename`, `Delete`, `SaveLayout`,
    `validName`), interfaces `Store`, `Photos`, `Transactor`. Gets `Duplicate`.
  - `backend/internal/collage/handler.go` — routes, `summaryResponse`. Gets the duplicate route/handler.
  - `backend/internal/collage/store.go` (GORM store for collages and texts; `Create`,
    `UpdateSettingsForUser`, `ListTexts`, `ReplaceTexts`).
  - `backend/internal/collage/model.go` — `Collage`, `CollageText` (`ID` = global primary key, string ≤ 64,
    UUID made by the frontend; therefore copied texts **must** get new ids).
  - `backend/internal/photo/collage_photos.go` — `CollagePhotos` implements `collage.Photos`
    (works on `Store` + `FileStorage` directly). Gets the copy method.
  - `backend/internal/photo/store.go` — `GormStore.CreateWithFile(ctx, p, writeFile)` (insert row, call
    `writeFile` with `p.ID` set, which sets `p.FileName` and writes the file, then saves `file_name`; uses
    `db.Conn(ctx, …)` so it joins the outer transaction), `ListByCollage`.
  - `backend/internal/photo/storage.go` — `DiskStorage.Save` (temp file + rename, atomic), `Open`,
    `RemoveDir`; paths relative to the photo dir, guarded by `os.Root`.
  - `backend/internal/photo/service.go` — `fileName(collageID, photoID, ext)` → `"12/345.jpg"`,
    `collageDir(collageID)`.
  - `backend/internal/photo/model.go` — `Photo` (`CollageID`, `ConnectorID *uint`, `SourceAssetID`,
    `FileName`, `MimeType`, `WidthPx`, `HeightPx`, `Props`); unique index
    `(collage_id, connector_id, source_asset_id)` is per collage, so copies do not conflict.
  - `frontend/src/app/core/api/collage.api.ts` — `CollageApi` (only place with `HttpClient` for collages).
  - `frontend/src/app/core/models/collage.ts` — `CollageSummary`, `COLLAGE_NAME_MAX_LENGTH = 200`,
    settings fields `center.centerPhotoId` and `background.image.photoId` (the only photo ids in any JSON
    document; photo props and text props contain no photo ids).
  - `frontend/src/app/features/collages/` — `collages.page.{ts,html}` (list with Rename/Delete icon
    buttons, `putFirst` helper, `NotificationService`), `collage-dialogs.service.ts`,
    `collage-rename-dialog.ts` (to be renamed to `collage-name-dialog.ts`), `collage-name.ts` (validators).
- **Existing patterns to follow:** `Service.SaveLayout` (transaction via `s.tx.InTx`), `Service.Delete`
  (photo cleanup via `s.photos`), `CollagesPage.rename` (dialog → API → `putFirst` → notification).
- **Commands:**
  - `cd backend && go build ./... && go vet ./...`
  - `cd frontend && npx ng build`
  - Dev: `make dev-up && make dev-shell`, then `make backend-run` (:8080) and `make frontend-serve` (:4200).
- **Environment / prerequisites:** dev data in `data/` (SQLite file + photo dir, photo files under
  `data/…/<collageId>/<photoId>.<ext>`; check `doc/development.md` for the exact paths). A user from
  `collageomat user add`.
- **Domain terms:** *settings* = collage-level JSON owned by the frontend; *props* = per-photo / per-text
  JSON owned by the frontend; *connector* = photo source (Immich); *upload* = photo with
  `ConnectorID = nil`.
- **External references:** none needed.

## Decision log

- **Entry point:** collage list only (icon button beside Rename/Delete); after the copy the user stays in
  the list and the copy appears at the top. — *Rationale:* smallest scope; the editor's unsaved-changes
  problem does not exist in the list. *Rejected:* "list, open copy"; "list + editor toolbar" (needs
  auto-save flush).
- **Copy name:** dialog prefilled with `"<name> (copy)"` (suffix localized), editable, same validation as
  rename (trimmed, required, ≤ 200 chars). If the default is longer than 200 chars, the original name part
  is cut so the result fits. — *Rejected:* fixed name without dialog; same name.
- **Photo id remap in settings:** done in the backend, inside the copy transaction, for exactly
  `center.centerPhotoId` and `background.image.photoId`. An id that is not in the map (skipped photo or
  stale id) becomes `null`; a `null` stays `null`; missing paths stay missing; all other JSON is kept as
  is. — *Rationale:* atomic, one request. Cost: the backend knows two field paths of the frontend-owned
  JSON — document this in both places (Go comment and a comment in `collage.ts`). *Rejected:* frontend
  remap with a second request (not atomic); set to null (loses data).
- **Text ids:** new UUID v4 per copied text, made by an own small helper in the `collage` package
  (16 bytes `crypto/rand`, version/variant bits, `8-4-4-4-12` hex). — *Rejected:* `github.com/google/uuid`
  as direct dependency (new library); `crypto/rand.Text()` (different format).
- **Photo fields:** the copy keeps `ConnectorID`, `SourceAssetID`, `MimeType`, `WidthPx`, `HeightPx`,
  `Props`; new are `ID`, `CollageID`, `FileName`, timestamps. — *Rationale:* skip-duplicate import logic
  works in the copy as in the original. *Rejected:* clearing `ConnectorID`.
- **File copy:** real stream copy, reuse `CreateWithFile` + `Open` + `Save` to
  `fileName(newCollageID, newPhotoID, ext)` (ext from the source `FileName`). On error: transaction
  rollback, then remove the whole new collage photo directory. — *Rejected:* hard links (quota double
  count, cross-filesystem failure).
- **Missing source file:** skip the photo only if opening the source file gives `fs.ErrNotExist`
  (log a warning with the path); every other error (read, write, DB) fails the whole copy. The response
  contains `skippedPhotos`; the UI shows it. — *Rationale:* developer prefers a usable copy over a failed
  one for a broken photo; write errors must never give a silent partial copy. *Rejected:* fail the whole
  copy; silent skip; skip on any read error.
- **Storage quota:** not handled now; a note is added to the Open questions of
  `doc/agent-plans/user-storage-quota.md` ("Duplicate collage copies photo files; the duplicate must check
  and count the copied bytes").
- **Large collages:** plain synchronous request, one transaction, no progress/limit; the button is
  disabled while the request runs. — *Rejected:* files-first with short transaction (more code);
  async job.
- **Dialog reuse:** `CollageRenameDialog` is renamed to `CollageNameDialog` (file
  `collage-name-dialog.ts`) and gets `title` and `submitLabel` in its data; `CollageDialogs` passes the
  localized texts for rename and duplicate. — *Rejected:* only adding data fields (keeps a misleading
  name); a copied dialog component.
- **API:** `POST /api/collages/{id}/duplicate`, body `{ "name": string }`, response `201` with the
  summary fields (`id`, `name`, `settings`, `photoCount`, `updatedAt`) plus `skippedPhotos: number`.
  Not found / other user → 404; invalid name → 400.
- **Testing:** no automated tests (project rule); build/vet + manual review.

## Testing strategy

No automated tests, manual review only. Each step: `go build ./... && go vet ./...` (backend) and/or
`npx ng build` (frontend), then the manual checks in the step's acceptance criteria.

## Steps

### Step 1 — Backend: duplicate endpoint
- **Status:** done (reviewed 2026-11-14)
- **What:**
  - `collage.Photos` gets `CopyAllForCollage(ctx, srcCollageID, dstCollageID uint) (idMap map[uint]uint,
    skipped int, err error)`; implemented in `photo.CollagePhotos` (list source photos id ascending; for
    each: open source file — on `fs.ErrNotExist` log warning + skip; else `CreateWithFile` with a new
    `Photo` (copied fields) and a `writeFile` that `Save`s the stream to
    `fileName(dst, p.ID, path.Ext(src.FileName))`; close the source file).
  - `collage.Service.Duplicate(ctx, userID, id uint, name string) (*DuplicateResult, error)` where the
    result holds the `Summary` and `SkippedPhotos`. Flow: `validName`; `InTx`: `FindForUser` →
    `store.Create` (same settings) → `photos.CopyAllForCollage` → remap settings → store settings →
    `store.ReplaceTexts` (or a create) with new UUIDs and same props. If `InTx` fails after the new
    collage id is known: call `photos.DeleteAllForCollage(ctx-without-tx, newID)` to remove the files
    (rows are already rolled back; the method is idempotent); log a cleanup error but return the original
    error.
  - Remap helper (pure function on `jsoncol.JSON`) for `center.centerPhotoId` and
    `background.image.photoId`.
  - UUID v4 helper.
  - Handler `POST /api/collages/{id}/duplicate` → 201 + `summaryResponse` fields + `skippedPhotos`.
- **Acceptance criteria:** `go build ./... && go vet ./...` pass. With `curl` (session cookie):
  duplicate a collage with photos, center photo, background image and texts → new rows in `collages`,
  `photos`, `collage_texts`; files exist in the new collage's photo dir; settings ids point to the new
  photos; text ids are new. Delete a source photo file first → `skippedPhotos: 1`, copy has one photo
  less. Other user's id → 404; empty name → 400.
- **Notes:** `go build ./... && go vet ./...` and `gofmt -l` pass.
  - New file `backend/internal/collage/duplicate.go`: `DuplicateResult` (`Summary` + `SkippedPhotos`),
    `Service.Duplicate`, `copyTexts` (uses `store.ReplaceTexts` on the new collage), `settingsPhotoIDPaths`
    + `remapSettingsPhotoIDs` / `remapPath` / `remapID`, `newTextID` (UUID v4).
  - `collage.Photos` (`service.go`) has `CopyAllForCollage`; implemented in
    `backend/internal/photo/collage_photos.go` (`CopyAllForCollage`, `copyPhoto`); no change to the photo
    `Store`/`FileStorage` interfaces.
  - Handler: route `POST /api/collages/{id}/duplicate`, `duplicateRequest`, `duplicateResponse`
    (embeds `summaryResponse` + `skippedPhotos`). Package doc in `model.go` mentions duplicate.
  - Comments at `centerPhotoId` and `ImageBackgroundSettings.photoId` in
    `frontend/src/app/core/models/collage.ts` point to the backend remap.
  - Decisions during the step: the transaction starts with a read (`FindForUser`), then the insert (the
    source settings are needed; the SQLite lock-upgrade risk is accepted and commented). The new collage
    is read again at the end so the response has the stored settings/`updatedAt`. If the remap changes
    something, the settings JSON is re-encoded (keys sorted, no whitespace; values unchanged); otherwise
    it stays byte-identical. A non-integer or negative number at a photo-id path becomes `null`. Cleanup
    after a failed transaction uses the context from before `InTx` (no transaction) and logs cleanup
    errors with `slog.Error`.

### Step 2 — Frontend: Duplicate action in the collage list
- **Status:** done (reviewed 2026-11-14)
- **What:** `CollageApi.duplicate(id, name)` + response type (`DuplicateCollageResponse` =
  `CollageSummary & { skippedPhotos: number }`) in `core/models/collage.ts`; rename
  `collage-rename-dialog.ts` → `collage-name-dialog.ts` (`CollageNameDialog`, data
  `{ name, title, submitLabel }`); `CollageDialogs.rename` passes its texts, new
  `CollageDialogs.duplicate(name)` builds the default name (cut to ≤ 200 chars); `content_copy` icon
  button between Rename and Delete (tooltip/aria "Duplicate"), disabled while that row's request runs;
  on success `putFirst` + notification "Collage duplicated" or, with skipped photos,
  "Collage duplicated. {n} photo(s) skipped (file missing)."; on error `notification.error(errorMessage)`.
  All texts i18n-marked.
- **Acceptance criteria:** `npx ng build` passes. In the UI: Duplicate opens the dialog with
  `"<name> (copy)"`, Cancel does nothing, Duplicate adds the copy at the top with the same photo count;
  open the copy → same layout, background, centre photo, texts; edit/delete the copy → original
  unchanged; delete the original → copy still shows all photos. Rename still works with its own texts.
- **Notes:** `npx ng build` and `npx prettier --check` pass.
  - `core/models/collage.ts`: `DuplicateCollageRequest`, `DuplicateCollageResponse`.
    `core/api/collage.api.ts`: `duplicate(id, name)`.
  - `collage-rename-dialog.ts` → `collage-name-dialog.ts` (`CollageNameDialog`,
    `CollageNameDialogData { name, title, submitLabel }`). `collage-dialogs.service.ts`: `rename` keeps
    its ids `@@collages.rename.title` / `@@collages.rename.submit`; new `duplicate(sourceName)` with
    `@@collages.duplicate.title`, `@@collages.duplicate.submit`, `@@collages.duplicate.defaultNameSuffix`
    (" (copy)"); helper `copyName()` cuts by Unicode code points (`Array.from`) like the backend.
  - `collages.page.{html,ts}`: `content_copy` button (`@@collages.action.duplicate`), `duplicatingIds`
    signal disables the row's button while the request runs.
  - Deviation: two messages instead of "photo(s)" — `@@collages.duplicatedWithSkippedOne` and
    `@@collages.duplicatedWithSkipped` (same pattern as `import-result-message.ts`; `$localize` has no
    ICU plurals). `NotificationService` has no warning variant, so the skipped case uses `success`.
  - No i18n message file exists in the repo (only `sourceLocale: en`), so nothing to extract.

### Step 3 — Docs
- **Status:** done (reviewed 2026-11-14)
- **What:** add the `POST /api/collages/{id}/duplicate` row in the API table of `doc/architecture.md`;
  add the quota note to the Open questions of `doc/agent-plans/user-storage-quota.md`.
- **Acceptance criteria:** read the diff.
- **Notes:** API row added after `DELETE /api/collages/{id}` in `doc/architecture.md`. In
  `doc/agent-plans/user-storage-quota.md` the existing open question "Does a duplicated collage (if ever
  implemented) count again?" was replaced by the concrete note (names `Service.Duplicate` and
  `CollagePhotos.CopyAllForCollage`).

## Open questions

- Storage quota: when `user-storage-quota` is implemented, the duplicate must check and count the copied
  bytes.
- Known, not part of this feature: the frontend name validator (`features/collages/collage-name.ts`,
  `Validators.maxLength`) and `[attr.maxlength]` count UTF-16 code units, the backend counts code points.
  A name with characters outside the BMP (e.g. emoji) is refused in the frontend before 200 code points
  (affects create, rename and duplicate).

## Current state / Next action

Done. All steps were reviewed and approved by the developer on 2026-11-14. Nothing is committed (the
dialog file rename is an unstaged delete + new file). No next action for this feature; see Open questions
for follow-ups.
