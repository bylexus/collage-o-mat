# Local file upload

**Ticket/Source:** Backlog of `doc/agent-plans/done/poc-implementation.md` (requested by the developer
2026-11-13; was out of the PoC scope). Grilled 2026-11-14.
**Branch:** none
**Status:** in progress

## Goal

A second photo source besides Immich: the logged-in user uploads image files (JPEG, PNG, WebP) from the
local computer into one of the own collages. Uploaded photos behave exactly like imported Immich photos
(arrangement, editing, swap, background, export).

## Scope

**In scope:**
- Backend route `POST /api/collages/{id}/uploads` (one file per request, raw body), session auth required,
  only into collages of the session user.
- Server-side image processing in pure Go: decode JPEG/PNG/WebP, apply EXIF orientation (JPEG), downscale
  to max 2560 px long edge, transparency on white, store as JPEG quality 90.
- Duplicate detection per collage by SHA-256 of the original bytes.
- Frontend: toolbar icon button "Upload from computer" → native file picker (multiple), 3 parallel uploads,
  progress "Uploading n / m", result/error snackbars, arrangement via the existing `applyImport`.

**Out of scope:**
- A connector type `local` / any row in `connectors` (rejected, see decision log).
- HEIC, AVIF, GIF input (rejected with a clear 400 message).
- Drag & drop onto the editor, an upload dialog with a drop zone.
- Storing the original file / original resolution.
- Upload only for the page background (the background stays one of the collage photos).
- Automated tests.

## Rough Architecture / Concept

Upload is a **push** from the browser, so it does not use the connector `Kind` strategy nor
`photo.Sources`/`Source.Preview` (those are for configured pull sources). Uploaded photos are normal rows in
`photos` with `connector_id = NULL` and `source_asset_id = "sha256:<hex of the original bytes>"`.

- **Backend** (`internal/photo`):
  - `process.go` (new): pure function that turns the uploaded bytes into a stored JPEG (`preview` struct as
    used by the Immich import: data, mimeType `image/jpeg`, ext `.jpg`, width, height). Steps: check
    Content-Type (`image/jpeg|png|webp`) → body max 50 MiB → `image.DecodeConfig` (format must match the
    Content-Type; max 60 megapixels, checked **before** the full decode) → `image.Decode` → EXIF orientation
    (JPEG only, `github.com/rwcarlsen/goexif`, tag Orientation 1–8, missing/broken EXIF = 1) → downscale long
    edge to ≤ 2560 px with `golang.org/x/image/draw.CatmullRom` (never upscale) → draw onto white RGBA
    background (removes transparency) → `image/jpeg` encode quality 90. Always re-encoded (also removes all
    EXIF/GPS metadata).
  - A server-wide semaphore (capacity 2, field of `Service`) limits concurrent decodes (a 60 MP decode needs
    ~240 MB RAM).
  - `Service.Upload(ctx, userID, collageID, contentType string, body io.Reader) (ImportResult, error)`:
    ownership check via `collages.Get` (other user / unknown → 404) → read body (limit) → SHA-256 →
    duplicate check (`collage_id`, `connector_id IS NULL`, `source_asset_id`) → skipped result → else process
    → create row + file with the same code as `importOne` (extracted shared helper, no copy).
  - `handler.go`: `POST /api/collages/{id}/uploads` wrapped with `requireAuth` (existing session cookie
    auth), `http.MaxBytesReader` 50 MiB (→ 413). Response = `importResponse` (`{photos:[...], skipped}`).
  - `httpapi.RequireJSON`: one explicit exception — `POST` on paths matching `/api/collages/{id}/uploads`
    may have Content-Type `image/jpeg`, `image/png` or `image/webp`. These are not CORS-safelisted, so a
    cross-site page needs a preflight → same CSRF protection as JSON.
- **Frontend**:
  - `PhotoApi.upload(collageId, file: File)` → `POST` with the `File` as body and `Content-Type: file.type`.
  - Editor toolbar: icon button next to "Import from Immich"; hidden `<input type="file" multiple
    accept="image/jpeg,image/png,image/webp">`. While uploading: button disabled, progress "Uploading n / m"
    in the toolbar; editing stays possible; leaving the page cancels open requests.
  - At the end: merge all results → one `store.applyImport({photos, skipped})` (same re-arrange question as
    after an Immich import) → success snackbar `importResultMessage(...)`; failed files → error snackbar with
    file names and reasons (`errorMessage(err)`).

## Context for a new agent

- **Sources read:**
  - `doc/agent-plans/done/poc-implementation.md` — architecture conventions (one package per domain:
    `model.go`, `store.go` (only GORM user), `service.go` (rules, no `net/http`, depends on consumer
    interfaces), `handler.go` (HTTP only, implements `httpapi.Module`); `apperr` errors mapped centrally by
    `httpapi.WriteServiceError`; `auth.UserID(r)`; ownership miss → 404; errors wrapped with context; doc
    comments; i18n ids `@@<feature>.<key>`; frontend: API services in `core/api/` are the only `HttpClient`
    users, `shared/` has `NotificationService`, `errorMessage(err)`, `ConfirmDialog`; signals, standalone,
    OnPush). Data model `photos`: `id`, `collage_id` FK CASCADE, `connector_id` nullable FK SET NULL,
    `source_asset_id` (size 200), `file_name` (relative to `data/photos/`), `mime_type`, `width_px`,
    `height_px`, `props` JSON (`{}` until arranged); unique index `(collage_id, connector_id,
    source_asset_id)` — NULL `connector_id` never conflicts. CSRF rule: mutating `/api/` requests need
    `Content-Type: application/json` (with `SameSite=Lax` session cookie). JSON bodies max 1 MiB.
  - `doc/agent-plans/done/page-background.md` — background image = one of the collage photos (upload for the
    background alone is out of scope).
- **Key files and directories:**
  - `backend/internal/photo/service.go` — `Service`, `Import`, `importOne` (row + file creation to reuse),
    `ImportResult`, `Store`, `FileStorage`, `Collages`.
  - `backend/internal/photo/preview.go` — `preview` struct, `readPreview`, `maxPreviewBytes`, registered
    decoders (jpeg, webp).
  - `backend/internal/photo/store.go` — `GormStore` (`CreateWithFile`, `ExistingSourceAssetIDs` — uses
    `connector_id = ?`, needs an `IS NULL` variant for uploads).
  - `backend/internal/photo/handler.go` — routes, `importResponse`, `views()`.
  - `backend/internal/httpapi/middleware.go` — `RequireJSON`.
  - `backend/cmd/collageomat/main.go` — wiring (`newDomainModules`).
  - `frontend/src/app/core/api/photo.api.ts`, `frontend/src/app/core/models/photo.ts` (`ImportResult`).
  - `frontend/src/app/features/editor/editor.page.{ts,html}` — toolbar, `openImport()`, `importLabel`.
  - `frontend/src/app/features/editor/editor.store.ts` — `applyImport(result)`.
  - `frontend/src/app/features/editor/import/import-result-message.ts` — `importResultMessage`.
- **Existing patterns to follow:** Immich import (`photo.Service.Import` / `importOne`, `readPreview`);
  `openImport()` in `editor.page.ts` for the result handling.
- **Commands:** see "Commands" in `doc/agent-plans/done/poc-implementation.md` (Makefile targets). Backend
  checks: `cd backend && go build ./... && go vet ./...`; frontend: `cd frontend && npx ng build`.
- **Environment / prerequisites:** sandbox notes in `poc-implementation.md` "Current state" (dev container may
  bind `:8080`/`:4200`; use other ports + scratch proxy config for host tests; stop own servers with
  `lsof -ti tcp:<port> | xargs kill`).
- **Domain terms:** *upload* = push of a local file; *import* = pull from a connector (Immich).
- **External references:**
  - `github.com/rwcarlsen/goexif` — only version on proxy.golang.org: `v0.0.0-20190401172101-9e8deecbddbd`
    (unmaintained since 2019; accepted by the developer).
  - Fetch spec, CORS-safelisted request headers: only `application/x-www-form-urlencoded`,
    `multipart/form-data`, `text/plain` are safelisted Content-Types → `image/*` needs a preflight.

## Decision log

- **Model:** plain upload, no connector (`connector_id = NULL`) — *Rationale:* a `local` `Kind` would have no
  config and no test; upload is a push, not a pull. Rejected: connector type `local`.
- **Conversion location:** server, pure Go — *Rationale:* developer choice. Rejected: conversion in the
  browser (canvas), keep original.
- **Max size:** long edge 2560 px, never upscale — *Rationale:* better print quality than Immich previews
  (1440 px) at acceptable file size. Rejected: 1440, 3600, no downscale.
- **Input formats:** JPEG, PNG, WebP; output always JPEG — *Rationale:* pure Go decoders available (stdlib +
  `x/image/webp`, already a dependency). HEIC/AVIF need CGO or large deps; GIF not needed.
- **EXIF orientation:** library `github.com/rwcarlsen/goexif`, JPEG only — *Rationale:* developer choice.
  Rejected: own small parser. Risk: library unmaintained since 2019.
- **Transport:** one file per request, 3 parallel from the frontend — *Rationale:* per-file progress and
  errors, bounded server memory. Rejected: all files in one request.
- **Limits:** body ≤ 50 MiB (413), ≤ 60 megapixels (400, checked before decode), max 2 concurrent decodes
  server-wide — *Rationale:* protect server memory.
- **Request format / CSRF:** raw body with Content-Type `image/jpeg|png|webp`; `RequireJSON` allows exactly
  these types on exactly this route — *Rationale:* not CORS-safelisted → preflight → same protection as
  JSON; no multipart parsing. Rejected: multipart + custom header.
- **Authentication / ownership (developer requirement):** the upload route is wrapped with the existing
  session auth (`requireAuth`, session cookie); the service checks that the collage belongs to the session
  user (`collages.Get`), otherwise 404. Photos always go into a collage of the session user.
- **Duplicates:** skip by SHA-256 of the original bytes (`source_asset_id = "sha256:<hex>"`), checked in the
  service for (`collage_id`, `connector_id IS NULL`, `source_asset_id`); duplicate → 200 with `skipped: 1`.
  A race of two identical parallel uploads is accepted. Rejected: allow duplicates.
- **UI entry point:** toolbar icon button only, native file picker (multiple). Rejected: drag & drop, upload
  dialog.
- **After the batch:** failed files do not stop others; one `applyImport` with all new photos, success
  snackbar, error snackbar with failed file names + reasons. Rejected: stop on first error.
- **Encoding:** JPEG quality 90, transparent pixels on white. Rejected: Q 85, collage background colour.
- **Resampling:** `x/image/draw.CatmullRom` (best quality of `x/image/draw`).
- **Error mapping:** bad file content / unsupported format / too many pixels → `apperr.Validation` (400 with a
  message); body too large → 413; wrong Content-Type on the route → 415 (from `RequireJSON`).

## Testing strategy

No automated tests, manual review only (same as the PoC).

## Steps

### Step 1 — Backend upload endpoint and image processing
- **Status:** implemented, review pending
- **What:** `goexif` dependency; `internal/photo/process.go`; decode semaphore; `Service.Upload` with
  duplicate check and shared row+file helper (refactor `importOne` to use it); store method for the
  `connector_id IS NULL` duplicate lookup; handler route `POST /api/collages/{id}/uploads` with
  `requireAuth` and `MaxBytesReader`; `RequireJSON` exception; PNG decoder registration.
- **Acceptance criteria:**
  - `curl` with the session cookie: rotated phone JPEG → stored upright, ≤ 2560 px, `.jpg`, row with
    `connector_id NULL`, `source_asset_id` `sha256:...`; PNG with transparency → white background; WebP OK.
  - Same file again → 200, `skipped: 1`, no new row.
  - HEIC or a text file sent as `image/jpeg` → 400 with message; > 50 MiB → 413; `Content-Type: text/plain`
    → 415; no session → 401; collage of another user → 404.
  - Immich import still works.
- **Notes:**
  - Files: `backend/go.mod`/`go.sum` (goexif); `internal/photo/process.go` (new: limits constants incl. exported
    `MaxUploadBytes`, `uploadFormat`, `processUpload`, `checkUploadConfig`, `flattenScaled` (white + CatmullRom),
    `exifOrientation` (recovers goexif panics → orientation 1, logged), `orient`/`sourcePixel` for the 8
    orientations; registers the PNG decoder); `internal/photo/service.go` (`decodeSlots` semaphore cap 2 made in
    `NewService` (signature unchanged), shared `createPhoto` helper used by `importOne` and `Upload`, `Upload`,
    `processLimited` (ctx-aware slot wait), `readUpload`, `uploadAssetID`; `Store.UploadExists`);
    `internal/photo/store.go` (`GormStore.UploadExists`, `connector_id IS NULL`); `internal/photo/handler.go`
    (route + `http.MaxBytesReader(MaxUploadBytes)`); `internal/httpapi/middleware.go` (`allowedContentType`,
    `isUploadPath` for `/api/collages/<digits>/uploads`, image types only for POST); `internal/httpapi/errors.go`
    (`apperr.ErrTooLarge` and `*http.MaxBytesError` → 413); `internal/apperr/apperr.go` (`ErrTooLarge`);
    `internal/photo/model.go` (doc comments only). `main.go` unchanged.
  - Order: the image is downscaled + flattened first, then oriented (same result, less work).
  - Duplicate check runs on the raw bytes **before** the image checks: identical bytes already in the collage
    → `skipped: 1` even with a wrong (allowed) image Content-Type.
  - Extra cases: empty body → 400 "the uploaded file is empty"; decoded format ≠ Content-Type → 400 "image data
    is png, but Content-Type is image/jpeg"; client gone while waiting for a decode slot → 500 (wrapped ctx
    error). The service also checks the Content-Type (400) but over HTTP `RequireJSON` answers 415 first.
  - Agent e2e check on 127.0.0.1:18080 (scratch data dir): all acceptance cases OK incl. all 8 EXIF
    orientations (quadrant colour test), PNG/WebP transparency → white, 8000×8000 PNG → 400, 51 MiB → 413.
    Immich import not tested (no Immich instance); the refactor only moved row+file code into `createPhoto`.

### Step 2 — Frontend upload button and batch handling
- **Status:** implemented, review pending
- **What:** `PhotoApi.upload`; toolbar button + hidden file input in `editor.page`; batch upload with 3
  parallel requests, progress "Uploading n / m", cancel on page leave; merged result → `applyImport`,
  success and error snackbars; i18n ids.
- **Acceptance criteria:** in the browser, upload 10 mixed files incl. 1 HEIC → progress visible, 9 photos
  arranged (re-arrange question when the layout has work), error snackbar names the HEIC file; same files
  again → "skipped"; export contains the uploaded photos.
- **Notes:**
  - Files: `frontend/src/app/core/api/photo.api.ts` (`upload(collageId, file)`, File as body, `Content-Type:
    file.type`); `core/models/photo.ts` (doc comment only); `features/editor/upload/upload-batch.ts` (new:
    `uploadBatch(files, upload)` — type pre-filter, max 3 parallel via `mergeMap`, merged state);
    `features/editor/upload/upload-failure-message.ts` (new: one-line failure text, max 3 file names + "and n
    more"); `features/editor/editor.page.{ts,html,scss}` (button `upload_file` left of "Import from Immich",
    hidden file input reset after selection, `uploadProgress` signal, "Uploading n / m" with small spinner,
    `uploadFiles`, `finishUpload`).
  - Cancel: subscription unsubscribed in `DestroyRef.onDestroy` (not `takeUntilDestroyed`, which completes the
    stream and would run the final handler after destroy) → no `applyImport`/snackbar after leaving the page.
  - `applyImport` is called once without a guard; it returns at once for an empty photo list
    (`editor.store.ts`), same as the Immich flow.
  - Snackbars: `MatSnackBar` shows one at a time, so with partial failures one error snackbar holds both texts
    (`@@editor.upload.partial`: "<importResultMessage>. <failure text>", 8 s, "Close"); no failures → normal
    success snackbar; nothing succeeded/skipped → failure text only.
  - Pre-filter message: "unsupported format, only JPEG, PNG and WebP" (no request sent).
  - New i18n ids: `@@editor.uploadButton`, `@@editor.upload.progress`, `@@editor.upload.unsupportedFormat`,
    `@@editor.upload.failedOne`, `@@editor.upload.failedMany`, `@@editor.upload.failedList`,
    `@@editor.upload.failedWithMore`, `@@editor.upload.partial`. No translation files exist (en only).
  - Not changed: empty-collage hint `@@editor.noPhotos` still says "Import photos from Immich."
  - `npx ng build` OK; `npx prettier --check src/app` OK (no lint script). Not yet tested in a browser.

## Open questions

- Risk: `rwcarlsen/goexif` is unmaintained (last commit 2019-04-01).

## Current state / Next action

- Plan approved 2026-11-14. The developer asked to implement all steps (via sub-agents) and then review.
- Steps 1 and 2 implemented (not committed), waiting for the developer's manual review. After approval: set
  both steps to `done (reviewed <date>)`, `**Status:** done`.
- No temporary changes to revert. Agent scratch test data lives outside the repo.
