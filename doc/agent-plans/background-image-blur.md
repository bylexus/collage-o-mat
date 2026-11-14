# Blur for the background image

**Ticket/Source:** none (rough idea of the developer, 2026-11-14)
**Branch:** none
**Status:** planning

## Goal

The page background of type `image` (implemented, see `doc/agent-plans/done/page-background.md`) gets a
blur setting in addition to the overlay colour. The user sets how much the background photo is blurred, so
the photos on the page stand out. The blur is visible on the canvas and in the export.

## Scope

**In scope:** one blur strength setting for the background image (type `image`), together with the existing
overlay colour and opacity.
**Out of scope:** to be decided in the grilling. Expected: blur for normal photos (see
`doc/agent-plans/photo-adjustments.md`), other background effects, backend changes.

## Rough Architecture / Concept

Not decided yet (planning phase). Expected: frontend only.

- Data: new field in `ImageBackgroundSettings` (`core/models/collage.ts`), e.g. `blurMm` (a length in mm,
  so the blur looks the same at every zoom and export DPI) or `blurPercent`. Default 0 (no blur).
  `normalizeImageBackground` fills the default for old collages (settings JSON owned by the frontend, no
  backend change).
- Rendering: `PageBackgroundView` (`features/editor/canvas/page-background-view.ts`) draws the image with a
  `Konva.Image` (cover crop) and the overlay `Konva.Rect`. Options to decide:
  - Konva `Filters.Blur` (needs `cache()`; blur radius in cache pixels, so it must be scaled to the zoom /
    export DPI; slow with large radii and large images).
  - Canvas 2D `ctx.filter = 'blur(..px)'` (fast; browser support to check, Safari).
  - Pre-blurred downscaled copy of the image (blur on a small offscreen canvas, then scale up): cheap, a
    strong blur hides the low resolution.
- Edge: a blur makes the page edges transparent/soft; the image may need to be drawn slightly larger than
  the page (or edge pixels clamped) and clipped to the page.
- Export: `canvas/page-image-renderer.ts` uses the same `PageBackgroundView`, so the blur is in the export
  if the view applies it (check the radius at the export DPI).
- UI: a slider in the background part of the appearance settings
  (`features/editor/settings-panel/appearance-settings-section.ts`), next to the overlay opacity slider;
  limits in `settings-limits.ts`; live preview while dragging (like the other settings previews).

## Open questions (for the grilling)

- Unit and range of the blur value (mm, px at page DPI, or percent of the page size)?
- Konva filter, `ctx.filter` or pre-blurred copy? Browser support (Safari) and performance.
- Edge handling: soft/transparent edges acceptable, or must the blurred image fill the page fully?
- Live preview while dragging the slider: performance, debounce?

## Context for a new agent

- **Read first:** `doc/architecture.md`; `doc/agent-plans/done/page-background.md` (how the background was
  built and its decisions).
- **Facts from the code (2026-11-14):**
  - `ImageBackgroundSettings` (`core/models/collage.ts`): `photoId`, `overlayColor`,
    `overlayOpacityPercent`. Defaults in the new-collage settings (`image: { photoId: null, overlayColor:
    '#000000', overlayOpacityPercent: 0 }`), migration/merge in `normalizeImageBackground`.
  - `PageBackgroundView` (`features/editor/canvas/page-background-view.ts`): group with colour rect,
    gradient rect, `Konva.Image` (cover crop, centred) and overlay rect. Used by `CollageRenderer` and the
    export.
  - Settings UI: `features/editor/settings-panel/appearance-settings-section.ts`; limits in
    `settings-limits.ts` (`overlayOpacityPercent: { min: 0, max: 100, step: 1, integer: true }`).
- **Rules:** no new libraries without the developer's approval (Konva is already in use).
- **Commands:** `cd frontend && npx ng build`; dev via `make dev-up`, `make frontend-serve`,
  `make backend-run` (see `Makefile`).

## Decision log

(empty — fill during grilling)

## Testing strategy

To be decided (PoC: no automated tests, manual review per step).

## Steps

To be defined after the grilling.
