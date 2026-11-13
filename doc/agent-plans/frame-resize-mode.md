# Frame resize mode

**Ticket/Source:** Backlog of `doc/agent-plans/poc-implementation.md` (requested by the developer 2026-11-13)
**Branch:** none
**Status:** planning

## Goal

The user can switch how the resize handles of a selected photo work: "resize keeping the aspect" or
"free resize of the frame without keeping the aspect".

## Scope

**In scope:** a mode switch for photo resizing in the editor.
**Out of scope:** to be decided in the grilling (e.g. texts, multi-select).

## Rough Architecture / Concept

Not decided yet (planning phase). Expected: frontend only (Konva transformer + pure geometry); the backend
stores `photos.props` as JSON and does not change.

## Context for a new agent

- **Read first:** `doc/agent-plans/poc-implementation.md` — sections "Architecture conventions",
  "Data model" (`photos.props`: `cxMm, cyMm, widthMm, heightMm, rotationDeg, z, crop, border`), "Editor
  behaviour", step 8 Notes (canvas architecture), "Commands", and the sandbox notes in "Current state".
- **Behaviour today (PoC step 8):** corner handles keep the frame aspect (crop scales with the frame); edge
  (middle) handles change the frame aspect and the crop is recomputed as a cover crop around the current
  crop centre, so the frame is always filled (the image is never distorted).
- **Key files:**
  - `frontend/src/app/features/editor/canvas/photo-transformer.ts` — Konva transformer of photos
    (`EDGE_ANCHORS`, `keepAspect` per handle), base class `selection-transformer.ts`.
  - `frontend/src/app/features/editor/geometry/transform.ts` — `applyFrameBox(props, box, image, keepAspect)`
    (pure), `geometry/crop.ts` (`coverCrop`), `geometry/frame-size.ts`.
  - `frontend/src/app/features/editor/canvas/collage-renderer.ts` — facade; `previewFrame` / `commitFrame`.
  - `frontend/src/app/features/editor/editor.page.html` — editor toolbar (place for a switch).
  - `frontend/src/app/core/models/collage.ts` — `CollageSettings` + `normalizeSettings` (if the mode is
    stored per collage).

## Decision log

(empty — fill during grilling)

## Testing strategy

To be decided (PoC: no automated tests, manual review per step).

## Steps

To be defined after the grilling.

## Open questions (for the grilling)

- Where is the switch (toolbar toggle, photo panel, modifier key like Shift while dragging)?
- Is the mode stored (per collage in `settings`, per user, or only in memory for the session)?
- "Free resize": does the image keep filling the frame with a cover crop (as edge handles today), or may
  the image be stretched/distorted, or may empty area appear (fit/contain)?
- In "keep aspect" mode: do edge handles also keep the aspect, or are they hidden?
- Does the mode also apply to texts (today: texts only change their box width)?

## Current state / Next action

- Nothing implemented. Next: research + grilling (feature-workflow phase 1/2).
