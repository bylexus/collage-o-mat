# Re-arrange in random order

**Ticket/Source:** none (rough idea of the developer, 2026-11-14)
**Branch:** none
**Status:** planning

## Goal

Today "Re-arrange" always places the photos in the same order (import order = photo id ascending), so the
result is always the same. The user can choose on re-arrange: arrange in import order (as today) or in a
random order. A random re-arrange gives a new layout each time it is clicked.

## Scope

**In scope:** a choice between "import order" and "random order" when the user re-arranges.
**Out of scope:** to be decided in the grilling. Expected: other sort orders (date taken, file name, aspect
ratio), manual ordering of a photo list, backend changes.

## Rough Architecture / Concept

Not decided yet (planning phase). Expected: frontend only.

- `arrangePhotos()` (`features/editor/arrange/arrange.ts`) sorts the photos by id (`sortedById`) before it
  calls the strategy. A random order can be a shuffled copy instead (e.g. Fisher–Yates), selected by a
  parameter (or an injectable random function to keep the module pure).
- The UI choice: options to decide in the grilling, e.g. a second button "Shuffle" next to "Re-arrange",
  a split/menu button, or an order setting in the arrangement section (saved in `settings` or UI-only).

## Open questions (for the grilling)

- UI: second button, menu on the button, or a persistent setting (saved in `collages.settings`)?
- Does the choice also apply to the automatic arrangement after an import (`addPhotos` →
  `arrangeAll`), or only to the "Re-arrange" button?
- Center mode: does the centre photo (`settings.center.centerPhotoId`, "Set as centre") stay fixed and only
  the other photos are shuffled? (Expected: yes.)
- Grid mode: shuffle all photos, or keep some order rule?
- Is the random seed saved (to reproduce a layout), or not needed (the result is saved as frames anyway)?
- Confirm dialog: same rule as today (`confirmRearrange` asks if the layout may contain manual work)? Several
  shuffles in a row must not ask each time (today `layoutIsArrangement` is true after an arrangement).

## Context for a new agent

- **Read first:** `doc/architecture.md`; `doc/agent-plans/done/poc-implementation.md` (arrangement
  algorithms, `collages.settings` JSON owned by the frontend).
- **Facts from the code (2026-11-14):**
  - `arrangePhotos(photos, settings)` in `features/editor/arrange/arrange.ts`: picks the strategy by
    `settings.mode` (`grid`, `center`) and passes the photos sorted by id (`sortedById`). Pure functions, no
    Angular.
  - `EditorStore` (`features/editor/editor.store.ts`): `rearrange()` (confirm, then `arrangeAll()`),
    `addPhotos` (after import, arranges all or places new photos beside the page), private `arrangeAll()`
    calls `arrangePhotos(this.photosSignal(), settings)` and sets `layoutIsArrangement = true`.
  - Center mode: `arrangeCenter` / `resolveCentrePhotoId` in `arrange/center.ts` — centre photo is
    `centerPhotoId` if present, else the first photo.
  - UI: "Re-arrange" button (`rearrange.emit()`) in
    `features/editor/settings-panel/arrangement-settings-section.html`, passed through
    `collage-settings-panel.html` to `editor.page.html` (`(rearrange)="store.rearrange()"`).
- **Commands:** `cd frontend && npx ng build`; dev via `make dev-up`, `make frontend-serve`,
  `make backend-run` (see `Makefile`).

## Decision log

(empty — fill during grilling)

## Testing strategy

To be decided (PoC: no automated tests, manual review per step).

## Steps

To be defined after the grilling.
