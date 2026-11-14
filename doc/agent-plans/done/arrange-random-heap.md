# Arrangement mode "random heap"

**Ticket/Source:** none (idea of the developer, 2026-11-14)
**Branch:** none
**Status:** done

## Goal

A new auto-arrangement mode "Random heap" (in addition to `grid` and `center`). The photos lie on the page
like a heap of printed photos thrown on a table: random positions, random small rotations, random size
variation, overlapping, but every photo stays clearly visible. Each re-arrange gives a new heap. The user
can show the full image or a fixed print aspect (3:2, 4:3, 1:1, 5:4).

## Scope

**In scope:**
- New mode `heap` (UI label "Random heap") with its settings (`HeapSettings`), defaults and normalizer.
- Pure arrangement function `arrangeHeap` with an injected random function.
- Heap settings fields in the **mode settings dialog** (introduced by the plan
  `doc/agent-plans/done/arrangement-settings-dialog.md`, which must be implemented first).
- Mention the mode in `doc/architecture.md`.

**Out of scope:**
- Photo shadow (photos have no shadow property today; only texts have `TextShadow`). Possible own feature.
- A stored random seed (each re-arrange gives a new heap; the result is saved as frames, undo restores).
- Random stacking order (photos are placed and stacked in import order). A random order for all modes is
  the separate plan `doc/agent-plans/rearrange-random-order.md`.
- A heap-specific border (the collage default border is used, like in all modes).
- Photos that stick out over the page edge.
- Backend changes (the `settings` JSON is owned by the frontend; the backend stores it as is).
- The settings dialog itself (separate plan `arrangement-settings-dialog.md`).

## Rough Architecture / Concept

Frontend only, same pattern as the existing modes `grid` and `center`:

- **Model** (`frontend/src/app/core/models/collage.ts`): `ArrangementMode` and `ARRANGEMENT_MODES` get
  `'heap'`. New `HeapSettings` and `CollageSettings.heap`, defaults in `defaultCollageSettings()`, new
  `normalizeHeap()` called from `normalizeSettings()` (old collages without `heap` get the defaults).
- **Algorithm** (`frontend/src/app/features/editor/arrange/heap.ts`): pure function
  `arrangeHeap(photos, page, heap, random)`, registered in `STRATEGIES` in `arrange/arrange.ts`.
  `arrangePhotos(photos, settings, random = Math.random)` gets an optional random parameter that it passes
  to the heap strategy (other strategies ignore it). Keeps the module pure and testable.
- **Frame helper** (`arrange/frame.ts`): new exported helper for a frame with a rotation (the existing
  `fullFrame` / `coverFrame` always set `rotationDeg: 0`).
- **UI:** heap fields in the mode settings dialog (from `arrangement-settings-dialog.md`), limits in
  `features/editor/settings-panel/settings-limits.ts`,
  i18n for all texts.

Why: the existing modes are pure strategy functions behind one `STRATEGIES` table; a new mode is one entry
plus its settings. No library is needed (random, geometry and an occupancy grid are a few lines of code).

### Algorithm `arrangeHeap` (decided)

Input: photos in import order (id ascending, sorted by `arrangePhotos`), page, `HeapSettings`,
`random: () => number` (values in [0, 1)).

1. `content = contentRect(page, heap.marginMm)` (`geometry/rect.ts`). Empty photo list → empty map.
2. Base area per photo: `baseArea = coveragePercent / 100 × content.width × content.height / n`.
3. For each photo `i` (in order):
   - **Frame aspect:** `full` → image aspect (`photoAspect(photo)` from `arrange/frame.ts`). Preset
     `w:h` → aspect `w/h` if the image aspect ≥ 1 (landscape or square image), else `h/w` (portrait frame).
   - **Size:** `scale = 1 + sizeVariationPercent / 100 × (2 × random() − 1)`;
     `area = baseArea × scale²`; `width = sqrt(area × aspect)`, `height = width / aspect`.
   - **Rotation:** `θ = maxRotationDeg × (2 × random() − 1)`.
   - **Fit:** rotated bounding box `bw = w·|cos θ| + h·|sin θ|`, `bh = w·|sin θ| + h·|cos θ|`. If
     `bw > content.width` or `bh > content.height`, scale width and height down by
     `min(content.width / bw, content.height / bh)` so the rotated photo fits into the content area. Use
     `frameSide()` / `MIN_FRAME_SIZE_MM` for safe sizes.
   - **Position (best of N):** `N = 30` candidate centres, uniform random with the rotated bounding box
     fully inside the content area. Score each candidate with a coarse occupancy grid of the content area
     (`48 × 48` cells, a cell is "covered" if its centre lies inside an already placed rotated frame):
     score = number of covered cells whose centres lie inside the candidate's rotated frame. The candidate
     with the lowest score wins (ties: the first one). Then mark the cells inside the winner as covered.
     Effect: new photos go to empty areas first, so every photo stays mostly visible; not guaranteed.
   - **Crop:** `full` → `fullCrop()` (`geometry/crop.ts`); preset → centred `coverCrop(imageAspect,
     frameAspect)`.
   - **Props:** centre, width, height, `rotationDeg = θ`, `z = i`, border `inheritedBorder()` (collage
     default border).
4. All photos are on the page; heap never places photos beside the page.

Constants (`N = 30`, grid `48 × 48`) are module constants in `heap.ts`, not user settings.

## Context for a new agent

- **Sources read:** this plan was written from the developer's rough idea (goal above) and the code. No
  external sources.
- **Read first:** `doc/architecture.md` (frontend owns geometry; `collages.settings` JSON is owned by the
  frontend), `doc/agent-plans/done/arrangement-settings-dialog.md` (prerequisite; where the mode fields live).
- **Key files and directories (state 2026-11-14):**
  - `frontend/src/app/core/models/collage.ts` — `ArrangementMode = 'grid' | 'center'`,
    `ARRANGEMENT_MODES`, `GridSettings`, `CenterSettings`, `CollageSettings.{mode, grid, center, ...}`,
    `defaultCollageSettings()`, `normalizeSettings()` with `normalizeGrid` / `normalizeCenter` and helpers
    `asRecord`, `numberOr`, `nullableNumberOr`, `oneOf`.
  - `frontend/src/app/features/editor/arrange/arrange.ts` — `arrangePhotos(photos, settings)`,
    `STRATEGIES: Record<ArrangementMode, ArrangeStrategy>`, `sortedById`.
  - `frontend/src/app/features/editor/arrange/grid.ts`, `center.ts` — existing strategies (pattern).
  - `frontend/src/app/features/editor/arrange/frame.ts` — `photoAspect`, `coverFrame`, `fullFrame`,
    private `frameProps` (sets `rotationDeg: 0`, `border: inheritedBorder()`).
  - `frontend/src/app/features/editor/geometry/` — `rect.ts` (`contentRect`, `Rect`), `crop.ts`
    (`fullCrop`, `coverCrop`, `imageAspect`), `frame-size.ts` (`frameSide`, `MIN_FRAME_SIZE_MM`),
    `numbers.ts` (`clamp`, `nonNegative`).
  - `frontend/src/app/core/models/photo.ts` — `PhotoProps` (`cxMm`, `cyMm`, `widthMm`, `heightMm`,
    `rotationDeg` around the centre, `z`, `crop`, `border`).
  - `frontend/src/app/features/editor/editor.store.ts` — `rearrange()`, `addPhotos()`, private
    `arrangeAll()` calls `arrangePhotos(this.photosSignal(), settings)` and sets `layoutIsArrangement`.
  - `frontend/src/app/features/editor/settings-panel/arrangement-settings-dialog.{ts,html}` — the mode
    settings dialog (title per mode, fields per mode, form controls per mode, result type
    `ArrangementSettings` = `mode` + per-mode settings); the heap fields and title go here.
  - `frontend/src/app/features/editor/settings-panel/arrangement-settings-dialog.service.ts` — opener.
  - `frontend/src/app/features/editor/editor.page.ts` — `openArrangement(mode)` passes the per-mode
    settings into the dialog (add `heap`).
  - `frontend/src/app/features/editor/settings-panel/arrangement-settings-section.html` — mode select
    (add the "Random heap" option), "Re-arrange…" and re-roll buttons.
  - `frontend/src/app/features/editor/settings-panel/settings-limits.ts` — `SETTINGS_LIMITS`.
  - `frontend/src/app/features/editor/geometry/snap-grid.ts` — picks the margin of the active mode with
    `settings.mode === 'grid' ? settings.grid.marginMm : settings.center.marginMm`; must handle `heap`
    in step 1 (use `heap.marginMm`).
  - `frontend/src/app/features/editor/editor.page.ts` — `isCenterMode` (only center-specific UI).
- **Existing patterns to follow:** `arrange/center.ts` (strategy with settings), `normalizeCenter` in
  `collage.ts`, the center fields (`app-number-field` with `limits`, `i18n-label`) in the current
  `arrangement-settings-section.html`.
- **Commands:** `cd frontend && npx ng build` (verification); dev: `make dev-up && make dev-shell`, then in
  the container `make backend-run` and `make frontend-serve` (http://localhost:4200).
- **Domain terms:** *content area* = page minus margin (`contentRect`); *frame* = photo rectangle on the
  page (`PhotoProps`); *full crop* = whole image; *cover crop* = centred crop that fills the frame;
  *re-arrange* = run the strategy of the current mode for all photos.

## Decision log

- **Photo size:** auto from the photo count plus random variation — settings `coveragePercent` (total
  photo area / content area) and `sizeVariationPercent` (random scale ±). *Rationale:* works for any
  photo count. *Rejected:* fixed size in % of the page (many photos → huge overlap); auto without
  variation (too uniform).
- **Size values:** coverage default 120, range 30..300; variation default 20, range 0..50. A photo too
  large for the content area (rotated) is scaled down to fit.
- **Visibility:** best of N random candidates with an occupancy grid, no user setting. *Rejected:* pure
  random (photos can be fully hidden); guaranteed minimum visible % (complex, needs fallback).
- **Crop:** selectable: `full` (whole image, image aspect) or fixed aspect from a preset list `3:2`,
  `4:3`, `1:1`, `5:4`; frame orientation follows the image (landscape/square image → landscape frame);
  centred cover crop. *Rejected:* one orientation for all photos; free numeric ratio.
- **Rotation:** `maxRotationDeg` default 15, range 0..45; random in ±max; 0 = no rotation.
- **Page edge:** photos stay inside the content area (rotated bounding box), setting `marginMm` like the
  other modes (default 10). *Rejected:* overhang setting, negative margin.
- **Randomness:** no seed; `random: () => number` injected, `arrangePhotos` default `Math.random`.
  *Rationale:* result is saved as frames, undo restores; `rearrange-random-order.md` can reuse the same
  parameter. *Rejected:* seed in settings plus own PRNG.
- **Stacking order:** import order (id ascending), `z = index`, newest on top. *Rejected:* heap shuffles
  itself (overlaps with `rearrange-random-order.md`).
- **Look:** collage default border (user sets e.g. white border in Appearance), no shadow.
  *Rejected:* heap-own border (duplicates `defaultBorder`); photo shadow (big scope increase).
- **UI name:** "Random heap" (id `heap`).
- **Settings UI location:** the mode settings move to a dialog that opens on every "Re-arrange" (developer
  decision). This is a separate plan `doc/agent-plans/done/arrangement-settings-dialog.md`, implemented
  **before** this plan. *Rejected:* heap fields in the side panel (panel gets too long); collapsible
  panel section; dialog via a separate tune button (agent recommendation, not chosen).
- **Testing:** no automated tests (project rule in `AGENTS.md`).
- **Hidden photos (step 2 result):** best-of-N still leaves about 1 % of photos fully hidden. Accepted
  as is; the user re-rolls. *Rejected:* protect the visible share of earlier photos with a penalty
  (agent recommendation); more candidates (does not fix the cause).

## Testing strategy

No automated tests, manual review only. Each step: `cd frontend && npx ng build` must succeed, then the
developer tests in the browser with the manual test steps of the step.

## Steps

### Step 1 — Model, settings UI and basic heap (random position)
- **Status:** done (reviewed 2026-11-14)
- **What:** `HeapSettings` (`aspect: 'full' | '3:2' | '4:3' | '1:1' | '5:4'`, `coveragePercent`,
  `sizeVariationPercent`, `maxRotationDeg`, `marginMm`; defaults `full`, 120, 20, 15, 10), `'heap'` in
  `ArrangementMode` / `ARRANGEMENT_MODES`, `normalizeHeap`; limits (coverage 30..300 step 10, variation
  0..50 step 5, rotation 0..45 step 1 integer, margin = existing `marginMm` limits); `arrangeHeap` with
  steps 1–3 of the algorithm but the position as **one** uniform random centre (no best of N yet);
  rotated frame helper in `frame.ts`; `random` parameter in `arrangePhotos`; snap grid margin for
  `heap` in `geometry/snap-grid.ts`; mode option "Random heap"
  and the heap fields (aspect select: Full image, 3:2, 4:3, 1:1, 5:4) in the mode settings dialog; i18n.
- **Acceptance criteria:** `npx ng build` ok. Select "Random heap", Re-arrange → photos rotated within
  ±15°, inside the margin, sizes vary; each Re-arrange gives a new heap; aspect 3:2 gives cropped 3:2/2:3
  frames; settings survive a reload; old collages open with heap defaults; grid and center unchanged.
- **Notes:** `collage.ts`: `HeapAspect`, `HEAP_ASPECTS`, `HeapSettings`, `CollageSettings.heap`,
  `normalizeHeap`. `settings-limits.ts`: `coveragePercent`, `sizeVariationPercent`, `maxRotationDeg`.
  `arrange/frame.ts`: `rotatedFrame(photo, centre, w, h, rotationDeg, 'full' | 'cover', z)`, types
  `FrameCrop`, `Point`; `frameProps` got an optional `rotationDeg`. `arrange/heap.ts`: `arrangeHeap` with
  own range constants `HEAP_*_MIN/MAX` and fallbacks (pattern of `center.ts`; `arrange/` stays free of
  Angular, so they repeat `SETTINGS_LIMITS`); sizes go through `frameSide` before the bounding box is
  computed; a non-finite `random()` value counts as 0.5; the position is in `pickCentre(box, content,
  random)` (to be replaced in step 2). `arrange.ts`: strategy type gets `random`,
  `arrangePhotos(..., random = Math.random)`. `snap-grid.ts`: `MODE_MARGIN_MM: Record<ArrangementMode,
  ...>`. Dialog: heap form group, title "Re-arrange: Random heap", fields; aspect labels "3:2" etc. are
  plain text, only "Full image" is i18n. New i18n ids: `@@editor.arrangementDialog.titleHeap`,
  `@@editor.settings.modeHeap`, `@@editor.settings.heap.{aspect,aspectFull,coveragePercent,
  sizeVariationPercent,maxRotationDeg}`. Center-only code (`isCenterMode`, `centerPhotoId`,
  `layout-snapshot.ts` `withoutDeletedCentrePhoto`) needs no change. Sanity script (scratchpad, not in
  repo): 99,900 frames for 1/10/100 photos, all aspects, rotations 0/15/45, coverage 30/120/300: all
  corners inside the content area, sizes finite > 0, z = index. Known edge: content area of size 0 gives
  a 1 × 1 mm frame at the page centre (same as `fullFrame`).

### Step 2 — Best-of-N placement with occupancy grid
- **Status:** done (reviewed 2026-11-14)
- **What:** replace the single random centre with the best of 30 candidates scored by the 48 × 48
  occupancy grid (algorithm step 3, "Position").
- **Acceptance criteria:** with 10–30 photos and default settings, every photo stays clearly visible and
  empty areas get filled; 1 photo still works; 100 photos give small photos without errors.
- **Notes:** Only `arrange/heap.ts` changed: constants `CANDIDATE_COUNT = 30`,
  `GRID_COLUMNS = 48`, `GRID_ROWS = 48`; `pickBestCentre` makes candidates with `pickCentre` and scores
  them with exact point-in-rotated-frame tests, only for the cells inside the frame's bounding box
  (rotation sign as in Konva). The search stops at the first candidate with score 0 (same result as a
  full search, fewer `random()` calls). Runtime about 1 ms for 100 photos. Visibility (scratchpad
  script, A4 landscape, defaults, 50 runs): median visible share per photo 77 % (10 photos) / 76 % (30)
  vs. 49 % / 48 % for pure random; fully hidden photos 7/500 and 17/1500 (pure random 26/500,
  77/1500). Known limitation accepted by the developer: about 1 % of photos can still be fully hidden;
  the user re-rolls with the quick re-arrange button.

### Step 3 — Documentation and close
- **Status:** done (reviewed 2026-11-14)
- **What:** add `heap` in `doc/architecture.md` (line "Pure arrangement functions (grid, center, ...)"
  and the domain term "Arrangement / mode"); set status done and move this file to
  `doc/agent-plans/done/`.
- **Acceptance criteria:** docs list the heap mode.
- **Notes:** `doc/architecture.md`: random heap added to the `arrange/` row and
  to the term "Arrangement / mode". Plan moved to `doc/agent-plans/done/`.

## Open questions

- Known limitation: about 1 % of photos can be fully hidden (accepted). (Heap fields go into the dialog `arrangement-settings-dialog.{ts,html}`; limits stay in
  `settings-panel/settings-limits.ts`.)

## Current state / Next action

All steps done 2026-11-14 (reviewed together by the developer 2026-11-14).
Possible follow-up: protect the visible share of earlier photos (see decision log).
