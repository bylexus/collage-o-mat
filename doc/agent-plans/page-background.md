# Page background types

**Ticket/Source:** Backlog of `doc/agent-plans/poc-implementation.md` (requested by the developer 2026-11-13)
**Branch:** none
**Status:** planning

## Goal

The page background is more than a solid colour: the user chooses between
- solid colour (as today),
- gradient with 2 colours,
- image: an image is used as the background and can be dimmed with an overlay of a solid colour with
  transparency.

## Scope

**In scope:** the three background types in the editor and in the export.
**Out of scope:** to be decided in the grilling.

## Rough Architecture / Concept

Not decided yet (planning phase). Expected: the background is part of `collages.settings` JSON (frontend
owns the structure; `normalizeSettings` migrates the existing `backgroundColor`); rendering in the shared
Konva views so editor and export (`page-image-renderer.ts`) stay identical. The image source decides
whether the backend changes.

## Context for a new agent

- **Read first:** `doc/agent-plans/poc-implementation.md` — "Architecture conventions", "Data model"
  (`collages.settings`: `backgroundColor`), "Editor behaviour", step 6 + 8 + 10 Notes (canvas, live colour
  preview, export), "Commands", sandbox notes in "Current state".
- **Today:** `settings.backgroundColor` (hex string) is drawn as the page rect fill.
- **Key files:**
  - `frontend/src/app/core/models/collage.ts` — `CollageSettings`, `defaultCollageSettings`,
    `normalizeSettings` (merges missing fields with defaults for older collages).
  - `frontend/src/app/features/editor/canvas/collage-renderer.ts` — `pageRect` fill;
    `canvas/page-image-renderer.ts` — export draws its own page background rect; `canvas/scene.ts` (`Scene`).
  - `frontend/src/app/features/editor/settings-panel/appearance-settings-section.ts` — background colour
    field with live preview (`backgroundColorPreview` → `CollageSettingsPanel.settingsPreview` →
    `EditorStore.previewSettings` / `displayedSettings`).
  - Photo storage/import (if the background image is a stored photo): `backend/internal/photo/`,
    `frontend/src/app/features/editor/import/`, `core/models/photo.ts` (`photoFileUrl`).

## Decision log

(empty — fill during grilling)

## Testing strategy

To be decided (PoC: no automated tests, manual review per step).

## Steps

To be defined after the grilling.

## Open questions (for the grilling)

- Gradient: linear only or also radial? Direction (angle, presets)? Exactly 2 colours?
- Image source: import from Immich (like photos), one of the collage photos, or a local upload (see
  `local-upload-connector.md`)? Is the background image a `photos` row (excluded from arrangement) or a
  separate reference in `settings`?
- Image fit: cover (crop), contain, stretch, tile? Position/crop adjustable?
- Dimming: overlay colour + opacity (0–100 %)? Also blur?
- Export: same rendering (no difference editor vs. export); resolution limits of the ~1440 px previews.
- Live preview for all new fields (as for the colours today)?

## Current state / Next action

- Nothing implemented. Next: research + grilling (feature-workflow phase 1/2).
