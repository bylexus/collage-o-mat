# Display units (mm / px)

**Ticket/Source:** none (rough idea of the developer, 2026-11-13)
**Branch:** none
**Status:** planning

## Goal

The user can toggle the unit of all lengths shown and entered in the editor between millimetres and pixels.
The toggle changes every displayed and editable length (fields, labels, hints), so the user can work in the
unit that fits the output (print in mm, screen/export in px).

## Scope

**In scope:** a unit toggle (mm / px) that changes all used and displayed length units in the UI.
**Out of scope:** to be decided in the grilling. Expected: the stored data stays in mm (no data model or
backend change); only display and input convert.

## Rough Architecture / Concept

Not decided yet (planning phase). Expected: frontend only. Internal world unit stays mm everywhere
(`collages.settings`, `photos.props`, texts, canvas). A small pure conversion module (mm ↔ px with a DPI)
plus a unit-aware number field / formatting used at the UI edges only.

## Context for a new agent

- **Read first:** `doc/agent-plans/done/poc-implementation.md` — "Architecture conventions", "Data model"
  (`collages.settings` JSON owned by the frontend; `photos.props` in mm), "Commands", sandbox notes.
- **Facts from the code (2026-11-13):**
  - All lengths are mm: page size (`settings.page.widthMm/heightMm`), border width, arrangement gap/margin,
    photo frame (`cxMm, cyMm, widthMm, heightMm`), text box width, outline width, shadow blur/offset, snap
    grid size (`settings.snapGrid.sizeMm`, see `doc/agent-plans/move-grid.md`).
  - Text font size is in pt (`ptToMm` in `frontend/src/app/core/models/text.ts`).
  - The collage has a print DPI: `settings.page.dpi` (default 300). The export dialog
    (`features/editor/export/export-dialog.ts`) already shows the pixel size for a chosen DPI
    (`exportPixelSize` in `export/page-export.ts`).
- **Key files (all under `frontend/src/app/`):**
  - `core/models/collage.ts` — settings model, `pageLabel()` / `formatMm()` (displayed page size).
  - `features/editor/fields/number-field.ts` — `app-number-field`, used for most numeric inputs.
  - `features/editor/settings-panel/` — page, appearance, arrangement sections; `settings-limits.ts` (limits
    in mm).
  - `features/editor/photo-panel/`, `features/editor/text-panel/` — element properties in mm.
  - `features/editor/snap-grid/snap-grid-popover.ts` — snap grid size (mm).
  - `features/collages/collage-create-dialog.*` — custom page size input.
  - `features/editor/editor.page.html` — toolbar (place for a toggle; buttons are icon-only with tooltip).
- **Commands:** `cd frontend && npm run build`; dev via `make dev-up`, `make frontend-serve`,
  `make backend-run` (see `Makefile`).

## Decision log

(empty — fill during grilling)

## Testing strategy

To be decided (PoC: no automated tests, manual review per step).

## Steps

To be defined after the grilling.

## Open questions (for the grilling)

- Which DPI converts mm ↔ px: the collage print DPI (`settings.page.dpi`), screen px (96 DPI, CSS px), or the
  export DPI? What happens to px values when the DPI changes?
- Stored per collage (`settings`), per user / browser (localStorage), or session only? Default unit?
- Where is the toggle (toolbar button, settings panel, user menu)? Keyboard shortcut?
- Which values convert: all lengths, also the page size in the create dialog, the page label in the
  subtitle and collage list, the export dialog? Font size stays in pt?
- Limits and steps in px (e.g. `marginMm` max 100 mm → px depends on DPI); rounding (integer px?) and
  round-trip precision mm → px → mm.
- Relation to unit labels in i18n strings (e.g. "Margin (mm)").

## Current state / Next action

- Nothing implemented. Next: research + grilling (feature-workflow phase 1/2).
