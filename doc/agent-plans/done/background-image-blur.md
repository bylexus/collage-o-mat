# Blur for the background image

**Ticket/Source:** none (rough idea of the developer, 2026-11-14)
**Branch:** none
**Status:** done

## Goal

The page background of type `image` (implemented, see `doc/agent-plans/done/page-background.md`) gets a
blur setting in addition to the overlay colour. The user sets the blur radius of the background photo, so
the photos on the page stand out. The blur is visible on the canvas and in the export (PNG/JPG), and looks
the same at every zoom level and export DPI.

## Scope

**In scope:** one blur radius setting (`blurMm`) for the background image (type `image`): data field,
rendering in `PageBackgroundView` (canvas + export), slider with live preview in the appearance settings.
**Out of scope:** blur or other adjustments for normal photos (see `doc/agent-plans/photo-adjustments.md`),
other background effects, padding the blur with source pixels outside the cover crop, backend changes,
Canvas 2D `ctx.filter`.

## Rough Architecture / Concept

Frontend only. New field `ImageBackgroundSettings.blurMm` (radius in mm, world unit, default 0 = no blur);
the settings JSON is owned by the frontend, `normalizeImageBackground` fills 0 for old collages.

Rendering uses a **pre-blurred small copy**: the cover crop of the bg image is drawn into a small offscreen
canvas, blurred once with Konva's stack blur (`Filters.Blur` from `konva/lib/filters/Blur`), and this canvas
is drawn by the existing `Konva.Image` node scaled up to the page size. The working resolution is chosen
from the radius (radius ≥ ~8 working px for a smooth result, long side capped, e.g. 2048 px, never above
the source crop resolution); a strong blur hides the low resolution. Because the copy is in page space
(mm → working px), the blur is independent of zoom and export DPI. The copy is rebuilt only when the image,
the crop/page size or `blurMm` changes. Edges: the stack blur clamps the edge pixels, so the page stays
fully covered.

*Why:* `ctx.filter = 'blur()'` is not available in Safari (desktop and iOS: "Disabled by default" behind a
flag, 18.0 – 27.x); Konva `Filters.Blur` on the full-size node needs `cache()` in screen pixels, a radius
rescaled on every zoom, re-caching on each zoom, and is slow on big images at export DPI. The small copy is
fast, works in all browsers and needs no new library.

## Context for a new agent

- **Sources read:**
  - `doc/agent-plans/done/page-background.md` — how the page background (colour, gradient, image with
    overlay) was built.
  - `doc/agent-plans/photo-adjustments.md` — separate planned feature (filters for normal photos); not part
    of this one.
  - caniuse / MDN for `CanvasRenderingContext2D.filter` (see External references): Safari has it only
    behind a flag → not usable.
- **Key files and directories (all under `frontend/src/app/`):**
  - `core/models/collage.ts` — `ImageBackgroundSettings` (`photoId`, `overlayColor`,
    `overlayOpacityPercent`; new: `blurMm`), new-collage defaults (`image: { photoId: null, overlayColor:
    '#000000', overlayOpacityPercent: 0 }`), `normalizeImageBackground`.
  - `features/editor/canvas/page-background-view.ts` — `PageBackgroundView`: group with colour rect,
    gradient rect, `Konva.Image` (cover crop via `coverCrop`/`imageAspect` from `geometry/crop`) and overlay
    rect. Used by `CollageRenderer` (editor) and `page-image-renderer.ts` (export).
  - `features/editor/canvas/scene.ts` — `SceneBackground` (what the view gets).
  - `features/editor/canvas/page-image-renderer.ts` — offscreen export, uses `PageBackgroundView`.
  - `features/editor/settings-panel/appearance-settings-section.ts` — background UI; overlay opacity slider
    with live preview (`overlayOpacity` signal, `previewImage(...)`, commit builds the settings).
  - `features/editor/settings-panel/settings-limits.ts` — `SETTINGS_LIMITS` (e.g. `overlayOpacityPercent`).
  - `node_modules/konva/lib/filters/Blur.js` (Konva 10.9.1) — `Blur(imageData, pixelRatio = 1)` reads only
    `this.blurRadius()` and runs `filterGaussBlurRGBA` (stack blur, integer radius, capped at `MAX_RADIUS`).
    It can be called as `Blur.call({ blurRadius: () => r }, imageData)`.
- **Existing patterns to follow:** overlay opacity slider (UI, preview, commit); `Shadow.blurMm` /
  `features/editor/fields/shadow-fields.ts` (blur length in mm); plain non-Angular canvas modules in
  `features/editor/canvas/`.
- **Commands:** `cd frontend && npx ng build` (verify); dev: host `make dev-up && make dev-shell`, then in
  the container `make backend-run` and `make frontend-serve` (http://localhost:4200).
- **Environment / prerequisites:** a collage with a background of type `image` and a photo set.
- **Domain terms:** *bg photo* = the page background image (a photo of the collage); *cover crop* = the
  image is cropped to the page aspect ratio and centred; *world unit* = mm.
- **External references:**
  - https://caniuse.com/mdn-api_canvasrenderingcontext2d_filter (checked 2026-11-14: Safari 18.0–27.x and
    iOS 18.0–27.x "Disabled by default"; Chrome 52+, Firefox 49+ supported)
  - https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/filter ("not Baseline")
  - https://bugs.webkit.org/show_bug.cgi?id=198416

## Decision log

- **Rendering method:** pre-blurred small copy with Konva stack blur — *Rationale:* same result at every
  zoom/DPI, fast, all browsers. Rejected: `ctx.filter` (Safari only behind a flag), `ctx.filter` + Konva
  fallback (two code paths, different results), Konva `Filters.Blur` on the full node (re-cache per zoom,
  slow at export DPI).
- **Unit:** blur radius in mm (`blurMm`, world unit like `Shadow.blurMm`) — *Rationale:* developer's
  choice: a real length. Rejected: abstract strength 0..100 % and radius in % of the page side.
- **Range:** 0..30 mm, step 0.5, default 0 (= no blur, nothing changes for old collages) — *Rationale:*
  on A4 5 mm = soft, 15 mm = strong, 30 mm ≈ colour wash; also enough for larger pages.
- **Control:** slider "Blur: X mm" below the overlay opacity slider, only for type `image`; live preview
  while dragging, one undo step on release — *Rationale:* same as the overlay opacity slider; the small
  copy is fast enough to rebuild on each move. Rejected: number field, slider + number field.
- **Edges:** clamp edge pixels (stack blur default), blur only the cover crop — *Rationale:* simple, page
  always fully covered. Rejected: padding with source pixels outside the crop (more code).
- **Order of layers:** the blur applies to the image only; the overlay rect stays on top, unchanged.
- **Implementation mode:** the developer approved both steps to be implemented in one go by a sub-agent,
  without a review stop between step 1 and 2 (2026-11-14).

## Testing strategy

No automated tests (project rule in `AGENTS.md`). Verify with `cd frontend && npx ng build`, then manual
review by the developer.

## Steps

### Step 1 — Data + rendering
- **Status:** done (reviewed 2026-11-14)
- **What:** `blurMm` in `ImageBackgroundSettings` (default 0, `normalizeImageBackground`). New module
  `features/editor/canvas/blurred-image.ts` that builds the blurred copy (working resolution from the
  radius, long side capped, integer radius, Konva stack blur). `PageBackgroundView` uses the copy when
  `blurMm > 0` (and the original image otherwise) and reuses it while image, crop/page size and `blurMm`
  stay the same.
- **Acceptance criteria:** existing collages look the same. With `blurMm` > 0 in the settings, the canvas
  and the PNG/JPG export show the same blur at different zoom levels and export DPIs; page edges stay fully
  covered.
- **Notes:** implemented and approved 2026-11-14. `blurredImage(image, crop, page, blurMm)` in
  `features/editor/canvas/blurred-image.ts`: px per mm = min(`TARGET_RADIUS_PX` (16) / blurMm,
  `MAX_LONG_SIDE_PX` (2048) / long page side, source crop px / page mm per axis); radius =
  round(blurMm × px per mm), clamped 1..180 (Konva `MAX_RADIUS`). Konva types `Blur` as `Filter`
  (also `string`), so it is called as `(Blur as FilterFunction).call({ blurRadius: () => r } as never,
  imageData)`. `PageBackgroundView` caches the copy by source image, page width/height and `blurMm`
  (the cover crop follows from these). Only the defaults and `normalizeImageBackground` build an
  `ImageBackgroundSettings`; all other code spreads it. Deviation: target radius 16 px instead of ~8 px
  (smoother).

### Step 2 — Slider UI
- **Status:** done (reviewed 2026-11-14)
- **What:** `SETTINGS_LIMITS.backgroundBlurMm` (`{ min: 0, max: 30, step: 0.5 }`). Slider "Blur: X mm" in
  `appearance-settings-section.ts`, below the overlay opacity slider, only for type `image`, live preview,
  commit on release; i18n ids `@@editor.settings.backgroundBlur` and `@@editor.settings.backgroundBlurAria`.
- **Acceptance criteria:** dragging the slider shows the blur live and smoothly; release = one undo step;
  reload keeps the value; export has the blur.
- **Notes:** implemented and approved 2026-11-14. Copies the overlay opacity slider pattern
  (`blurMm` signal, `previewBlur` → `previewImage`, commit on `change`, `formBackground()` includes
  `blurMm`). No extracted i18n message files exist (`sourceLocale: "en"` only), nothing to add.

## Open questions

- Fine-tuning of the working resolution after a visual test (`TARGET_RADIUS_PX` = 16,
  `MAX_LONG_SIDE_PX` = 2048). Known limit: with a small blur at high export DPI the copy is capped at
  2048 px long side (e.g. A4 at 300 DPI = 3508 px), so it is slightly lower resolution than the export.

## Current state / Next action

Done. Steps 1 and 2 implemented and approved by the developer on 2026-11-14 (manual test passed);
`cd frontend && npx ng build` passes. Plan moved to `doc/agent-plans/done/`. Nothing committed. Only
remaining item: optional fine-tuning of the working resolution (see Open questions).
