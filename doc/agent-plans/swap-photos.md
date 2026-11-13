# Swap two photos

**Ticket/Source:** Backlog of `doc/agent-plans/poc-implementation.md` (requested by the developer 2026-11-13)
**Branch:** none
**Status:** planning

## Goal

The user swaps the places of two arbitrary photos, the same way "Set as centre" swaps the selected photo
with the centre photo today. Proposed flow (from the developer): select the first photo, click a "Swap"
button/icon, then click the second photo → the two photos change places.

## Scope

**In scope:** swapping the frames of two photos in the editor, as one undo step, saved by the auto-save.
**Out of scope:** to be decided in the grilling.

## Rough Architecture / Concept

Not decided yet (planning phase). Expected: frontend only. The swap logic already exists as a pure function
and can be reused; new is the interaction (a "pick the second photo" mode on the canvas). The backend does
not change (`photos.props` JSON is saved with the full layout).

## Context for a new agent

- **Read first:** `doc/agent-plans/poc-implementation.md` — "Architecture conventions", "Data model"
  (`photos.props`), "Editor behaviour", step 8 Notes (canvas, store, undo), decision log "Centre photo
  selection", "Commands", sandbox notes in "Current state".
- **Existing swap (PoC, "Set as centre" in center mode):** `frontend/src/app/features/editor/swap-frames.ts`
  — `swapFrames(a, b)`: each photo gets the frame of the other (centre `cxMm/cyMm`, size, rotation, z); the
  crop becomes a centred cover crop of the photo's own image for the new frame; the border stays with the
  photo. Used by `EditorStore.setCenterPhoto(id)` in `features/editor/editor.store.ts` (no confirm, one
  undo step via `commit()`, `applyFrames(FrameMap)`).
- **Key files:**
  - `frontend/src/app/features/editor/editor.store.ts` — selection (`EditorSelection`, `select()`),
    `commit()`, `applyFrames`, previews.
  - `frontend/src/app/features/editor/editor.page.{html,ts}` — toolbar ("Set as centre" button with
    tooltip logic, Delete, Add text, Export).
  - `frontend/src/app/features/editor/canvas/collage-renderer.ts` — click handling (`onClick`,
    `onDoubleClick`), crop mode; `canvas/editor-canvas.ts` — canvas inputs/outputs
    (`selectionChange`, ...); `canvas/crop-mode.ts` as an example of a temporary canvas mode (Esc ends it).
  - `frontend/src/app/features/editor/selection.ts` — `EditorSelection`.

## Decision log

(empty — fill during grilling)

## Testing strategy

To be decided (PoC: no automated tests, manual review per step).

## Steps

To be defined after the grilling.

## Open questions (for the grilling)

- Flow: select photo A → "Swap" button → click photo B (proposed). How does the user see that swap mode is
  active (cursor, hint, highlight)? How is it cancelled (Esc, click on empty area, button again)?
- Which photo is selected after the swap (A at its new place, B, none)?
- Crop after the swap: centred cover crop (as "Set as centre") or keep a manual crop if the aspect is the
  same?
- Does z swap with the frame (as today) or does each photo keep its z?
- Center mode: if A or B is the centre photo, does `settings.center.centerPhotoId` change too?
- Also for texts, or photos only? Photos that are not placed (`props = {}`)?
- Should "Set as centre" reuse the same flow/code path?

## Current state / Next action

- Nothing implemented. Next: research + grilling (feature-workflow phase 1/2).
