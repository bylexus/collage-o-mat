# Immich import size (preview or original)

**Ticket/Source:** none (rough idea of the developer, 2026-11-14)
**Branch:** none
**Status:** done

## Goal

When the user imports photos from an Immich connector, the user chooses the image size in the import
dialog: the big Immich thumbnail ("preview", as before, about 1440 px) or the original size. The original
gives a better quality in a print export at high DPI.

## Scope

**In scope:**
- A size choice "Preview | Original" in the Immich import dialog (remembered per browser).
- Backend downloads the chosen size from Immich; originals are re-encoded (upright JPEG, full resolution).
- Assets that cannot be processed in original size are greyed out in the asset grid in original mode.
- Info about assets that Immich could only deliver in preview size.
- API key permission `asset.download` documented as a standard permission (hint text, docs).

**Out of scope:**
- Upgrade / re-import of photos that are already in the collage (an asset already in the collage is still
  skipped, also when the size is different).
- A per-connector or per-user default size setting (only localStorage in the browser).
- Changes to the local upload (`processUpload`, 2560 px limit stays).
- A smaller display copy for the editor canvas (the canvas loads the full file).
- New DB column for the import size (YAGNI; `WidthPx`/`HeightPx` show the real size).
- Other download limits for originals (same as preview: 50 MiB, 30 s, 4 workers).
- AVIF/GIF/BMP decoding, RAW/HEIC decoding in Go, videos.

## Rough Architecture / Concept

- **Immich side:** "original" uses `GET /api/assets/{id}/thumbnail?size=fullsize`. Immich answers:
  - original is a web format (JPEG, PNG, WebP, AVIF, GIF, BMP, ...): 302 redirect to
    `/api/assets/{id}/original` (unchanged original bytes, needs key permission `asset.download`);
  - original is HEIC/RAW/TIFF/JXL and the Immich server setting "full-size image generation"
    (`image.fullsize.enabled`) is on: the converted full-resolution image (JPEG/WebP, or JXL if the admin
    chose JXL);
  - same, but the setting is off: 302 redirect to `?size=preview` (the preview). Collage-o-mat detects this
    from the final request URL (`resp.Request.URL`, query `size=preview`) and counts it as a "preview
    fallback".
  The Go HTTP client follows these redirects (same host only, `sameHostRedirectsOnly` in `client.go`).
- **Processing of originals:** read max 50 MiB, then `imaging.Format(contentType)` +
  `imaging.Process(data, format, Options{MaxEdge: <no practical limit>, Quality: 90})` inside the shared
  decode limiter (`Service.decoder.Do`). `imaging.Process` accepts JPEG/PNG/WebP, refuses > 60 MP
  (`imaging.MaxPixels`), applies EXIF orientation, flattens transparency on white, strips metadata and
  writes a JPEG. No downscaling for originals.
- **Preview fallback** results are stored like a normal preview import (`readPreview`, as before).
- **API:** `POST /api/collages/{id}/import` body `{connectorId, assetIds, size}`; `size` is `"preview"` or
  `"original"`, missing/empty = `"preview"`, other values = 400 validation error. Response
  `{photos, skipped, previewFallbacks}`.
- **Frontend:** `mat-button-toggle-group` "Preview | Original" in the selection bar of the import dialog.
  The choice is stored in localStorage (wrapped in try/catch), default Preview. In original mode, assets with
  `mimeType` `image/avif`, `image/gif`, `image/bmp`, or with `width × height > 60_000_000`, are greyed out
  with an "unsupported in original size" info and cannot be selected; switching to original deselects them.
  The success message adds the number of preview fallbacks.

**Why this architecture:**
- `size=fullsize` covers all formats with one call: true originals for web formats, Immich's own conversion
  for HEIC/RAW (Go cannot decode those without new libraries), a graceful fallback otherwise.
- Re-encoding via the existing `imaging` package reuses the upload pipeline (DRY): correct upright pixel
  size in `WidthPx`/`HeightPx`, no GPS/EXIF metadata in stored files, only JPEG files on disk.
- Grey-out in the frontend avoids failed batch imports (an asset error stops the remaining downloads).

## Context for a new agent

- **Sources read:**
  - `doc/architecture.md` — layering: domain packages under `backend/internal/<domain>/`, HTTP handlers in the
    domain package, errors via `apperr`, frontend `HttpClient` only in `frontend/src/app/core/`.
  - Immich server source (`main` branch, 2026-11-15):
    `server/src/services/asset-media.service.ts` (`viewThumbnail`),
    `server/src/controllers/asset-media.controller.ts`, `server/src/dtos/asset-media.dto.ts`
    (`AssetMediaSize`: `original`, `fullsize`, `preview`, `thumbnail`), `server/src/services/media.service.ts`,
    `server/src/utils/mime-types.ts` (`isWebSupportedImage`: jpg, jpeg, jfif, png, webp, avif, gif, bmp).
    Facts: `/thumbnail` needs `asset.view` for all sizes; `/original` needs `asset.download`; `fullsize` for
    web formats without edits redirects to `/original`; `fullsize` without a generated fullsize file
    redirects to `size=preview`; `size=original` on `/thumbnail` is deprecated (v3).
- **Key files and directories:**
  - `backend/internal/photo/service.go` — `Source` interface (`Preview` today), `Service.Import`,
    `importAll`, `importOne`, `download`, `assetError`, `ImportResult`.
  - `backend/internal/photo/preview.go` — `readPreview` (JPEG/WebP only, `maxPreviewBytes` 50 MiB).
  - `backend/internal/photo/process.go` — `processUpload` (pattern for calling `imaging.Process` in the
    decode limiter), `MaxUploadBytes`, `uploadJPEGQuality` = 90.
  - `backend/internal/photo/handler.go` — `importRequest`, `importResponse`, `importAssets`.
  - `backend/internal/imaging/imaging.go` — `Format`, `Process`, `Options`, `MaxPixels` (60 MP).
  - `backend/internal/connector/immich/client.go` — `Client.Thumbnail`, `do`, `StatusError`,
    `sameHostRedirectsOnly`, `requestTimeout` (30 s).
  - `backend/internal/connector/immich/types.go` — `ThumbnailSize` constants, `Asset`
    (`OriginalMimeType`, `Width`, `Height`).
  - `backend/internal/connector/immich/service.go` — `previewSource` (implements `photo.Source`),
    `upstream`.
  - `backend/internal/connector/immich/handler.go` — asset DTO of the proxy route
    `GET /api/connectors/{id}/immich/albums/{albumId}/assets`.
  - `backend/internal/connector/immich/kind.go` — mentions the key permissions.
  - `frontend/src/app/core/models/immich.ts` — `ImmichAsset` DTO.
  - `frontend/src/app/core/models/photo.ts` — `ImportResult`.
  - `frontend/src/app/features/editor/import/import-dialog.{ts,html,scss}` — dialog, selection bar.
  - `frontend/src/app/features/editor/import/asset-grid.ts` — asset grid (selection, imported state).
  - `frontend/src/app/features/editor/import/import-result-message.ts` — success text.
  - `frontend/src/app/features/connectors/immich-config-form.ts` — API key permission hint
    (`@@connectors.immich.apiKeyPermissions`).
  - `doc/architecture.md` — API table (line with `POST /api/collages/{id}/import`), `photo` package row.
- **Existing patterns to follow:** `processUpload` (`process.go`) for imaging in the limiter; `apperr`
  error kinds (`apperr.Validation`, `apperr.Upstream`); i18n `i18n="@@<feature>.<key>"` and `$localize`.
- **Commands:**
  - Backend (in `backend/`): `go build ./... && go vet ./...`
  - Frontend (in `frontend/`): `npx ng build`
  - Dev: `make dev-up && make dev-shell`, then `make backend-run` and `make frontend-serve`
    (http://localhost:4200).
- **Environment / prerequisites:** Immich test server and API key in `/.env` (git-ignored). For original
  imports the key needs `asset.download`.
- **Domain terms:** *preview* = Immich thumbnail size `preview` (about 1440 px); *original* = Immich
  `fullsize` (original bytes or converted full-res image); *preview fallback* = an original request that
  Immich answered with the preview.
- **External references:** https://github.com/immich-app/immich (files above, `main` as of 2026-11-15).

## Decision log

- **Source of "original":** `GET /assets/{id}/thumbnail?size=fullsize`, follow redirects. — *Rationale:*
  one call for all formats; HEIC/RAW are converted by Immich. Rejected: `/assets/{id}/original` directly
  (HEIC/RAW not decodable in Go); fullsize without following the redirect (JPEG originals would never work).
- **Preview fallback (HEIC/RAW, fullsize generation off in Immich):** accept and store the preview, count
  it (`previewFallbacks` in the response), show an info in the dialog. — *Rationale:* a batch should not
  fail; the user should know why quality is lower. Rejected: silent; fail the asset.
- **Processing of originals:** re-encode via `imaging.Process` (upright, metadata stripped, JPEG q90). —
  *Rationale:* DRY with upload, correct dimensions, no GPS data. Rejected: store bytes as they are; hybrid.
- **Unsupported assets in original mode:** greyed out in the asset grid with an info, not selectable:
  original MIME type `image/avif`, `image/gif`, `image/bmp`, or `width × height > 60_000_000`. In preview
  mode all assets are selectable. Assets with unknown size (width/height 0) stay selectable. — *Rationale:*
  these are sent unchanged by Immich and Go/`imaging` cannot process them; avoids failed batches.
  The developer first asked to grey out RAW too; RAW/HEIC are fine because Immich converts them.
  Remaining runtime risk: an Immich fullsize format JXL fails at import with a clear message.
- **Max edge / quality of originals:** no scaling (only the 60 MP decode limit), JPEG quality 90.
- **Download limits for originals:** same as preview: 50 MiB per file, 30 s per request, 4 workers. —
  Rejected: 100 MiB / 2 min / 2 workers.
- **Key permission `asset.download`:** connector hint text and docs list `album.read`, `asset.read`,
  `asset.view`, `asset.download` as the standard permissions for a new key. A 403 on an original import
  gives the message "Original size needs the permission asset.download on the Immich API key".
  Rejected: probing the permission in "Test connection" (no cheap probe without an asset id).
- **UI of the choice:** `mat-button-toggle` "Preview | Original" in the selection bar of the import dialog,
  remembered in localStorage, default Preview.
- **Scope / data model:** no upgrade of existing photos, no per-connector default, no local upload change,
  no canvas display copy, no new DB column.
- **API shape:** request field `size` (`"preview"` default, `"original"`, else 400); response field
  `previewFallbacks` (int).
- **Implementation mode:** the developer approved the plan on 2026-11-15 and asked to implement all steps
  in sub-agents without a review stop between steps; questions are still asked.

## Testing strategy

No automated tests (project rule in `AGENTS.md`). Each step: `go build ./... && go vet ./...` (in
`backend/`) and `npx ng build` (in `frontend/`). Manual test: import the same asset with both sizes against
the test Immich server, compare pixel size; a HEIC asset with fullsize generation off gives a preview
fallback info; AVIF/GIF/BMP and > 60 MP assets are greyed out in original mode.

## Steps

### Step 1 — Backend: size parameter, original processing, Immich fullsize
- **Status:** done (reviewed 2026-11-15)
- **What:**
  - `photo`: type `ImageSize` (`SizePreview = "preview"`, `SizeOriginal = "original"`) with parse/validate.
    `Source.Preview` → `Source.Image(ctx, assetID, size)` returning body, Content-Type and `fallback bool`.
    `Import` gets a `size` argument; `importAll`/`importOne`/`download` pass it. Original (not fallback):
    read max 50 MiB, `imaging.Format` + `imaging.Process` (no scaling, quality 90) in `s.decoder.Do`.
    Fallback or preview: `readPreview` as before. `ImportResult.PreviewFallbacks` counts fallbacks.
  - `photo/handler.go`: `importRequest.Size`, `importResponse.PreviewFallbacks` (`previewFallbacks`); the
    upload response sends `previewFallbacks: 0`.
  - `immich`: `ThumbnailSizeFullsize = "fullsize"`; `Client.Thumbnail` reports whether the final response
    URL has `size=preview` when `fullsize` was requested; `previewSource` → implements `Source.Image`; a
    403 `StatusError` on the `/original` path gives the specific `asset.download` message (upstream error).
    Asset DTO in `handler.go` gets `mimeType` (from `OriginalMimeType`).
- **Acceptance criteria:** build + vet OK. `curl` import with `"size":"original"` stores a JPEG with the
  full upright pixel size; without `size` it works as before; `"size":"x"` gives 400; key without
  `asset.download` gives the specific message; HEIC asset with fullsize generation off →
  `previewFallbacks: 1`.
- **Notes:**
  - `photo/service.go`: `ImageSize`, `ParseImageSize` (empty → preview, unknown → validation error
    `size must be "preview" or "original"`), `SourceImage{Body, ContentType, Fallback}`,
    `Source.Image(ctx, assetID, size)`, `ImportResult.PreviewFallbacks` (counted under the `importAll`
    mutex). `download` is now a `Service` method. The handler parses `size` before `Import`; `Import`
    checks it again.
  - `photo/process.go`: `processOriginal` (+ `readOriginal`: max `maxPreviewBytes` 50 MiB, empty body is an
    error), constants `maxOriginalEdge = 1 << 16`, `originalJPEGQuality = 90`. Validation errors of
    `imaging` are converted to upstream errors (same message), because `httpapi.WriteServiceError` checks
    validation before upstream. Errors → 502 `import of asset "<id>" failed: <message>`.
  - `immich/client.go`: `Thumbnail` returns an extra `previewFallback bool`; `do` builds `StatusError` from
    `resp.Request` (path of the request that failed, after redirects).
  - `immich/service.go`: `previewSource` renamed to `imageSource`; 403 on a path ending in `/original` →
    `Original size needs the permission asset.download on the Immich API key`. Only 403 is mapped (a wrong
    key gives 401 on the first request, before any redirect).
  - `immich/handler.go`: asset DTO has `mimeType`.
  - The developer added a README section "Connect an Immich server" listing the four permissions
    (`asset.read`, `asset.download`, `asset.view`, `album.read`) — not part of the agent's work, kept.

### Step 2 — Frontend: size toggle, grey-out, result message
- **Status:** done (reviewed 2026-11-15)
- **What:** `ImmichAsset.mimeType`; `ImportResult.previewFallbacks`; toggle in the selection bar with
  localStorage (try/catch) and default Preview; the import request sends `size`; asset grid greys out
  unsupported assets in original mode (info text/tooltip, not selectable, deselected on switch); result
  message adds "N only available in preview size" when `previewFallbacks > 0`. All texts i18n.
- **Acceptance criteria:** `npx ng build` OK; toggle visible after choosing an album and remembered after
  reopening the dialog; AVIF/GIF/BMP/> 60 MP assets greyed out only in original mode; import in both modes
  works; fallback info shown.
- **Notes:**
  - `core/models/photo.ts`: `ImportSize = 'preview' | 'original'`, `ImportRequest.size`,
    `ImportResult.previewFallbacks`. `PhotoApi.import()` keeps its signature (size is in `ImportRequest`).
  - New `features/editor/import/original-size.ts`: `supportsOriginalSize(asset)` (the grey-out rule).
  - `import-dialog.ts`: `size` signal from localStorage key `collageomat.importSize` (try/catch, default
    preview); `setSize()` stores it and removes unsupported assets from the selection; computed
    `unavailableIds` (only in original mode); "Select all" skips unsupported assets.
  - `asset-grid.ts`: input `unavailableIds` (same pattern as `importedIds`): disabled, faded tile with badge
    "Not available in original size", `title` with the reason (one general reason text).
  - `import-result-message.ts`: appends ", N only available in preview size" (one i18n id, like the
    "skipped" text). `upload/upload-batch.ts` sums `previewFallbacks` (0) so the upload message still works.
  - New i18n ids: `import.size.label`, `import.size.ariaLabel`, `import.size.preview`,
    `import.size.original`, `import.assets.originalUnavailable`, `import.assets.originalUnavailableReason`,
    `editor.import.importedWithPreviewFallbacks`. No extracted message files exist in the project.

### Step 3 — Docs and hint text for `asset.download`
- **Status:** done (reviewed 2026-11-15)
- **What:** connector hint text (`immich-config-form.ts`) lists `asset.download` (standard permission for
  a new key, needed for original size); comment in `immich/kind.go`/`client.go` where permissions are
  listed; `doc/architecture.md`: import API (`size`, `previewFallbacks`) and `photo` package row (original
  imports via `imaging`, no scaling).
- **Acceptance criteria:** diffs read correctly; `npx ng build` OK.
- **Notes:**
  - Hint text: "Needs the permissions album.read, asset.read, asset.view and asset.download (for the
    original size)." (same i18n id).
  - `doc/architecture.md`: import API row (`size`, `previewFallbacks`) and `photo` package row updated.
  - No backend comment lists all key permissions, so no comment changed (`Thumbnail` / `ThumbnailSizeFullsize`
    comments mention `asset.download` since Step 1). `doc/development.md` / `doc/deployment.md` do not
    describe Immich permissions; unchanged.
  - On request of the developer: the `doc/architecture.md` API row of
    `GET /api/connectors/{id}/immich/albums/{albumId}/assets` lists the item fields incl. `mimeType`.

## Open questions

(none)

## Current state / Next action

All 3 steps implemented and approved by the developer on 2026-11-15. Plan moved to
`doc/agent-plans/done/`. Nothing committed by the agent.
