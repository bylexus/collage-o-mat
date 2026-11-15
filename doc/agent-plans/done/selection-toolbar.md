# Selection toolbar (floating toolbar for the selected photo or text)

**Ticket/Source:** none (developer idea, 2026-11-15, after `done/photo-adjustments.md`)
**Branch:** none (work on `main`, not committed)
**Status:** done

## Goal

The right-side editor panel is too crowded: it shows the properties of the selected photo or text on top
of the full collage settings. All element-specific functions move into a floating toolbar below the
selected element on the canvas. Each toolbar icon either runs an action at once or opens a small popover
with the existing fields. The right panel then shows only the collage settings.

## Scope

**In scope:**
- Floating toolbar for a selected **photo** and a selected **text**, shown on single-click selection.
- Photo toolbar: Crop (starts crop mode, same as double-click), Border, Shadow, Adjustments (popovers),
  Bring to front, Send to back, Use as background, Delete (actions).
- Text toolbar: Edit text (text, font, size, colour, bold/italic, alignment), Outline, Shadow
  (popovers), Bring to front, Send to back, Delete (actions).
- Double-click on a text opens the "Edit text" popover with the focus in the text field.
- Right panel: only the collage settings panel (`app-collage-settings-panel`).
- Removal of `photo-panel/photo-properties-panel.*` and `text-panel/text-properties-panel.*` after their
  content is split into section components.

**Out of scope:**
- Changes to the top toolbar (Swap, Centre photo, Delete stay as they are).
- Changes to the collage settings panel content.
- Crop mode behaviour and its zoom pane (`canvas/crop-mode-controls.ts`) stay unchanged.
- Multi-selection, keyboard shortcuts for toolbar actions, touch-specific layouts.
- Flip of the toolbar above the element, clamping the toolbar inside the canvas.

## Rough Architecture / Concept

- `CollageRenderer` (`features/editor/canvas/collage-renderer.ts`) reports a **toolbar anchor**: the
  bottom centre of the selected element's bounding box (rotation included) in container px, or `null`
  when the toolbar must be hidden (no selection, drag/rotate/resize gesture in progress, crop mode on,
  swap mode on). It is updated on render, on view change (pan/zoom) and at gesture start/end. The
  bounding-box math is the one of `CropMode.anchorOf` (`canvas/crop-mode.ts`), moved to a shared helper.
- `EditorCanvas` (`canvas/editor-canvas.ts`) exposes the anchor as an output; it stays presentational.
- NEW `features/editor/toolbar/selection-toolbar.*`: presentational component, absolutely positioned at
  the anchor in the canvas area of `editor.page.html` (not clamped, no flip; the user pans the canvas to
  see it). Icon buttons with `matTooltip`. One popover at a time with `@angular/cdk/overlay` connected to
  the toolbar button.
- Popover content = section components split from the existing panels (logic moved, not rewritten):
  photo `PhotoBorderSection`, `PhotoShadowSection`, `PhotoAdjustSection`; text `TextEditSection`,
  `TextOutlineSection`, `TextShadowSection`.
- New `CollageRenderer.startCropMode(photoId)` for the Crop button, same code path as the double-click
  (`onDoubleClick` → `cropMode.start(view, photo)`).

*Why:* the floating toolbar keeps the functions next to the element (canvas-centric, like the crop zoom
pane) without mixing them into crop mode. CDK overlay is already installed and handles popover
positioning inside the window. Splitting the panels keeps all existing form/sync/preview logic.

## Context for a new agent

- **Sources read:**
  - `doc/architecture.md` — frontend structure: page components hold state, presentational components use
    `input()`/`output()` and do no API calls; `EditorStore` holds the layout; previews are not saved,
    commits make one undo step.
  - `doc/agent-plans/done/photo-adjustments.md` — the Adjustments section that now moves into a popover.
- **Key files and directories (`frontend/src/app/features/editor/`):**
  - `editor.page.html` / `editor.page.ts` — layout: canvas area + `<aside class="editor-panel">` with
    `app-photo-properties-panel` or `app-text-properties-panel` above `app-collage-settings-panel`; wires
    the panel outputs to `EditorStore` (`setPhotoBorder`, `previewPhotoBorder`, `setPhotoShadow`,
    `previewPhotoShadow`, `setPhotoAdjust`, `previewPhotoAdjust`, `bringToFront`, `sendToBack`,
    `useAsBackground`, `deletePhoto`, `previewText`, `updateTextProps`, `bringTextToFront`,
    `sendTextToBack`, `deleteText`). `editText(id)` + `focusTextPanel()` handle the text double-click
    (`textEditRequest` from the canvas). Top toolbar has Swap (`swapping()`), Centre, Delete.
  - `canvas/editor-canvas.ts` — presentational canvas; shows `app-crop-mode-controls` positioned with
    CSS vars `--anchor-x/--anchor-y` from `CropModeState.anchor` (pattern for the toolbar position);
    renderer callbacks in `createRenderer()`.
  - `canvas/collage-renderer.ts` — Konva input: selection, `onDoubleClick` (text → `onTextEditRequest`,
    photo → crop mode), transformer callbacks (`onTransform`/`onTransformEnd`), drag handlers,
    `cropMode.viewChanged()` on view change, `setSwapMode`.
  - `canvas/crop-mode.ts` — `CropModeState.anchor` and `anchorOf(session)`.
  - `photo-panel/photo-properties-panel.{ts,html,scss}`, `photo-panel/adjust-limits.ts` — border,
    shadow, adjustments, z-order, background, delete.
  - `text-panel/text-properties-panel.{ts,html,scss}`, `text-panel/text-limits.ts` — text, font, size,
    colour, style, align, shadow, outline, z-order, delete; `focusText()`.
  - `fields/` — shared form fields (`BorderFields`, `ShadowFields`, `ColorField`, `NumberField`,
    `LengthField`, `syncFromInput`).
- **Commands:** `cd frontend && npx ng build` (verification). Dev: host `make dev-up && make dev-shell`;
  container `make backend-run`, `make frontend-serve` (http://localhost:4200).
- **Libraries:** `@angular/cdk` 22 and `@angular/material` 22 are dependencies already (no new library).
- **Domain terms:** *Selection toolbar* = the floating icon row below the selected element. *Popover* =
  CDK overlay panel opened from a toolbar icon. *Anchor* = container px point (bottom centre of the
  element's bounding box) where the toolbar is placed.

## Decision log

- **Direction:** floating toolbar on single-click selection (option C). — *Rejected:* all photo functions
  in the double-click crop pane (mixes crop mode with properties, hidden behind double-click, ~600 px
  pane, texts inconsistent); tabs in the right panel; collapsible sections.
- **Texts:** photos and texts both get the toolbar in this feature.
- **Buttons/grouping:** photo: Crop, Border, Shadow, Adjust (popovers/mode), Front, Back, Background,
  Delete (actions); "Reset" of the developer's idea = "Reset adjustments" inside the Adjust popover.
  Text: Edit text, Outline, Shadow (popovers), Front, Back, Delete. — *Rejected:* one big "Style" /
  "Format" popover.
- **Position:** below the element's bounding box, centred; follows pan/zoom; **no flip and no clamp**
  (the user pans the canvas to see it; the developer's decision). Hidden during drag/rotate/resize (open
  popover closes) and shown again at gesture end; hidden in crop mode and swap mode.
- **Popover:** `@angular/cdk/overlay` connected to the toolbar button; opens below the toolbar, CDK may
  move it above or push it inside the window (popover only). One popover at a time. Closes on: same
  button again, Escape, click outside (the click works normally, e.g. selects another element),
  selection change, gesture start, crop/swap mode. Changes are live as today (no OK/Cancel). —
  *Rejected:* inline div inside the canvas (cut off by the canvas edge).
- **Double-click on a text:** opens the Edit popover with focus in the text field.
- **Right panel:** only collage settings. Top toolbar unchanged.
- **Escape in a popover:** commits a pending edit before the popover closes, in all sections (photo and
  text). — *Rejected:* discard on Escape; keep text-commit/photo-discard inconsistency.
- **Duplicate labels:** popovers whose checkbox already names the section (e.g. "Outline" heading +
  "Outline" checkbox) have no heading. — *Rejected:* rename the checkbox to "Enabled"; keep both.
- **Top toolbar (changed 2026-11-15, developer feedback):** remove the Delete button (both toolbars
  have Delete); move Swap and "Set as centre" into the floating photo toolbar. Top toolbar keeps only
  collage-wide actions. Supersedes "Top toolbar unchanged".
- **Swap mode:** the floating toolbar stays below the source photo but shows only the highlighted Swap
  button (click = cancel); Escape still cancels. Supersedes "hidden in swap mode". — *Rejected:* toolbar
  hidden (no visible cancel), full toolbar with other buttons disabled.
- **Set as centre:** in the floating photo toolbar, only in center arrangement mode, disabled with tooltip
  when the photo is already the centre photo (same logic as the old top toolbar button).
- **Movable popovers (2026-11-15, developer request, only if simple):** `cdkDrag` from
  `@angular/cdk/drag-drop` (already installed) on the popover panel, handle = grip bar at the top of every
  popover (`drag_indicator` icon, cursor move, tooltip "Move"); drag limited to the window; each new open
  starts at the default place. — *Rejected:* drag on empty areas (not discoverable, must exclude all
  controls).
- **Popover height (changed 2026-11-15, developer feedback after Step 3e):** a popover has its natural
  height and may extend below the window bottom (the user drags it up to see it); no shrink to the space
  below the toolbar. Limit only to the window height (minus margins) so a very tall popover still fits
  after dragging; then its content scrolls. Supersedes the Step 3b max-height = space below. Still opens
  below the toolbar, never pushed up onto it; horizontal keep-inside-window stays.
- **Process:** plan approved 2026-11-15; implement all steps with sub-agents, no review stop between
  steps unless a decision is needed; developer reviews at the end.

## Testing strategy

No automated tests (project rule in `AGENTS.md`). Each step: `cd frontend && npx ng build`; manual review
by the developer at the end with the acceptance criteria below.

## Steps

### Step 1 — Anchor + toolbar shell with actions
- **Status:** done (reviewed 2026-11-15)
- **What:** shared bounding-box anchor helper (from `CropMode.anchorOf`); renderer callback
  `onToolbarAnchorChange(anchor | null)` with the hide rules; `CollageRenderer.startCropMode(photoId)`;
  `EditorCanvas` output; `toolbar/selection-toolbar.*` with photo and text icon rows, tooltips, i18n;
  direct actions wired (crop, front, back, background, delete); popover buttons present but may be
  disabled/no-op until steps 2–3. Right panel unchanged.
- **Acceptance criteria:** select a photo/text → toolbar below it; pan/zoom → follows; drag/rotate/resize
  → hidden, back at end; crop button = crop mode (toolbar hidden, zoom pane shown); swap mode → hidden;
  actions work with one undo step each.
- **Notes:**
  - NEW `canvas/element-anchor.ts`: `bottomCentreOf(node)` (former `CropMode.anchorOf`, works on the
    `group` of `PhotoView` and `TextView`), `sameAnchor(a, b)`; `crop-mode.ts` uses it.
  - `collage-renderer.ts`: callback `onToolbarAnchorChange`, emitted (only on change) after `render`,
    `setSize`, pan/zoom, `setSwapMode`, crop mode change, web font load; public `startCropMode(photoId)`
    (used by `onDoubleClick`).
  - `editor-canvas.ts`: output `toolbarAnchorChange`, public `startCropMode(photoId)`.
  - NEW `toolbar/selection-toolbar.{ts,html,scss}`: inputs `kind` ('photo' | 'text'), `isBackground`;
    outputs `crop`, `bringToFront`, `sendToBack`, `useAsBackground`, `delete`; i18n `@@editor.toolbar.*`.
    Icons: photo `crop`, `border_style`, `shadow`, `tune` | `flip_to_front`, `flip_to_back` |
    `wallpaper`, `delete`; text `edit`, `format_color_text`, `shadow` | front, back | `delete`. Popover
    buttons disabled until steps 2–3. "Use as background" uses `disabledInteractive` with tooltip
    "Background image" when it already is the background (pattern of the Swap button).
  - `editor.page.{ts,html,scss}`: `viewChild(EditorCanvas)`, `toolbarAnchor` signal; toolbar placed 8 px
    below the anchor, `translateX(-50%)`; `.editor-canvas-area` has `overflow: hidden`. Delete: photo via
    `store.deletePhoto` (confirmation), text via `store.deleteText` (no confirmation) — same as the panel.
  - Deviation: on resize/rotate the toolbar hides at the first handle move, not at the press (no
    transform-start callback exists; drag also starts only after the drag threshold, so both behave the
    same). Click isolation needed no code: the toolbar is an HTML sibling of the Konva container.

### Step 2 — Photo popovers
- **Status:** done (reviewed 2026-11-15)
- **What:** CDK overlay popover mechanism in the toolbar with the close rules; split
  `photo-properties-panel` into `PhotoBorderSection`, `PhotoShadowSection`, `PhotoAdjustSection`; show
  them in popovers; remove `app-photo-properties-panel` from the right panel and delete the old files.
- **Acceptance criteria:** each popover opens below the toolbar, edits work with live preview and one
  undo step as before; close rules; right panel without photo section.
- **Notes:**
  - NEW `photo-panel/photo-border-section.{ts,html}`, `photo-shadow-section.{ts,html}`,
    `photo-adjust-section.{ts,html,scss}`, shared `photo-section.scss`; logic moved from the deleted
    `photo-properties-panel.*`. Headings inside the sections (`@@editor.toolbar.border`,
    `@@editor.toolbar.shadow`, `@@editor.photo.adjustHeading`, now `h3`).
  - Popover in `toolbar/selection-toolbar.*`: popover buttons have `cdkOverlayOrigin`; one
    `openPopover` signal (`{ id, origin } | null`, type `ToolbarPopoverId`); one
    `<ng-template cdkConnectedOverlay>` with `@switch` on the id (Step 3 adds text ids + `@case`s).
    Position below the button, centred, 8 px gap, fallback above, `cdkConnectedOverlayPush`, 8 px viewport
    margin; 340 px wide (max window width), scrolls if too tall. `afterEveryRender` calls
    `overlayRef.updatePosition()` while open, so it follows the toolbar on pan/zoom.
  - Close: same button (toggle); Escape (`detach`); `overlayOutsideClick` without backdrop (the click
    works normally); selection change (`openPopover` is a `linkedSignal` keyed on `kind:id`); toolbar
    hidden (`@if` removes it, directive disposes the overlay). Nested overlays: mat-select 22 renders its
    panel inline (inside our pane); as a safeguard clicks on `.cdk-overlay-backdrop` / `.cdk-overlay-pane`
    are ignored. Native colour picker sends no page events.
  - Active button: `.toolbar-active` + `aria-expanded`; `aria-haspopup="dialog"`, popover `role="dialog"`.
  - Toolbar inputs: `photo`, optional `defaultBorder`/`defaultShadow`, required `lengthUnit`.
  - Focus stays on the toolbar button when a popover opens (not modal); not restored after Escape.

### Step 3 — Text popovers
- **Status:** done (reviewed 2026-11-15)
- **What:** split `text-properties-panel` into `TextEditSection`, `TextOutlineSection`,
  `TextShadowSection`; popovers in the text toolbar; double-click on a text opens the Edit popover with
  focus in the text field (replace `focusTextPanel`); remove `app-text-properties-panel` from the right
  panel and delete the old files.
- **Acceptance criteria:** text editing as before (live preview, undo), double-click behaviour, add text
  flow still works, right panel only collage settings.
- **Notes:**
  - NEW `text-panel/text-edit-section.{ts,html}` (`TextEditSection`, keeps `focusText()`),
    `text-outline-section.{ts,html}`, `text-shadow-section.{ts,html}`, shared `text-section.scss`; old
    `text-properties-panel.*` deleted (`text-limits.ts` kept). Each section emits full `TextProps`
    (`preview`, `propsChange`) built from the committed `text` input and changes only its own fields.
  - Toolbar: ids `textEdit`, `textOutline`, `textShadow`; inputs `text`, `openTextEditFor`; outputs
    `textChange`, `textPreview`, `textEditOpened`. An effect opens the Edit popover when the requested
    text is shown and the origin exists; a second effect calls `focusText()` in `afterNextRender`.
  - `editor.page.ts`: `pendingTextEdit` signal set by `editText(id)` (double-click) and `addText()`;
    cleared on `textEditOpened` or when that text is no longer selected. `focusTextPanel` removed.
  - Text sections commit on `(keydown.escape)` before the overlay closes (else typed text stays only a
    preview). The photo sections do not do this yet (see Open questions).
  - `ng extract-i18n` runs without warnings; `@@editor.text.heading` is unused now.

### Step 3b — Review fixes of the Adjust popover (developer feedback 2026-11-15)
- **Status:** done (reviewed 2026-11-15)
- **What:**
  - Position: the Adjust popover opens above the toolbar (CDK fallback, it is taller than the space
    below) and covers the photo. It must open **below** the toolbar like the Shadow popover. Fix: no
    "above" fallback position for the popovers; if the popover is taller than the space below, it gets a
    max height and scrolls (compact layout below also reduces the height).
  - Compact sliders: label (Brightness / Contrast / Tint strength) on the same row as the slider, value
    (number, `%` for tint strength) to the right of the slider (or in the slider thumb label if Material
    supports it cleanly: `discrete` + `displayWith`).
  - Tint colour picker + the 2 preset buttons (Sepia, Greyscale) in one row.
- **Acceptance criteria:** Adjust popover opens below the toolbar and does not cover the photo; sliders
  use one row each; colour + presets in one row; behaviour (preview, commit, reset) unchanged.
- **Notes:**
  - Positioning (`toolbar/selection-toolbar.ts`): only the "below" position. `placePopover()` sets
    `overlayRef.updateSize({ maxHeight })` = space below the toolbar (`clientHeight - originBottom - 8 -
    2*8`, min 0), then `updatePosition()`; runs after each render and on window resize. So the popover
    always fits vertically and push only moves it horizontally. `.toolbar-popover` uses
    `max-height: inherit` and scrolls. *Rejected:* CDK flexible dimensions (in CDK 22.2.6 they shrink only
    if the popover fits or has `minHeight`, else push moves it up onto the toolbar, and horizontal push
    stops).
  - `photo-adjust-section.{html,scss}`: slider rows = label | slider | value (tabular numbers); new i18n
    ids `@@editor.photo.brightnessLabel`, `contrastLabel`, `tintStrengthLabel`, `tintStrengthValue`
    (old ids with value inside are unused). Colour picker + Sepia + Greyscale in one row (buttons with
    12 px side padding to fit 340 px). Behaviour code unchanged.

### Step 3c — Escape commit in photo sections + duplicate headings
- **Status:** done (reviewed 2026-11-15)
- **What:** photo sections commit a pending edit on Escape (same `host: { '(keydown.escape)' }`
  mechanism as the text sections); remove headings that repeat the first checkbox.
- **Notes:** `photo-border-section.ts` / `photo-shadow-section.ts`: new `commitPending()` (border: only if
  own border and width/colour differ from the shown value; shadow: only if own shadow, store no-op if
  equal); `photo-adjust-section.ts`: Escape calls `commitAdjust()` (store no-op if equal). Headings
  removed: text Outline, text Shadow. Kept: photo Border, photo Shadow (first checkbox is "Use collage
  default …"), photo Adjust, text Edit. Popover `aria-label`s unchanged. `ng build` and
  `ng extract-i18n` (to scratchpad) without warnings.

### Step 3d — Top toolbar cleanup: Delete removed, Swap + Set as centre moved
- **Status:** done (reviewed 2026-11-15)
- **What:** see decision log entries "Top toolbar (changed …)", "Swap mode", "Set as centre".
- **Acceptance criteria:** top toolbar has no Delete, Swap, Set as centre; floating photo toolbar has Swap
  (enabled/disabled with the same hint logic as before) and Set as centre (center mode only); swap mode
  shows only the active Swap button below the source photo, click cancels, Escape cancels, click on a
  target swaps; text toolbar unchanged.
- **Notes:**
  - `editor.page.{html,ts}`: top toolbar without Delete, Swap, Set as centre; removed `deleteLabel`
    (i18n ids `@@editor.text.delete`, `@@editor.photo.delete` gone), `deleteSelection()`, `swapLabel`,
    `setCentreLabel` (moved to the toolbar with the same ids). Swap/centre state stays in the page.
  - `toolbar/selection-toolbar.*`: inputs `swapping`, `canSwap`, `swapHint`, `showSetCentre`,
    `isCentrePhoto`, `setCentreHint`; outputs `swap`, `setCentre`. Photo row: Crop, Border, Shadow,
    Adjust | Front, Back, Swap, Set as centre | Background, Delete. Swap mode: only the active Swap button
    (`.toolbar-active`, `aria-pressed`, swap hint tooltip); an effect closes an open popover when swap
    mode starts.
  - `collage-renderer.ts`: swap mode no longer gives a `null` anchor.
  - `setCentreHint` keeps its "Select a photo first" case (not reachable now; harmless).

### Step 3e — Movable popovers
- **Status:** done (reviewed 2026-11-15)
- **What:** see decision log "Movable popovers". Only in `toolbar/selection-toolbar.*`.
- **Acceptance criteria:** every popover has a grip bar; dragging it moves the popover inside the window;
  fields still work; the popover still closes by the close rules; reopening starts at the default place.
- **Notes:**

### Step 3f — Popover natural height
- **Status:** done (reviewed 2026-11-15)
- **What:** see decision log "Popover height (changed …)".
- **Acceptance criteria:** near the window bottom the popover keeps its full height and goes below the
  window edge; dragging it up shows it completely; it never opens above/over the toolbar; horizontal edges
  as before; fields and close rules unchanged.
- **Notes:**
  - `placePopover()`: max-height = window height − 2 × 8 px (no "space below" limit); horizontal offset
    computed (centred on the button, ≥ 8 px from the window edges) and set with `withDefaultOffsetX()`
    on the position strategy, then `updatePosition()`. `cdkConnectedOverlayPush` removed: CDK
    `_pushOverlayOnScreen` pushes both axes and would move the popover up onto the toolbar.
  - `cdkDragBoundary` replaced by `[cdkDragConstrainPosition]` (`constrainPopoverDrag`): with the
    boundary, CDK clamps the pointer at drag start when the popover is already below the window → jump.
    The custom constraint keeps the popover inside the window, but an edge that is already outside at
    drag start may stay there (cannot go further out). No jump.
  - No page scrollbars: overlay host is a fixed native popover (`.cdk-overlay-popover`).
  - Known limit: after a window resize a dragged popover is not moved back inside the window.

### Step 4 — Documentation
- **Status:** done (2026-11-15)
- **What:** `doc/architecture.md` frontend table: rows for `features/editor/toolbar/`,
  `photo-panel/` + `text-panel/` (popover sections), `settings-panel/` (only right panel content); plan
  moved to `doc/agent-plans/done/`.
- **Notes:** done as planned.

## Open questions

(none)

## Current state / Next action

Done. All steps (1–4, incl. review fixes 3b–3f) approved by the developer 2026-11-15. Not committed.
