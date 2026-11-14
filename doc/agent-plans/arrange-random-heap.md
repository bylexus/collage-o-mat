# Arrangement mode "random heap"

**Ticket/Source:** none (rough idea of the developer, 2026-11-14)
**Branch:** none
**Status:** planning

## Goal

A new auto-arrangement mode "Random heap" (in addition to `grid` and `center`): the photos lie on the page
like a heap of printed photos thrown on a table — random positions, random small rotations, overlapping,
with the full image visible (no or little crop). Each re-arrange gives a new heap.

## Scope

**In scope:** new arrangement mode `heap` with its settings, its pure arrangement function and its UI in the
arrangement settings section.
**Out of scope:** to be decided in the grilling. Expected: physics/animation, shadows (photos may already
have a shadow setting — check), backend changes.

## Rough Architecture / Concept

Not decided yet (planning phase). Expected: frontend only, same pattern as the existing modes.

- **Model:** `ArrangementMode` / `ARRANGEMENT_MODES` (`core/models/collage.ts`) get `'heap'`;
  `CollageSettings` gets e.g. `heap: HeapSettings` with a normalizer (`normalizeHeap`) and defaults (old
  collages get the defaults).
- **Settings (to decide):** photo size (percent of the page or of the short page side), max rotation
  (degrees), margin (how far photos may reach outside the content area), maybe overlap / spread strength.
- **Algorithm:** new `features/editor/arrange/heap.ts`, a pure function like `arrangeGrid` /
  `arrangeCenter`, registered in `STRATEGIES` (`arrange/arrange.ts`). Frames keep the image aspect (full
  crop, `fullCrop()` in `geometry/crop.ts`), random centre inside the content area, random rotation within
  ± max, `z` = order. Coverage: a simple "best of N random candidates" (place each photo where it covers the
  least of the already placed photos / empty area) keeps every photo partly visible; to decide.
- **Randomness:** the module stays pure: inject a random function (e.g. `() => number`) or a seed. Related:
  `doc/agent-plans/rearrange-random-order.md` (random order for all modes) — align the random source.
- **UI:** mode select + fields in `features/editor/settings-panel/arrangement-settings-section.*`, limits in
  `settings-limits.ts`, i18n.

## Open questions (for the grilling)

- Settings and ranges: photo size, max rotation, spread/overlap, margin; same size for all photos or random
  size variation?
- Must every photo stay visible to some amount (minimum visible area), or pure random?
- Full image (no crop) or cover crop to a fixed aspect (e.g. "print" 3:2)?
- Can photos stick out over the page edge?
- Seed saved in the settings (reproducible), or not needed (frames are saved)?
- Photo border: use the collage default border (looks like printed photos with a white border)?

## Context for a new agent

- **Read first:** `doc/architecture.md`; `doc/agent-plans/done/poc-implementation.md` (arrangement
  algorithms, `collages.settings` JSON owned by the frontend).
- **Facts from the code (2026-11-14):**
  - `ArrangementMode = 'grid' | 'center'`, `ARRANGEMENT_MODES`, `GridSettings`, `CenterSettings`,
    `CollageSettings.{mode, grid, center}` and `normalize*` functions in `core/models/collage.ts`.
  - `arrangePhotos()` in `features/editor/arrange/arrange.ts`: one strategy per mode in `STRATEGIES`,
    photos sorted by id. Pure modules, no Angular.
  - Helpers: `arrange/frame.ts` (`coverFrame`, `photoAspect`), `arrange/beside-page.ts`,
    `geometry/rect.ts` (`contentRect`), `geometry/crop.ts`, `geometry/numbers.ts`.
  - `PhotoProps` has `rotationDeg` (`core/models/photo.ts`).
  - UI: `features/editor/settings-panel/arrangement-settings-section.{ts,html}`, `settings-limits.ts`.
- **Commands:** `cd frontend && npx ng build`; dev via `make dev-up`, `make frontend-serve`,
  `make backend-run` (see `Makefile`).

## Decision log

(empty — fill during grilling)

## Testing strategy

To be decided (PoC: no automated tests, manual review per step).

## Steps

To be defined after the grilling.
