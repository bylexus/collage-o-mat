# Swap two photos

**Ticket/Source:** Backlog of `doc/agent-plans/done/poc-implementation.md` (requested by the developer 2026-11-13)
**Branch:** none (developer decided: no feature branch)
**Status:** done

## Goal

The user swaps the places of two arbitrary photos in the editor, the same way "Set as centre" swaps the
selected photo with the centre photo today. Flow: select photo A, click the toolbar "Swap" button (pick mode
starts), click photo B → A and B change places (frames swap). One undo step, saved by the auto-save.

## Scope

**In scope:**
- Toolbar button "Swap" (icon `swap_horiz`) that starts/ends a temporary swap pick mode.
- Swap pick mode on the canvas: only a click on another photo does something (the swap); edits are locked.
- Store method that swaps two photos (frames, crop centre kept, z swapped, `centerPhotoId` follows).
- Crop change in `swapFrames` (keep the photo's crop centre) — this also changes "Set as centre".
- `setCenterPhoto` refactored to use the same swap helper as the new swap (DRY).

**Out of scope:**
- Swapping texts, or a photo with a text. Photos that are not placed (`props = {}`) — they are not on the
  canvas, so they cannot be clicked.
- Drag & drop swapping (e.g. Alt+drag A onto B) — rejected, see decision log.
- Keyboard shortcut to start swap mode, canvas hint text, special cursor.
- Backend changes (the full layout incl. `photos.props` and `settings` is saved as today).
- Automated tests.

## Rough Architecture / Concept

Frontend only.

- **Geometry:** `frontend/src/app/features/editor/swap-frames.ts` — `swapFrames(a, b)` stays the one swap
  function. Change: the new crop is `coverCrop(imageAspect, newFrameAspect, centreOfCurrentCrop)` (max cover
  crop for the new frame, centred on the centre of the photo's current crop) instead of a crop centred on the
  image. `coverCrop` in `geometry/crop.ts` already takes an optional `center` and clamps inside the image.
- **Store:** `EditorStore` (`features/editor/editor.store.ts`) gets a public `swapPhotos(aId, bId)` and a
  private helper that swaps the frames of two placed photos (uses `swapFrames` + `applyFrames`).
  `swapPhotos` also updates `settings.center.centerPhotoId` (see decision log), calls `markManualChange()`
  and `commit()` once. `setCenterPhoto(id)` uses the same private helper.
- **Mode state:** UI state, not layout → lives in `EditorPage` (`features/editor/editor.page.ts`) as a signal
  (e.g. `swapPicking`). It ends when the selection is no longer the photo A that started it, or A is not
  placed / not present (an `effect` or computed check against `store.selectedPhoto()`).
- **Canvas:** `EditorCanvas` (`canvas/editor-canvas.ts`) gets input `swapMode: boolean` and output
  `swapTarget: number` (id of photo B). `CollageRenderer` (`canvas/collage-renderer.ts`) gets the swap mode
  through the scene or a setter, and a callback `onSwapTarget(id)`. In swap mode: elements are not draggable,
  the transformer shows the selection frame of A without resize/rotate handles, double-click does not start
  crop mode, a click on another photo calls `onSwapTarget`, all other clicks are ignored. Pan/zoom stay.
  Starting swap mode ends a running crop mode (pending crop committed, `cropMode.end(true)`).
- **Page wiring:** `(swapTarget)` → `store.swapPhotos(selectedId, targetId)`, then end the mode. Esc ends the
  mode via the page's existing window keydown host listener. Clicking the Swap button again ends the mode.

Why: the pure swap function already exists (reuse, DRY); a toolbar mode fits the existing "Set as centre"
pattern and is discoverable; keeping the mode state in the page keeps the store free of UI-only state; the
renderer already has the pattern of a temporary mode that locks edits (`CropMode` + `applyInteractionState`).

## Context for a new agent

- **Sources read:**
  - `doc/agent-plans/done/poc-implementation.md` — architecture conventions (SOLID, DRY, clean code; pure
    functions without Angular/DOM in `arrange/`, `geometry/`, `swap-frames.ts`), data model, decision log
    "Centre photo selection": "Set as centre" toolbar button (center mode, photo selected); no confirm; the
    selected photo and the current centre photo swap their frames (centre, size, rotation, z; crop = centred
    cover crop of the own image; border stays with the photo; one undo step); `centerPhotoId` is set too.
    Rejected there: re-arrange all photos.
  - Sandbox notes (poc plan "Current state"): if a command or file access fails, it can be the Claude Code
    sandbox — report the exact command/path to the developer. `pkill`/process listing is blocked.
- **Key files and directories** (all under `frontend/src/app/features/editor/`):
  - `swap-frames.ts` — `swapFrames(a: FramedPhoto, b: FramedPhoto): [PhotoProps, PhotoProps]`; private
    `inFrameOf(photo, frame)` copies `cxMm, cyMm, widthMm, heightMm, rotationDeg, z` from the other frame and
    computes `crop`; border and the rest of the own props stay.
  - `geometry/crop.ts` — `imageAspect(wPx, hPx)`, `coverCrop(imageAspect, frameAspect, center?)`,
    `fullCrop()`. Crop is a `NormalizedRect` `{x, y, width, height}` in 0..1 image coordinates; its centre is
    `{ x: x + width/2, y: y + height/2 }`.
  - `editor.store.ts` — `EditorStore`: signals `photosSignal`, `settingsSignal`, `selectionSignal`;
    `select()`, `commit()` (the single path of a committed change: undo snapshot + auto-save),
    `applyFrames(FrameMap)` (not committed), `markManualChange()`, `setCenterPhoto(id)`,
    `requireSettings()`. `resolveCentrePhotoId(photos, centerPhotoId)` from `arrange/arrange` gives the
    effective centre photo (configured id if present, else the first photo).
  - `editor.page.ts` / `editor.page.html` / `editor.page.scss` — toolbar. "Set as centre" button
    (`center_focus_strong`, only in center mode, `disabledInteractive`, tooltip `setCentreHint()` explains
    disabled states). Snap grid button uses class `toolbar-active` for its active state. Host listener
    `(window:keydown)` → `handleUndoRedoKey`. Labels via `$localize` with `@@editor.*` ids.
  - `canvas/editor-canvas.ts` — inputs `settings, photos, collageId, texts, selection`; outputs
    `selectionChange, photoChange, textChange, textEditRequest`; builds the `Scene`; creates
    `CollageRenderer` with `RendererCallbacks`.
  - `canvas/collage-renderer.ts` — `onClick(target)` (ignores gestures/transformer clicks; crop mode handling;
    else `callbacks.onSelect(selectionOf(target))`), `onDoubleClick` (text edit / crop mode start),
    `applyInteractionState()` (draggable + transformer attach depending on crop mode), `viewOf(target)`,
    `onPhotoDragStart` (selects an unselected photo).
  - `canvas/crop-mode.ts` — example of a temporary mode (Esc via window keydown capture, `end(commit)`).
  - `canvas/photo-transformer.ts` — the Konva transformer of the selected photo (handles).
  - `selection.ts` — `EditorSelection`, `sameSelection`, `selectedPhotoIdOf`.
  - `core/models/photo.ts` — `Photo`, `PhotoProps`, `isPlaced(props)`.
- **Existing patterns to follow:** `setCenterPhoto` (store swap + commit), "Set as centre" button (toolbar
  button with disabled tooltip), snap grid button (`toolbar-active`), `CropMode` (temporary canvas mode that
  locks edits).
- **Commands:**
  - Host (macOS): `make dev-up`, `make dev-shell`, `make dev-down`.
  - In the dev container (`/workspace`): `make backend-run` (:8080), `make frontend-serve` (:4200, proxies
    `/api`), `make build`.
  - Type check / build of the frontend: `cd frontend && npx ng build`.
  - Dev URL: `http://localhost:4200`.
- **Environment / prerequisites:** a collage with several imported photos (Immich connector or local upload).
- **Domain terms:** *frame* = rectangle of a photo on the page (centre, size, rotation); *crop* = visible part
  of the image in normalized image coordinates; *placed photo* = photo with non-empty `props`; *centre photo*
  = the photo in the middle in the `center` arrangement mode (`settings.center.centerPhotoId`); *source photo
  A* = selected photo that starts swap mode; *target photo B* = photo clicked in swap mode.
- **External references:** none.

## Decision log

- **Flow:** select A → toolbar "Swap" → click B. — *Rationale:* discoverable, fits the "Set as centre"
  toolbar pattern. Rejected: modifier drag & drop (Alt+drag A onto B) — hidden, needs new drop-target hit
  test code; both flows together — more code and test effort.
- **Mode indicator:** Swap button highlighted (`toolbar-active`, as the snap grid button) and A keeps its
  selection frame without resize/rotate handles. — *Rationale:* developer choice. Rejected: canvas hint text,
  crosshair cursor.
- **Cancel:** Esc key, or the Swap button again. — *Rationale:* developer choice. Rejected: click on empty
  area / on A / on a text cancels.
- **Other clicks in the mode:** a click on the empty area, on A itself or on a text is ignored; the mode stays.
  — *Rationale:* one clear rule: the mode ends only by swap, Esc, the button, or the auto-end rule below.
- **Canvas edits in the mode:** none. No drag/move of photos or texts, no handles, no double-click crop
  mode. Pan/zoom (wheel, drag on empty area, zoom buttons) stay. — *Rationale:* a drag on B must not move B
  instead of swapping; same pattern as crop mode. Rejected: elements stay draggable.
- **Actions outside the canvas (toolbar, side panel) in the mode:** stay usable; they do not end the mode by
  themselves. — *Rationale:* simple, one rule. Rejected: any change ends the mode (hooks in many places);
  disable toolbar/panel during the mode (much template code).
- **Auto-end rule:** the mode ends when A is no longer the selected, placed photo (e.g. "Add text" selects
  the new text, delete of A, undo/redo that makes A unplaced or changes the selection). — *Rationale:* the
  mode means "the selected photo waits for a partner"; the marker is the selection frame. Rejected: track A by
  id independent of the selection (needs a separate marker).
- **Selection after the swap:** A stays selected (at its new place); the mode ends. — *Rationale:* the user
  sees where the photo moved and can swap it again at once. Rejected: B selected; nothing selected.
- **Crop after the swap:** max cover crop for the new frame, centred on the centre of the photo's current
  crop (`coverCrop(..., center)`, clamped inside the image). Manual pan survives, manual zoom is reset. This
  changes `swapFrames`, so "Set as centre" gets the same behaviour. — *Rationale:* keeps the user's framing
  as far as possible with no extra rules. Rejected: centred cover crop as before (manual crop lost); keep the
  crop unchanged when the aspect is the same (more rules, "almost equal" edge case).
- **z-order:** z swaps with the frame (unchanged `swapFrames` behaviour). — *Rationale:* the overlaps of the
  layout stay the same (e.g. the centre frame stays on top). Rejected: each photo keeps its z.
- **`centerPhotoId`:** if the resolved centre photo (`resolveCentrePhotoId`) is A, it becomes B; if it is B, it
  becomes A; done in all arrangement modes, in the same undo step. — *Rationale:* the centre frame and
  `centerPhotoId` stay consistent; a later re-arrange keeps the photo the user put in the middle. Rejected:
  only in center mode; never change it.
- **Toolbar button:** icon `swap_horiz`, shown in all arrangement modes, left of "Set as centre",
  `disabledInteractive` with a tooltip that explains the disabled state. Disabled when no photo is selected or
  fewer than 2 placed photos exist. — *Rationale:* same pattern as "Set as centre".
- **Crop mode vs. swap mode:** starting swap mode ends a running crop mode with its pending change committed
  (`cropMode.end(true)`). — *Rationale:* both modes lock edits differently; only one mode at a time.
- **Mode state location:** `EditorPage` signal, not the store. — *Rationale:* UI-only state, not part of the
  layout, undo or save.
- **Shared code with "Set as centre":** `setCenterPhoto` and `swapPhotos` use one private store helper for
  the frame swap. — *Rationale:* DRY.
- **Esc with the snap grid popover open:** the first Esc closes only the popover, a second Esc ends swap mode
  (`event.defaultPrevented` check). — *Rationale:* found in step 2, accepted with the step review.
- **Testing:** manual review only. — *Rationale:* PoC rule; the frontend has no spec files.
- **Branch:** no feature branch. — *Rationale:* developer decision.

## Testing strategy

No automated tests, manual review only (by the developer, after each step).

## Steps

### Step 1 — Swap logic in the store
- **Status:** done (reviewed 2026-11-13)
- **What:**
  - `swap-frames.ts`: `inFrameOf` computes the crop with `coverCrop(imageAspect(photo.image...), widthMm /
    heightMm, centreOf(photo.props.crop))`. Update the doc comments.
  - `editor.store.ts`: private helper that swaps the frames of two placed photos (no commit); public
    `swapPhotos(aId, bId)`: no-op if `aId === bId` or one of them is missing/not placed; swaps frames; if
    `resolveCentrePhotoId(photos, settings.center.centerPhotoId)` is A or B, set `centerPhotoId` to the other;
    `markManualChange()`; one `commit()`. Selection unchanged.
  - `setCenterPhoto(id)` uses the private helper (behaviour otherwise unchanged).
  - `swapPhotos` is not wired to the UI in this step.
- **Acceptance criteria:**
  - `cd frontend && npx ng build` has no errors.
  - Center mode: double-click a non-centre photo, pan the crop to one side, leave crop mode, select it, "Set as
    centre" → in the centre frame the photo shows the same image area centred (as far as the new aspect
    allows), not the image centre. Undo restores both photos in one step.
  - "Set as centre" otherwise behaves as before (border stays, z swapped, `centerPhotoId` set).
- **Notes:**
  - `swap-frames.ts`: `inFrameOf` passes `centreOf(photo.props.crop)` (private helper, `{x + w/2, y + h/2}`)
    as the `center` argument of `coverCrop`.
  - `editor.store.ts`: new `private swapPlacedFrames(aId, bId): boolean` (swapFrames + applyFrames, no
    commit; `false` and no change if a photo is unknown or not placed). New public `swapPhotos(aId, bId)`:
    resolves the centre photo before the swap, returns early if `aId === bId` or the helper returns `false`,
    sets `centerPhotoId` to the other photo if the resolved centre is A or B, then `markManualChange()` and
    one `commit()`; selection unchanged. `setCenterPhoto` calls `swapPlacedFrames(id, currentId)` only if
    `currentId !== null` (type guard; same behaviour as before); it still does not call `markManualChange`.
  - Verified: `npx ng build` passes; developer reviewed "Set as centre" with the kept crop centre.

### Step 2 — Swap pick mode UI
- **Status:** done (reviewed 2026-11-13)
- **What:**
  - `editor.page.ts/html`: Swap button (`swap_horiz`, all modes, left of "Set as centre",
    `disabledInteractive`, tooltip with disabled reasons: no photo selected / fewer than 2 placed photos;
    active state `toolbar-active`; click toggles the mode). Signal for the mode (remember A's id); auto-end
    when the selected photo is no longer A or A is not placed; Esc ends the mode in the window keydown
    handler (not while a dialog is open); `(swapTarget)` → `store.swapPhotos(A, B)` and end the mode.
  - `editor-canvas.ts`: input `swapMode: boolean`, output `swapTarget: number`, pass to the renderer.
  - `collage-renderer.ts` (+ `photo-transformer.ts` if needed): swap mode locks edits (not draggable, no
    handles but the selection frame of A stays visible), no crop mode start on double-click, a click on
    another photo → `onSwapTarget(id)`, other clicks ignored; entering swap mode ends a running crop mode
    with commit. Pan/zoom unchanged.
  - New `$localize` labels with `@@editor.swap*` ids.
- **Acceptance criteria:**
  - No photo selected → Swap button disabled, tooltip explains why; same with fewer than 2 placed photos.
  - Select A → Swap → button highlighted, A shows its frame without handles; photos/texts cannot be dragged;
    double-click does nothing; pan/zoom work.
  - Click on the empty area, on A or on a text → nothing happens, mode stays.
  - Click on B → A and B swap places (frame, size, rotation, z; border stays with each photo; crop centred on
    the old crop centre); A stays selected; mode ends; one undo step reverts both; the change is auto-saved
    (reload shows it).
  - Esc, or the Swap button again → mode ends, nothing changes.
  - "Add text" or deleting A during the mode → mode ends.
  - Crop mode active, then Swap → crop mode ends (crop kept), swap mode starts.
  - Center mode: swap the centre photo with another → `centerPhotoId` follows (a "Re-arrange" keeps the
    new photo in the middle).
- **Notes:**
  - `canvas/selection-transformer.ts`: new `setHandlesEnabled(enabled)` (Konva `resizeEnabled` +
    `rotateEnabled`); without handles only the selection frame shows.
  - `canvas/collage-renderer.ts`: swap mode is passed by a setter `setSwapMode(on)` (interaction state like
    crop mode, not part of the `Scene`); starting it calls `cropMode.end(true)`. `applyInteractionState`
    makes nothing draggable, disables the photo handles and attaches no text transformer in swap mode.
    `onClick` in swap mode → private `onSwapClick` (only a photo other than the selected one calls the new
    callback `onSwapTarget`); `onDoubleClick` returns at once in swap mode.
  - `canvas/editor-canvas.ts`: input `swapMode` (default `false`), output `swapTarget: number`; an effect
    calls `renderer.setSwapMode(...)`.
  - `editor.page.ts`: signal `swapSourceId` (photo A); computed `swapping` (A is the selected, placed photo);
    an effect resets `swapSourceId` when `swapping` is false (the mode cannot come back). `canSwap` (selected
    photo placed and >= 2 placed photos), `swapHint` (active hint first, then the disabled reasons),
    `toggleSwap`, `swapWith(targetId)` (→ `store.swapPhotos(A, B)`, then ends the mode), and
    `endSwapOnEscape` on a second host listener `(window:keydown.escape)`; `handleUndoRedoKey` unchanged.
    New ids: `@@editor.swap`, `@@editor.swapSelectFirst`, `@@editor.swapTooFewPhotos`,
    `@@editor.swapActiveHint`, `@@editor.swapHint` (no extracted i18n files exist, so no file changes).
  - `editor.page.html`: button `[disabled]="!canSwap() && !swapping()"` so the active button can always end
    the mode (e.g. B deleted and only A left).
  - Esc does nothing if `event.defaultPrevented` is set: with the snap grid popover open, the first Esc only
    closes the popover, a second Esc ends swap mode. Accepted by the developer with the step review.
  - Known behaviour: a double-click on B swaps on the first click; the second click then selects B with the
    normal click handling (mode already ended).

## Open questions

(none)

## Current state / Next action

- Plan agreed 2026-11-13.
- Step 1 done (reviewed 2026-11-13): `swapFrames` keeps the crop centre; `EditorStore.swapPhotos(aId, bId)`
  exists but is not wired to the UI yet.
- Step 2 done (reviewed 2026-11-13): swap pick mode UI.
- Feature done. Nothing half-finished, no temporary changes. Not committed yet.
