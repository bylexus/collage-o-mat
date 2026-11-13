# Move grid (snapping)

**Ticket/Source:** Backlog of `doc/agent-plans/done/poc-implementation.md` (requested by the developer 2026-11-13)
**Branch:** none
**Status:** done

## Goal

A configurable, invisible snap grid on the page. When the grid is on, moving photos and texts and resizing
photos snaps to the grid, so elements can be aligned exactly. The grid is configured in a small popover
opened by a new toolbar button. Because the toolbar has many buttons now, all toolbar buttons become
icon-only with a tooltip.

## Scope

**In scope:**
- Toolbar: all buttons icon-only with tooltip (Export, Add text, Import from Immich, Set as centre; Back,
  Undo, Redo, Delete already are).
- New toolbar button "Snap grid" that opens a popover: grid on/off, grid size in mm.
- Snap grid settings stored per collage in `collages.settings` (`snapGrid`).
- Snapping while moving photos, while moving texts, and while resizing photos (transformer handles).
- Alt (Option on Mac) held during a move/resize temporarily disables snapping.

**Out of scope:**
- Visible grid lines (the grid is never drawn, not while dragging, not in the export).
- Snapping of the text box width (text transformer), of rotation (already snaps to 0/90/180/270 — unchanged),
  of the crop mode.
- Magnetic snapping with a tolerance (decided: always snap).
- Separate x/y cell sizes, own grid margin/offset field, snapping to other photos (smart guides).
- Automated tests.

## Rough Architecture / Concept

Frontend only; the backend stores `settings` as opaque JSON and does not change.

- **Model:** `CollageSettings.snapGrid: { enabled: boolean; sizeMm: number }` in
  `frontend/src/app/core/models/collage.ts`, default `{ enabled: false, sizeMm: 5 }`, merged in
  `normalizeSettings` (old collages get the default; no DB migration). Named `snapGrid` because `grid` is
  already the "grid" arrangement mode settings.
- **Snap math:** one pure module (no Angular, no Konva), e.g.
  `frontend/src/app/features/editor/geometry/snap-grid.ts`. Input: grid (size, margin, page size) and an
  axis-aligned rect in mm; output: the delta (dx, dy) that puts the nearest edge per axis on a grid line.
  Grid lines per axis: `margin + n·size` for every integer n (also negative / beyond the page), plus the far
  margin line `pageSide − margin`. Margin = the margin of the active arrangement mode
  (`settings.mode === 'grid' ? settings.grid.marginMm : settings.center.marginMm`).
- **Move snapping:** in the Konva `dragmove` of `PhotoView` / `TextView` groups (or `dragBoundFunc`; choose in
  step 3): compute the bounding box (`frameBounds(view.frameBox())` from `canvas/viewport.ts`), snap it,
  shift the group by the delta. Skipped when `evt.altKey` is true or the grid is off.
- **Resize snapping:** in the transformer `boundBoxFunc` of `PhotoTransformer` (base
  `SelectionTransformer` already uses `boundBoxFunc` for the minimum size; combine both). Boxes there are in
  absolute screen px → convert to mm with the stage transform. Only for photos with a rotation that is a
  multiple of 90°.
- **Grid state into the canvas:** the renderer gets the snap grid (and margin, page size) via the scene /
  settings it already receives (`EditorCanvas` input `settings`).
- **Popover:** CDK connected overlay (`@angular/cdk/overlay`, `cdkConnectedOverlay`, already a dependency),
  anchored below the toolbar button, transparent backdrop; closes on backdrop click and Esc. Contains a
  `mat-slide-toggle` (on/off) and the existing `app-number-field` (size). Each change commits immediately via
  `store.updateSettings(...)` (one undo step per change, autosave).

Why: smallest change that follows existing patterns (settings JSON + `normalizeSettings`, pure geometry
modules, `NumberField` commit-on-change, Konva hooks). No new libraries.

## Context for a new agent

- **Sources read:**
  - `doc/agent-plans/done/poc-implementation.md` — architecture conventions, data model (`collages.settings`
    JSON owned by the frontend; `photos.props` with frame centre `cxMm/cyMm`, `widthMm/heightMm`,
    `rotationDeg`), "Commands", sandbox notes. Testing rule of the PoC: no automated tests, manual review per
    step.
  - `doc/agent-plans/frame-resize-mode.md` — separate planned feature (resize keep-aspect vs free). Today:
    corner handles keep the frame aspect, edge (middle) handles change it (cover crop recomputed). Resize
    snapping in step 4 must keep working with that behaviour; when frame-resize-mode is implemented later, it
    must keep the snapping in `boundBoxFunc`.
- **Coordinates:** world unit mm, page origin top-left; the stage scale is px per mm
  (`canvas/stage-navigator.ts`, `canvas/viewport.ts` `ViewTransform`: screen px = mm × scale + offset).
  Photos and texts are Konva groups positioned at the box centre, rotated around the centre.
- **Key files and directories** (all under `frontend/src/app/`):
  - `features/editor/editor.page.html` / `.scss` / `.ts` — toolbar (buttons, `matTooltip`, `aria-label`
    pattern of Undo/Redo/Delete). Order today: Back, title, save status, [Undo, Redo], spacer,
    [Set as centre — only in center mode], Delete, Export (tonal), Add text (tonal), Import from Immich
    (filled).
  - `core/models/collage.ts` — `CollageSettings`, `defaultCollageSettings()`, `normalizeSettings()` with
    helpers `asRecord`, `numberOr`, `stringOr`, …
  - `features/editor/editor.store.ts` — `settings` signal, `updateSettings(settings)` (sets + `commit()` =
    undo step + autosave), `previewSettings`.
  - `features/editor/settings-panel/settings-limits.ts` — `SETTINGS_LIMITS` (add `snapGridSizeMm`).
  - `features/editor/fields/number-field.ts` — `app-number-field` (inputs `control`, `limits`, `label`;
    output `committed` on native `change`).
  - `features/editor/canvas/photo-view.ts` — photo group, `dragstart`/`dragend`, `frameBox()`.
  - `features/editor/canvas/text-view.ts` — text group, same drag events, `frameBox()`.
  - `features/editor/canvas/collage-renderer.ts` — creates views with drag callbacks
    (`onPhotoDragStart/End`, `onTextDragStart/End`), `commitFrame`, `commitTextBox`.
  - `features/editor/canvas/viewport.ts` — `frameBounds(box)` (axis-aligned bounding box of a rotated box).
  - `features/editor/canvas/selection-transformer.ts` — base transformer, `boundBoxFunc` → `limitSize`.
  - `features/editor/canvas/photo-transformer.ts` — `EDGE_ANCHORS`, `keepAspect` per active anchor.
  - `features/editor/canvas/editor-canvas.ts` — Angular wrapper of the renderer, input `settings`.
  - `features/editor/export/export-dialog.ts` — example of a form component using `NumberField`.
- **Existing patterns to follow:** settings sections in `features/editor/settings-panel/` (reactive form,
  `limitValidators`, `syncFromInput`, commit on `committed`); icon buttons with `[attr.aria-label]` +
  `[matTooltip]` in `editor.page.html`; i18n via `i18n`/`$localize` with `@@editor.*` ids.
- **Commands:** frontend build `cd frontend && npm run build`; dev server via Makefile targets
  (`make dev-up`, then in container `make frontend-serve` / `make backend-run`; see `Makefile` help). The dev
  sandbox may block some commands — report blocked commands to the developer.
- **Environment / prerequisites:** dev container (`compose.yaml`), a collage with some photos.
- **Domain terms:** "arrangement mode" = `settings.mode` (`grid` | `center`) — automatic layout, unrelated to
  the snap grid. "Snap grid" = this feature.
- **External references:** Konva `dragBoundFunc`, `dragmove`, Transformer `boundBoxFunc`
  (https://konvajs.org/api/Konva.Transformer.html), installed Konva 10.9.1; Angular CDK Overlay
  (https://material.angular.dev/cdk/overlay), installed `@angular/cdk` ^22.2.

## Decision log

- **Snap point:** per axis the nearest bounding-box edge (left or right, top or bottom) snaps to the nearest
  grid line. Rotated elements: the axis-aligned bounding box (`frameBounds`). — *Rationale:* exact alignment
  of edges. Rejected: edges + centre, top-left corner only, centre only.
- **Grid size:** one value `sizeMm` (square cells). — *Rationale:* simple. Rejected: width + height,
  columns × rows.
- **Grid origin:** top-left page corner plus the margin. Lines at `margin + n·size` for every integer n
  (grid continues outside the margin area and outside the page). — *Rationale:* developer decision.
  Rejected: grid only inside margins; page edges as extra lines.
- **Margin source:** no own margin field; the margin of the active arrangement mode
  (`grid.marginMm` in grid mode, `center.marginMm` in center mode). There is no page-level margin in the
  model. — *Rationale:* developer decision ("use page margin only"); grid matches arranged photos.
  Rejected: own margin field in the popover (first chosen, then withdrawn by the developer); merging both
  margins into one page margin (bigger scope).
- **Far margin lines:** `pageWidth − margin` and `pageHeight − margin` are also snap lines, even when not on
  the grid. — *Rationale:* align to the right/bottom margin independent of sizes.
- **Storage:** `settings.snapGrid: { enabled, sizeMm }` in `collages.settings`; changes via
  `store.updateSettings` → one undo step per change, autosaved. — *Rationale:* existing pattern, no DB
  migration. Rejected: settings without undo (new store path), browser localStorage.
- **Defaults / limits:** off, 5 mm; size 1–100 mm, step 0.5. Old collages: default via `normalizeSettings`.
- **Snap scope:** photo move, text move, photo resize. Not: text box width, rotation, crop.
- **Resize snapping:** edge handle → the moved edge snaps; corner handle (keeps aspect) → the axis with the
  nearer grid line snaps, the other follows the aspect. Photos whose rotation is not a multiple of 90°: no
  resize snapping (moving still snaps). — *Rationale:* predictable; bounding-box resize of rotated frames is
  complex. Rejected: edge handles only; bounding box always.
- **Snap strength:** always snap when the grid is on (no tolerance). Rejected: magnetic snapping.
- **Modifier:** holding Alt/Option during a move or resize disables snapping for that moment.
- **Grid button state (follow-up after step 4, 2026-11-13):** icon `grid_on` when on, `grid_off` when off
  (replaces `grid_4x4`); when on, the icon is primary-coloured (`--mat-icon-button-icon-color:
  var(--mat-sys-primary)`) on the tonal `--mat-sys-secondary-container` background (`.toolbar-active` in
  `editor.page.scss`). Note: the `.toolbar-active` style was missing from `editor.page.scss` (class used in
  the html only) and was added in this follow-up.
- **Alt during resize (step 4):** Konva 10.9.1 also uses Alt for centred scaling during resize. Kept both:
  Alt = no snap + centred scaling. — *Rationale:* no extra code; snapping assumes a fixed opposite edge, so
  it would not fit centred scaling anyway. Rejected: suppressing Konva's Alt behaviour (no flag; fragile
  event wrapper).
- **Visibility:** grid never visible.
- **Popover:** small popover anchored at the toolbar button (CDK connected overlay), closes on outside click
  or Esc, changes apply immediately. Rejected: modal MatDialog with OK/Cancel or live apply.
- **Grid button:** icon `grid_4x4`, highlighted background when the grid is on; tooltip/aria-label e.g.
  "Snap grid". Placed left of the "Set as centre" button (right of the spacer); always visible (Set as
  centre is only shown in center mode).
- **Toolbar:** all buttons icon-only with `matTooltip` and `aria-label`. Import keeps a filled (primary)
  emphasis through a small CSS class (Angular Material has no filled icon button); all others are plain
  `matIconButton`. Rejected: all plain.
- **Testing:** no automated tests, manual review per step; `npm run build` must pass.

## Testing strategy

No automated tests, manual review per step by the developer. Each step: `cd frontend && npm run build` must
pass without errors.

## Steps

### Step 1 — Toolbar icon-only
- **Status:** done (reviewed 2026-11-13)
- **What:** In `editor.page.html`, convert Set as centre (`matButton="outlined"`), Export (`tonal`), Add text
  (`tonal`), Import from Immich (`filled`) to `matIconButton` with `[matTooltip]` and `aria-label` (keep the
  existing i18n texts/ids as tooltip/label; Set as centre keeps its explaining `setCentreHint()` tooltip and
  `disabledInteractive`). Import gets a CSS class with a filled primary look (`--mat-sys-primary` /
  `--mat-sys-on-primary`, disabled state respected). No functional change.
- **Acceptance criteria:** all toolbar buttons show icons only; hover shows the tooltip; Import stands out
  as the main action; all buttons work as before; build passes.
- **Notes:** Status done (reviewed 2026-11-13). `editor.page.html`: Set as centre, Export, Add text, Import
  are `matIconButton` with `[attr.aria-label]` + `[matTooltip]`. `editor.page.ts`: `$localize` constants
  `setCentreLabel` (`@@editor.setCentre`), `exportLabel` (`@@editor.export.button`), `addTextLabel`
  (`@@editor.text.addButton`), `importLabel` (`@@editor.importButton`) — same ids/texts as before. Set as
  centre keeps the explaining `setCentreHint()` tooltip; its aria-label is the constant "Set as centre".
  `editor.page.scss`: class `.toolbar-primary` (Import): `background-color: var(--mat-sys-primary)` (Material
  22.2.6 has no icon-button container token), icon/state-layer/ripple via `--mat-icon-button-*` tokens set to
  on-primary, disabled = on-surface 12 %. No i18n translation files exist (`sourceLocale: en` only).

### Step 2 — Snap grid settings + toolbar popover
- **Status:** done (reviewed 2026-11-13)
- **What:** `snapGrid` in `CollageSettings`, `defaultCollageSettings`, `normalizeSettings`; limits in
  `SETTINGS_LIMITS`; new popover component (e.g. `features/editor/snap-grid/snap-grid-popover.ts`) with
  slide toggle + `app-number-field`; toolbar button `grid_4x4` left of Set as centre, highlighted when on,
  opens the CDK connected overlay; changes call `store.updateSettings({ ...settings, snapGrid })`. No
  snapping yet.
- **Acceptance criteria:** button opens the popover below it; Esc / outside click closes it; toggle and size
  change are saved (reload keeps them), each is one undo step; invalid size shows the range error and is not
  saved; button is highlighted when the grid is on; old collages open with grid off, 5 mm.
- **Notes:** Done. `core/models/collage.ts`: `SnapGridSettings`, `CollageSettings.snapGrid`, default
  `{ enabled: false, sizeMm: 5 }`, `normalizeSnapGrid` + helper `booleanOr`. `settings-limits.ts`:
  `snapGridSizeMm { min: 1, max: 100, step: 0.5 }`. New `features/editor/snap-grid/snap-grid-popover.ts`
  (inline template/styles; input `snapGrid`, output `snapGridChange`; `mat-slide-toggle` emits at once,
  `app-number-field` emits on `committed`, invalid → touched, no emit; `syncFromInput` resets the form;
  host `role="dialog"`; i18n ids `@@editor.snapGrid.button|heading|enabled|sizeMm`). Editor page: button
  `grid_4x4` after `toolbar-spacer` with `cdkOverlayOrigin`, class `.toolbar-active` (secondary-container)
  when enabled, `aria-haspopup="dialog"`, `aria-expanded`; `<ng-template cdkConnectedOverlay>` with
  transparent backdrop, `(backdropClick)`/`(detach)` → `closeSnapGrid()` (CDK detaches on Esc itself),
  positions below-end, below-start, above-end; `updateSnapGrid()` → `store.updateSettings({ ...settings,
  snapGrid })`. Decisions confirmed by the developer: `cdkTrapFocus` + `cdkTrapFocusAutoCapture` on the
  popover (focus in on open, back to the button on close); toggle with an invalid typed size saves the last
  committed size; a click on the button while open closes the popover (backdrop); Ctrl/Cmd+Z with focus on
  the toggle triggers editor undo (accepted, unchanged).

### Step 3 — Snapping while moving photos and texts
- **Status:** done (reviewed 2026-11-13)
- **What:** pure snap module (grid lines from size, margin, page size; nearest-edge delta per axis); renderer
  receives the snap grid config from the settings; photo and text drag apply the delta during the drag
  (`dragmove` or `dragBoundFunc`), skipped with Alt or grid off. Committed position = snapped position.
- **Acceptance criteria:** grid on: a dragged photo's left or right edge (whichever is nearer) lands on
  `margin + n·size` or on `pageWidth − margin`; same vertically; rotated photo: bounding box edges snap;
  texts the same; Alt held: free move; grid off: free move; changing the arrangement mode changes the margin
  used.
- **Notes:** Done. New `features/editor/geometry/snap-grid.ts` (pure): `snapGridOf(settings)` → `SnapGrid |
  null` (null when off or size not > 0/finite; the only place of the margin rule: `mode === 'grid'` →
  `grid.marginMm`, else `center.marginMm`, invalid margin = 0); `snapToAxis(value, axis)` (nearest of
  `margin + n·size` and `pageSide − margin`), `snapEdgesDelta(start, end, axis)`, `snapRectDelta(rect,
  grid)` — the first two are meant for step 4. `canvas/scene.ts`: required `Scene.snapGrid: SnapGrid |
  null`; `editor-canvas.ts` sets `snapGridOf(settings)` (displayed settings incl. preview);
  `page-image-renderer.ts` sets `null`. `photo-view.ts` / `text-view.ts`: new `onDragMove(view, evt)` in
  the events interfaces (fired on `dragmove`), no snap logic in the views. `collage-renderer.ts`:
  `snapMove(view, event)` → `snapRectDelta(frameBounds(view.frameBox()), grid)` → `view.group.move(...)`,
  skipped when `isAltPressed(event)` or grid null. Choice `dragmove` over `dragBoundFunc`: Konva 10.9.1
  `Node._setDragPosition` recomputes the position from `pointer − offset` (offset captured once at drag
  start) → no drift; `DragAndDrop._drag` fires `dragmove` synchronously before the rAF batch draw → no
  flicker; `dragend` commits the last snapped position; the Transformer's dragmove handler runs after the
  node's → handles follow; `dragBoundFunc` would need px↔mm conversion. Accepted details: ties → left/top
  edge, and a grid line beats the far margin line; pressing Alt without pointer movement takes effect on the
  next move.

### Step 4 — Snapping while resizing photos
- **Status:** done (reviewed 2026-11-13)
- **What:** in the photo transformer, extend `boundBoxFunc` (keep `limitSize`): convert the box to mm, edge
  handle → snap the moved edge; corner handle → snap the axis with the nearer line, derive the other from
  the aspect; skip for rotation not a multiple of 90°, with Alt, or grid off. Text transformer unchanged.
- **Acceptance criteria:** grid on, unrotated photo: edge handle moves the edge from grid line to grid line;
  corner handle: one edge lands on a line, aspect kept; photo rotated 90°: same; photo rotated 15°: free
  resize; Alt: free resize; minimum frame size still enforced.
- **Notes:** Done. `geometry/snap-grid.ts`: `snapResizeRect(rect, moving, keepAspect, grid)` (axis-aligned
  box in mm + moving edge per axis; edge handle → moved edge to nearest line; corner → nearer axis snaps,
  other follows the aspect, tie → x; opposite corner fixed; returns the box unchanged if a snapped side
  would be <= 0). `canvas/selection-transformer.ts`: protected hook `adjustBox(newBox)` (identity by
  default); `boundBoxFunc` = `limitSize(oldBox, adjustBox(newBox))` — text transformer does not override it.
  `canvas/photo-transformer.ts`: `setSnapGrid(grid)` + `adjustBox` override: px → mm via the layer absolute
  transform, swaps width/height for 90°/270°, maps the anchor name through the rotation to page edges, snaps,
  converts back. Only for the 8 resize anchors (never `rotater`), rotation within 0.01° of a multiple of
  90°, grid set, Alt not held. Alt is read in `anchorDragBoundFunc(oldPos, newPos, e)` (records `e.altKey`,
  returns the position unchanged) because `boundBoxFunc` gets no event. `collage-renderer.ts`: `render()`
  calls `transformer.setSnapGrid(scene.snapGrid)`. Hook choice (Konva 10.9.1 `Transformer.js`):
  `_moveTransform` applies the keepRatio correction (l. 904–1011) before `_fitNodesInto` (l. 1036);
  `boundBoxFunc` is called at l. 1172–1173 and its box is applied as-is (l. 1196–1213) → exact snap;
  `anchorDragBoundFunc` runs before the aspect correction (l. 848) → not exact, rejected. Minimum size:
  snapping first, then `limitSize`; a snap below 5 mm keeps the previous box.
  **Alt conflict (decided by the developer):** Konva uses Alt for centred scaling during resize
  (`centeredScaling() || e.altKey`, l. 899/1014). Decision: keep both — Alt = no snap + centred scaling.
  Rejected: suppressing Konva's Alt centred scaling (no flag; would need a fragile event wrapper).

## Open questions

- None. Note for `doc/agent-plans/frame-resize-mode.md`: resize snapping lives in
  `PhotoTransformer.adjustBox` (`boundBoxFunc`) and assumes corner handles keep the aspect and edge handles
  move one edge; a free-resize mode must keep this working.

## Current state / Next action

- All steps 1–4 done (reviewed 2026-11-13). Feature complete. Nothing half-finished, no temporary changes.
  Not committed yet.
