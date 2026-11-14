# Photo adjustments (simple image correction)

**Ticket/Source:** none (rough idea of the developer, 2026-11-14)
**Branch:** none
**Status:** planning

## Goal

The user applies simple image corrections to a photo in the editor: brightness, contrast and some colour
filters (e.g. sepia, greyscale). The corrections are done in the frontend (JS / canvas filters), are
non-destructive (the stored photo file does not change), are visible on the canvas and are in the export.

## Scope

**In scope:** per-photo brightness ("lightning" in the idea), contrast and a small set of colour filters
(e.g. sepia, greyscale), done with frontend filters.
**Out of scope:** to be decided in the grilling. Expected: changing the stored image file (backend), curves,
levels, white balance, sharpen/denoise, red-eye, presets per collage, backend changes.

## Rough Architecture / Concept

Not decided yet (planning phase). Expected: frontend only.

- Data: a new optional field in `PhotoProps` (`core/models/photo.ts`), e.g.
  `adjust: { brightness, contrast, filter }`. `photos.props` is a JSON document owned by the frontend, so
  no backend change is expected. Old photos without the field = no adjustment.
- Rendering: `PhotoView` (`features/editor/canvas/photo-view.ts`) draws the photo with a `Konva.Image`. Two
  options to decide:
  - Konva filters (`Konva.Filters.Brighten`, `Contrast`, `Sepia`, `Grayscale`, ...): need `node.cache()`;
    pixel processing in JS; can be slow for large source images and must be re-cached on crop/size change.
  - Canvas 2D `ctx.filter` (CSS filter syntax: `brightness()`, `contrast()`, `sepia()`, `grayscale()`,
    `saturate()`, ...): fast (GPU), but browser support must be checked (historically missing in Safari).
- Export: `canvas/page-image-renderer.ts` renders the page offscreen with the same `PhotoView`, so the
  adjustments are in the export if `PhotoView` applies them (check at the export DPI).
- UI: a section in the photo properties panel (`features/editor/photo-panel/`) with sliders / number fields
  and a filter select, live preview while dragging (like the border preview in `EditorStore`), one undo step
  on commit, "Reset" button.

## Open questions (for the grilling)

- Which filters exactly (sepia, greyscale, saturation, warm/cold, invert, blur, ...)? One filter at a time
  or combinable with strength?
- Konva filters or canvas `ctx.filter`? Browser support needed (Safari)? Performance with large images.
- Per photo only, or also "apply to all photos" / a collage default (like the default border)?
- Live preview while a slider moves: performance limit, debounce?
- Does the page background photo (`settings.background` photo) also get adjustments?
- Value ranges and defaults (e.g. brightness -100..100, contrast -100..100).
- Thumbnails in other places (photo lists, import) show the adjustment or the original?

## Context for a new agent

- **Read first:** `doc/architecture.md`; `doc/agent-plans/done/poc-implementation.md` (data model:
  `photos.props` JSON owned by the frontend); `doc/agent-plans/done/page-background.md` (background photo).
- **Facts from the code (2026-11-14):**
  - `PhotoProps` (`core/models/photo.ts`): frame (`cxMm, cyMm, widthMm, heightMm, rotationDeg`), `z`,
    `crop` (normalized rect), `border`. No adjustment fields today.
  - `PhotoView` (`features/editor/canvas/photo-view.ts`): `Konva.Group` with a `Konva.Image` (source crop in
    source pixels) and a border `Konva.Rect`. No filters or `cache()` today.
  - Export: `features/editor/canvas/page-image-renderer.ts` (offscreen Konva, uses `PhotoView` and
    `loadImage` from `canvas/image-cache.ts`).
  - Photo panel: `features/editor/photo-panel/photo-properties-panel.*` (border, z-order, background,
    delete).
  - Preview pattern: `EditorStore.previewPhotoBorder()` / `setPhotoBorder()` in
    `features/editor/editor.store.ts` (preview not saved, commit = one undo step).
- **Rules:** no new libraries without the developer's approval (Konva is already in use).
- **Commands:** `cd frontend && npx ng build`; dev via `make dev-up`, `make frontend-serve`,
  `make backend-run` (see `Makefile`).

## Decision log

(empty — fill during grilling)

## Testing strategy

To be decided (PoC: no automated tests, manual review per step).

## Steps

To be defined after the grilling.
