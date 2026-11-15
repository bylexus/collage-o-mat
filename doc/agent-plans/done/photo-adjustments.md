# Photo adjustments (brightness, contrast, tint)

**Ticket/Source:** none (idea of the developer, 2026-11-14; scope set 2026-11-15)
**Branch:** none (work on `main`, not committed)
**Status:** done

## Goal

The user applies simple, non-destructive image corrections to one photo in the editor: brightness,
contrast and a colour tint (e.g. sepia, greyscale). The stored photo file does not change. The values are
saved in the photo's `props` JSON, are visible on the canvas, and are in the PNG/JPG export.

## Scope

**In scope:**
- Per-photo brightness (-100..100), contrast (-100..100), tint colour + tint strength (0..100 %).
- Frontend only: pixel processing in own TypeScript code.
- "Adjustments" section in the photo properties panel: 3 sliders, tint colour picker, preset buttons
  (Sepia, Greyscale), reset button. Live preview while a slider moves, one undo step on commit.
- Adjustments are kept by re-arrange and swap; they are in the export.

**Out of scope:**
- Page background image: it always shows the original photo (even if that photo has adjustments).
- Collage default adjustments, "apply to all photos", multi-selection.
- Thumbnails outside the canvas (import dialog, lists) show the original.
- Backend changes, changing the stored file, curves, levels, white balance, sharpen, denoise, saturation,
  red-eye.
- Rendering with `ctx.filter`, Konva filters + `cache()`, WebGL.

## Rough Architecture / Concept

**Adjusted copy:** a pure function `adjustedImage(image, adjust)` draws the full source image into an
offscreen canvas of the same size and changes each pixel (brightness → contrast → tint).
`PhotoView` (`features/editor/canvas/photo-view.ts`) uses this canvas as the `Konva.Image` source
instead of the `HTMLImageElement`. The copy has the source size, so the existing crop (in source pixels),
zoom, transformer, crop mode and the export (`page-image-renderer.ts`, which also uses `PhotoView`) work
unchanged. `PhotoView` keeps the last copy and its key (source element + adjust values) and rebuilds it
only when one of them changes. With neutral values (or no `adjust`) it draws the source directly, without
a copy. This is the same pattern as the background blur (`canvas/blurred-image.ts`,
`PageBackgroundView.blurredCopy`).

*Why:* least complex code. `ctx.filter` is not usable (Safari has it only behind a flag). Konva filters
need `node.cache()` in screen pixels: re-cache on every zoom, resize, crop change, gesture end and at
the export DPI, plus a cached hit canvas. The adjusted copy needs none of this. Costs accepted: one
full-size canvas per adjusted photo (stored sources are max 2560 px long edge ≈ 17 MB per copy) and a
full-size pixel pass (~10–40 ms) per live-preview step (throttled with `requestAnimationFrame`).

## Context for a new agent

- **Sources read:**
  - `doc/architecture.md`: frontend owns the `photos.props` JSON (no DB migration for new fields; old rows
    need frontend defaults); editor keeps the full layout in memory, each change = undo snapshot +
    debounced `PUT /api/collages/{id}/layout`. "Photo look" paragraph describes border/shadow defaults.
  - `doc/agent-plans/done/background-image-blur.md`: decision against `ctx.filter` because Safari
    (desktop and iOS, 18.0–27.x) has it only behind a flag (caniuse, checked 2026-11-14); the blur is a
    pre-processed offscreen canvas made with Konva's stack blur.
  - `backend/internal/photo/process.go`: stored uploads are downscaled to max 2560 px long edge.
- **Key files and directories (frontend: `frontend/src/app/`):**
  - `core/models/photo.ts` — `PhotoProps`; gets the new `PhotoAdjust` type and `adjust?` field.
  - `features/editor/canvas/adjusted-image.ts` — NEW: pure pixel function + neutral check.
  - `features/editor/canvas/photo-view.ts` — `PhotoView`: `setImage()`, `applySource()` set the
    `Konva.Image` source and crop; gets the adjusted-copy cache.
  - `features/editor/canvas/collage-renderer.ts` — calls `view.update(props, defaultBorder,
    defaultShadow)` and `view.setImage(...)` for the canvas.
  - `features/editor/canvas/page-image-renderer.ts` — offscreen export, uses `PhotoView` too.
  - `features/editor/canvas/blurred-image.ts`, `page-background-view.ts` — pattern for a pre-processed
    canvas copy with a rebuild key (`blurredCopy`).
  - `features/editor/editor.store.ts` — `previewPhotoBorder` / `setPhotoBorder` (preview not saved,
    commit = one undo step; `withBorderPreview` applies the preview to `photos`); `keepLook()` (line
    ~773) copies the photo look into new frames on re-arrange — must also copy `adjust`.
  - `features/editor/arrange/swap-frames.ts` — spreads `...photo.props`, keeps `adjust` already.
  - `features/editor/photo-panel/photo-properties-panel.{ts,html,scss}` — photo panel (border, shadow,
    z-order, background, delete); gets the "Adjustments" section.
  - `features/editor/settings-panel/appearance-settings-section.ts` — pattern for `mat-slider` with a
    value label (`overlayOpacity`, `blur`): `(input)` = preview, `(change)` = commit.
  - `features/editor/fields/color-field.ts` — `app-color-field` (native colour input, `previewed` /
    `committed` outputs).
- **Existing patterns to follow:** see files above; i18n ids `@@editor.photo.<key>`.
- **Commands:**
  - `cd frontend && npx ng build` (verification; no automated tests exist)
  - Dev: host `make dev-up && make dev-shell`; in the container `make backend-run` and
    `make frontend-serve` (http://localhost:4200).
- **Environment / prerequisites:** a collage with at least two placed photos. DB:
  `data/collageomat.db` (SQLite, table `photos`, column `props` JSON text).
- **Domain terms:** *Adjustment* = brightness/contrast/tint of one photo. *Adjusted copy* = the offscreen
  canvas with the processed pixels. *Tint* = monochrome colourize: luminance mapped to black→tint
  colour→white, mixed with the original by the strength.
- **External references:**
  - https://caniuse.com/mdn-api_canvasrenderingcontext2d_filter (Safari: `ctx.filter` behind a flag)
  - Konva 10.9.1 sources in `frontend/node_modules/konva/lib/` (`Node.js` filters/cache,
    `filters/Contrast.js`, `filters/Sepia.js`) — read to compare with Konva filters.

## Decision log

- **Rendering technique:** adjusted copy (own pure function, full source size, cached per photo). —
  *Rationale:* least complex code; crop/zoom/transformer/export unchanged; identical result in all
  browsers. *Rejected:* `ctx.filter` (Safari flag); Konva filters + `cache()` (re-cache on zoom, resize,
  crop, gesture, export DPI; two code paths native/fallback); WebGL (ruled out by the developer).
- **Colorize meaning:** tint colour + strength 0–100 %. — *Rationale:* one generic formula covers sepia,
  greyscale and any tone. *Rejected:* fixed tone list (with or without strength).
- **Tint formula:** L = 0.2126 R + 0.7152 G + 0.0722 B (0..1). L ≤ 0.5: T = tint × 2L; L > 0.5:
  T = tint + (white − tint) × (2L − 1). out = orig + (T − orig) × strength/100. — *Rationale:* like GIMP
  Colorize: shadows stay black, highlights white, contrast kept; `#808080` gives exact greyscale.
  *Rejected:* multiply (tint × L; darkens, no pure white).
- **Brightness/contrast:** range -100..100, step 1, default 0, CSS-like. Brightness: v × (1 + b/100).
  Contrast: (v − 128) × (1 + c/100) + 128. Clamp 0..255. — *Rejected:* additive brightness (lifts
  blacks).
- **Order of the pixel pass:** brightness → contrast → tint.
- **Scope:** per photo only. — *Rejected:* "apply to all", collage default + override (YAGNI).
- **Background image:** shows the original photo, no adjustments. — *Rationale:* keep scope small; own
  background adjustments can be a later feature.
- **Data model:** `PhotoProps.adjust?: PhotoAdjust | null`, `PhotoAdjust = { brightness: number;
  contrast: number; tintColor: string /* '#rrggbb' */; tintStrength: number /* 0..100 */ }`. Missing or
  `null` = no adjustment (old photos). Neutral values (0, 0, any colour, 0) are saved as `null`. —
  *Rejected:* flat fields in `PhotoProps`.
- **UI:** "Adjustments" section in the photo properties panel: sliders Brightness, Contrast, Tint
  strength (with value label), tint colour (`app-color-field`), preset buttons Sepia (`#a0784f`) and
  Greyscale (`#808080`), "Reset adjustments" button (sets `adjust` = `null`). A preset sets the colour;
  if the strength is 0 it also sets the strength to 100. Default tint colour of a new adjustment: Sepia.
  Preset hex values may be tuned in the review. — *Rejected:* no presets.
- **Live preview:** slider `input` → store preview (not saved), throttled with `requestAnimationFrame`;
  slider `change` → commit (one undo step). Same pattern as the border preview.
- **Re-arrange:** `keepLook()` keeps `adjust` like `border`/`shadow`.
- **Branch:** none created; work stays uncommitted on `main` until the developer commits.
- **Process:** the developer approved the plan (2026-11-15) and asked to implement all steps with
  sub-agents without a review stop between steps, unless a decision is needed.

## Testing strategy

No automated tests (project rule in `AGENTS.md`). Each step is verified with `cd frontend && npx ng build`,
then the developer tests manually with the steps in the step's acceptance criteria.

## Steps

### Step 1 — Model + rendering
- **Status:** done (reviewed 2026-11-15)
- **What:**
  - `core/models/photo.ts`: `PhotoAdjust` interface, `adjust?: PhotoAdjust | null` in `PhotoProps`
    (doc comment: missing/null = none).
  - NEW `features/editor/canvas/adjusted-image.ts`: `isNeutralAdjust(adjust)` (null/undefined or
    brightness 0, contrast 0, tintStrength 0) and `adjustedImage(image: HTMLImageElement, adjust:
    PhotoAdjust): HTMLCanvasElement` (canvas of `naturalWidth × naturalHeight`, `getImageData`, one pass
    with the formulas in the decision log, `putImageData`). Precompute factors outside the loop.
  - `photo-view.ts`: `update()`/`showProps()` read `props.adjust`; `applySource()` uses the adjusted
    copy if not neutral, else the source. Cache: last copy + key (source element, brightness, contrast,
    tintColor, tintStrength); rebuild only if the key changes; drop the copy when neutral. Crop stays
    in source px (copy has the source size).
  - `editor.store.ts` `keepLook()`: also keep `adjust` (only if defined, like `shadow`).
- **Acceptance criteria:** `npx ng build` passes. Manual: set an adjust in the DB, e.g.
  `sqlite3 data/collageomat.db "UPDATE photos SET props = json_set(props, '$.adjust', json('{\"brightness\":20,\"contrast\":30,\"tintColor\":\"#a0784f\",\"tintStrength\":100}')) WHERE id = <id>;"`,
  reload the editor: photo is sepia, brighter, more contrast; crop mode, zoom, resize, rotate work;
  PNG export shows it; re-arrange keeps it; other photos unchanged.
- **Notes:** Implemented as planned. `adjusted-image.ts` builds one 256-entry lookup table for
  brightness + contrast (same result as the per-pixel formulas, faster); tint is skipped at strength 0.
  A `tintColor` that is not `#rrggbb` gives no tint (defensive; the colour input always gives
  `#rrggbb`). `PhotoView` caches the copy in `adjusted` with an `AdjustKey` (source element + 4 values);
  `setImage()` with another element drops it. Export needs no change: `page-image-renderer.ts` calls
  `view.update(...)` then `view.setImage(image)`, which builds the copy. Checked places that copy
  `PhotoProps` (all spread `...props`): `swap-frames.ts`, `geometry/transform.ts` (`applyFrameBox`),
  `canvas/crop-mode.ts`, border/shadow/z edits in `editor.store.ts`; only `keepLook()` dropped `adjust`
  (fixed; doc comment in `arrange/arrange.ts` updated). `npx ng build` passes.

### Step 2 — Store + panel UI
- **Status:** done (reviewed 2026-11-15)
- **What:**
  - `editor.store.ts`: `previewPhotoAdjust(id, adjust | null)` and `setPhotoAdjust(id, adjust | null)`
    (store neutral as `null`; no-op if equal), preview applied in the drawn photos like
    `withBorderPreview`; preview removed on commit, undo/redo, selection change.
  - `photo-properties-panel.*`: "Adjustments" section (heading, 3 `mat-slider` with value label,
    `app-color-field` for the tint colour, buttons Sepia / Greyscale, "Reset adjustments" button disabled
    when neutral). Slider `input` → preview throttled with `requestAnimationFrame`; `change` → commit.
    Colour `previewed` → preview, `committed` → commit. All texts with `i18n="@@editor.photo.<key>"`.
  - Wire outputs/inputs through `editor.page.html` / `editor.page.ts` like the border.
- **Acceptance criteria:** `npx ng build` passes. Manual: select a photo, move each slider (live preview,
  smooth enough), release → one undo step; Sepia/Greyscale presets; colour picker; Reset → original;
  undo/redo; reload keeps values; export contains them; other photo selected → its own values.
- **Notes:** Implemented as planned.
  - `editor.store.ts`: `adjustPreviewSignal`, `previewPhotoAdjust`, `setPhotoAdjust` (neutral → `null`,
    no undo step if equal; `sameOptionalAdjust`), `withAdjustPreview` in `displayedPhotos`, cleared in
    `clearPreviews()` (used by undo/redo and selection change).
  - NEW `features/editor/photo-panel/adjust-limits.ts`: `ADJUST_LIMITS`, `TINT_PRESETS` (sepia
    `#a0784f`, greyscale `#808080`), `DEFAULT_ADJUST`, `PRESET_TINT_STRENGTH = 100` (convention of
    `settings-panel/settings-limits.ts`).
  - `photo-properties-panel.*`: section after the shadow, before the z-order buttons; sub-heading
    `<h4 class="panel-heading">`; slider values in signals, tint colour in a `FormControl<string>`;
    synced from the photo with `syncFromInput` (keyed on photo id + values). Preview throttled with
    `requestAnimationFrame` (also for the colour picker); a pending frame is cancelled on commit, reset
    and destroy, and dropped if another photo is selected meanwhile. Preset buttons without icon, reset
    button with `restart_alt`.
  - `editor.page.html`: `(adjustChange)` → `store.setPhotoAdjust`, `(adjustPreview)` →
    `store.previewPhotoAdjust` (`editor.page.ts` unchanged, same as border/shadow).
  - Known behaviour: a tint colour picked while the strength is 0 is not saved (neutral → `null`); the
    field keeps showing it until another photo is selected.
  - No i18n extraction step exists in the project. `npx ng build` passes.

### Step 3 — Documentation
- **Status:** done (reviewed 2026-11-15)
- **What:** `doc/architecture.md`: "Photo look" paragraph gets the per-photo `adjust` (no default, not on
  background); frontend table mention of `canvas/adjusted-image.ts` if useful. Plan status done, move
  to `doc/agent-plans/done/photo-adjustments.md`.
- **Acceptance criteria:** docs match the code.
- **Notes:** `doc/architecture.md`: new "Photo adjustments" paragraph after "Photo look" (re-arrange keeps
  `adjust` too) and `adjusted/blurred image copies` in the `features/editor/canvas/` row. The plan stays
  in `doc/agent-plans/` until the developer has reviewed all steps; then set **Status:** done and move it
  to `doc/agent-plans/done/photo-adjustments.md`.

## Open questions

- Preset hex values (Sepia `#a0784f`) are a first guess; tune in the review.

## Current state / Next action

Done. All steps reviewed and approved by the developer 2026-11-15 ("the feature works great"). Not
committed. Follow-up: the crowded right panel leads to a separate feature (floating photo toolbar).
