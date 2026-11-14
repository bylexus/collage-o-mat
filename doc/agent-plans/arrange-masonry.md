# Arrangement mode "masonry"

**Ticket/Source:** none (rough idea of the developer, 2026-11-14)
**Branch:** none
**Status:** planning

## Goal

A new auto-arrangement mode "Masonry" (in addition to `grid` and `center`): the user sets only the number
of rows (maybe also the number of photos per row). Each row is a justified line: the photos keep (nearly)
their own aspect ratio, all photos in a row have the same height, and each row fills the full content
width. Unlike the grid, the cells are not all the same size, so less of each photo is cropped.

## Scope

**In scope:** new arrangement mode `masonry` with its settings (row count, optional photos per row), its
pure arrangement function and its UI.
**Out of scope:** to be decided in the grilling. Expected: column-based masonry (Pinterest style, variable
column heights) — maybe as a direction option, backend changes.

## Rough Architecture / Concept

Not decided yet (planning phase). Expected: frontend only, same pattern as the existing modes.

- **Model:** `ArrangementMode` / `ARRANGEMENT_MODES` (`core/models/collage.ts`) get `'masonry'`;
  `CollageSettings` gets e.g. `masonry: { rows: number | null; perRow: number[] | number | null; gapMm;
  marginMm }` with a normalizer and defaults.
- **Algorithm:** new `features/editor/arrange/masonry.ts`, registered in `STRATEGIES`
  (`arrange/arrange.ts`):
  1. Split the photos (in arrangement order) into `rows` rows. Without a per-row count: balanced split
     (e.g. linear partition by the sum of aspect ratios, so all rows get a similar natural height).
  2. Row heights: the content height minus gaps is split between rows in proportion to their natural
     height (row height that fills the width = width / sum of aspects); if the heights do not fit, scale
     and cover-crop a little.
  3. Each row: `justifiedLineFrames()` from `arrange/justified-line.ts` (already used by the center mode)
     gives cover frames that fill the row.
- **Auto rows:** `rows = null` → computed from the photo count and page aspect (like the grid auto
  dimensions in `arrange/grid.ts`).
- **UI:** mode select + fields in `features/editor/settings-panel/arrangement-settings-section.*`, limits in
  `settings-limits.ts`, i18n.

## Open questions (for the grilling)

- Settings: only row count, or also photos per row (one number for all rows, or a list per row)?
- Auto row count when not set?
- Distribution of photos to rows: in order (balanced by aspect sum) or best fit (may change order)?
- Row heights: equal for all rows (more crop) or different per row (less crop)?
- Rows only, or also a column direction ("vertical masonry") as an option?
- Name in the UI: "Masonry", "Rows", "Justified rows"?

## Context for a new agent

- **Read first:** `doc/architecture.md`; `doc/agent-plans/done/poc-implementation.md` (arrangement
  algorithms, `collages.settings` JSON owned by the frontend).
- **Facts from the code (2026-11-14):**
  - `ArrangementMode = 'grid' | 'center'`, `ARRANGEMENT_MODES`, `GridSettings` (`rows`, `cols` nullable =
    auto, `gapMm`, `marginMm`), `CenterSettings`, `normalize*` in `core/models/collage.ts`.
  - `arrangePhotos()` in `features/editor/arrange/arrange.ts`: one strategy per mode in `STRATEGIES`,
    photos sorted by id. Pure modules, no Angular.
  - `justifiedLineFrames(line, photos, gap, zStart)` in `arrange/justified-line.ts`: cover frames for one
    justified row/column (side along the line ∝ image aspect, fills the line).
  - Grid auto dimensions and helpers: `arrange/grid.ts`; `arrange/frame.ts`; `arrange/beside-page.ts`;
    `geometry/rect.ts` (`contentRect`), `geometry/numbers.ts`.
  - UI: `features/editor/settings-panel/arrangement-settings-section.{ts,html}`, `settings-limits.ts`.
- **Commands:** `cd frontend && npx ng build`; dev via `make dev-up`, `make frontend-serve`,
  `make backend-run` (see `Makefile`).

## Decision log

(empty — fill during grilling)

## Testing strategy

To be decided (PoC: no automated tests, manual review per step).

## Steps

To be defined after the grilling.
