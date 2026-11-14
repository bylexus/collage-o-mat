# Arrangement mode "masonry"

**Ticket/Source:** none (rough idea of the developer, 2026-11-14)
**Branch:** none
**Status:** done

## Goal

A new auto-arrangement mode "Masonry" (in addition to `grid`, `center` and `heap`). The user selects a
direction (`rows` or `columns`) and optionally the number of lines (rows or columns). Each line is a
justified line: all lines have the same thickness (row height / column width), the photos in a line keep
their relative size by image aspect and together fill the full line length. The algorithm distributes the
photos to the lines (best fit, it may change the order) so that the photos get as little crop as possible.
Unlike the grid, the cells do not all have the same size, so less of each photo is cropped.

## Scope

**In scope:**
- New mode `masonry` (UI label "Masonry") with its settings (`MasonrySettings`), defaults and normalizer.
- Direction `rows` (horizontal lines, top to bottom) and `columns` (vertical lines, left to right).
- Line count fixed by the user or automatic (empty field = least crop).
- Pure arrangement function `arrangeMasonry` (best-fit split, deterministic and random variant).
- Masonry fields in the arrangement settings dialog, mode option in the mode select, snap-grid margin.
- "Random order" checkbox for masonry (random good split, see decision log).
- `README.md` feature line and `doc/architecture.md` mention.

**Out of scope:**
- A photo count per line (one number or a list per line).
- Different thickness per line (all lines have equal thickness).
- Pinterest-style masonry with lines of different length (every line fills the full content side).
- Photos beside the page (masonry places all photos on the page).
- Backend changes (the `settings` JSON is owned by the frontend; the backend stores it as is).
- Automated tests.

## Rough Architecture / Concept

Frontend only, same pattern as the existing modes (`grid`, `center`, `heap`):

- **Model** (`frontend/src/app/core/models/collage.ts`): `ArrangementMode` and `ARRANGEMENT_MODES` get
  `'masonry'`. New `MasonryDirection = 'rows' | 'columns'`, `MASONRY_DIRECTIONS`, `MasonrySettings`,
  `CollageSettings.masonry`, defaults in `defaultCollageSettings()`, `normalizeMasonry()` called from
  `normalizeSettings()` (old collages without `masonry` get the defaults).
- **Algorithm** (`frontend/src/app/features/editor/arrange/masonry.ts`): pure function
  `arrangeMasonry(photos, page, masonry, random)`, registered in `STRATEGIES` in `arrange/arrange.ts`. In
  `RANDOM_ORDER` masonry returns `false`: the strategy reads `masonry.randomOrder` itself, because the
  random variant changes the split algorithm, not only the input order.
- **Lines:** each line is drawn with the existing `justifiedLineFrames(line, photos, gap, zStart)` from
  `arrange/justified-line.ts` (direction `row` for `rows`, `column` for `columns`).
- **UI:** mode option in `settings-panel/arrangement-settings-section.html`, fields in
  `settings-panel/arrangement-settings-dialog.{ts,html}`, data in `editor.page.ts` `openArrangement()`,
  margin entry in `geometry/snap-grid.ts` `MODE_MARGIN_MM`, i18n for all texts.

*Why:* the modes are pure strategy functions behind one `STRATEGIES` table; a new mode is one entry plus
its settings. `justifiedLineFrames` already does the per-line geometry (used by `center`). The split is a
small greedy + local search; no library is needed.

### Algorithm `arrangeMasonry` (decided)

Input: photos in id-ascending order (sorted by `arrangePhotos`; never shuffled there for masonry), page,
`MasonrySettings`, `random: () => number` (values in [0, 1)).

Terms (for direction `rows`; for `columns` swap width/height and use `1 / aspect`):
- `content = contentRect(page, masonry.marginMm)`, `gap = nonNegative(masonry.gapMm)`.
- *Natural length* of a photo = `photoAspect(photo)` for rows, `1 / photoAspect(photo)` for columns
  (same as `naturalLength` in `justified-line.ts`).
- *Line length* `L` = `content.width` (rows) / `content.height` (columns).
- *Line side* `S` = `content.height` (rows) / `content.width` (columns).
- For `k` lines: *thickness* `t = (S − (k − 1)·gap) / k` (equal for all lines).
- For a line with `m` photos and natural-length sum `a`: *stretch* `s = (L − (m − 1)·gap) / (t · a)`.
  `s = 1` means no crop. Every photo of that line gets the frame aspect `s × image aspect` (cover crop).
- *Crop cost* of a line = `m × (1 − min(s, 1/s))` (sum of cropped area fractions of its photos).
  *Crop cost* of a split = sum over the lines. A line with `t ≤ 0` or available length `≤ 0` has cost
  `Infinity`. One cost function is used for the local search and for the auto count (DRY).

Steps:
1. Empty photo list → empty map.
2. **Line count `k`:** `optionalCount(masonry.count, 1)` (fixed). Fixed `k` is used as is (also if
   `k > n`). `null` = auto: for each `k` in `1..min(n, SETTINGS-max 20)` run the split (step 3) and take the
   `k` with the smallest crop cost; ties → the smaller `k`. The max 20 is a module constant
   `MAX_AUTO_LINES = 20` in `masonry.ts` (same value as `SETTINGS_LIMITS.gridCount.max`).
3. **Split** `n` photos into `k` lines:
   - `n < k`: line `i` (for `i < n`) gets photo `i`; lines `n..k−1` stay empty (keep their place and
     thickness; empty space at the end of the page).
   - `n ≥ k`, every line gets at least one photo:
     - **Random order off (deterministic):** sort the photos by natural length descending (ties: id
       ascending). First the `k` largest photos one per line; then each next photo to the line with the
       smallest *fill* `t · a + m · gap` (ties: lower line index).
     - **Random order on:** shuffle the photos (Fisher–Yates with `random`), first `k` photos one per line,
       then each next photo to the line with the smallest fill (same rule).
     - **Local search (both variants):** repeat passes until no pass improves the crop cost (max
       `MAX_SEARCH_PASSES = 50`): for every photo try to move it to every other line (only if its line keeps
       ≥ 1 photo), and for every pair of photos in different lines try to swap them; apply a change at once
       when it lowers the total crop cost (first improvement).
4. **Order:**
   - Random order off: photos in a line by id ascending; lines ordered by the smallest photo id in the
     line (empty lines last).
   - Random order on: photos in a line shuffled; line order shuffled (empty lines last).
5. **Frames:** line `i` gets the rect at offset `i · (t + gap)` across the lines (rows: `y = content.y +
   i·(t + gap)`, height `t`, width `L`; columns: `x = content.x + i·(t + gap)`, width `t`, height `L`).
   `justifiedLineFrames(line, linePhotos, gap, zStart)`, `zStart` counts on over the lines (z in output
   order).
6. All photos are on the page; masonry never places photos beside the page.

## Context for a new agent

- **Sources read:** the developer's rough idea (goal above), `AGENTS.md` (no commits unasked; verify with
  `npx ng build`; UI texts English with `i18n` / `$localize`; no new libraries; plans in
  `doc/agent-plans/`, moved to `done/` when finished), `doc/architecture.md` (frontend owns geometry;
  `collages.settings` JSON owned by the frontend), `doc/agent-plans/done/arrange-random-heap.md` and
  `doc/agent-plans/done/rearrange-random-order.md` (pattern for a new mode and for random order). No
  external sources.
- **Key files and directories (state 2026-11-14):**
  - `frontend/src/app/core/models/collage.ts` — `ArrangementMode = 'grid' | 'center' | 'heap'`,
    `ARRANGEMENT_MODES`, `GridSettings`, `CenterSettings`, `HeapSettings` (+ `HEAP_ASPECTS` as pattern for a
    const list), `CollageSettings`, `defaultCollageSettings()`, `normalizeSettings()` with `normalizeGrid`
    / `normalizeHeap` and helpers `asRecord`, `numberOr`, `nullableNumberOr`, `booleanOr`, `oneOf`.
  - `frontend/src/app/features/editor/arrange/arrange.ts` — `arrangePhotos(photos, settings, random)`,
    `STRATEGIES`, `RANDOM_ORDER`, private `shuffle` (Fisher–Yates; masonry needs its own copy or an
    exported helper — export `shuffle` from a small shared module only if it avoids duplication).
  - `frontend/src/app/features/editor/arrange/justified-line.ts` — `justifiedLineFrames`, `Line`,
    `LineDirection = 'row' | 'column'`.
  - `frontend/src/app/features/editor/arrange/grid.ts` — pattern (`contentRect`, `nonNegative`,
    `optionalCount`, empty list handling).
  - `frontend/src/app/features/editor/arrange/frame.ts` — `photoAspect`, `coverFrame`.
  - `frontend/src/app/features/editor/geometry/numbers.ts` — `nonNegative`, `optionalCount`, `sum`,
    `isPositiveFinite`; `geometry/rect.ts` — `Rect`, `contentRect`.
  - `frontend/src/app/features/editor/geometry/snap-grid.ts` — `MODE_MARGIN_MM` record per mode (add
    `masonry: (settings) => settings.masonry.marginMm`).
  - `frontend/src/app/features/editor/settings-panel/arrangement-settings-dialog.ts` —
    `ArrangementSettings = Pick<CollageSettings, 'mode' | 'grid' | 'center' | 'heap'>` (add `'masonry'`),
    form group per mode, `submit()` keeps the other modes' input values.
  - `frontend/src/app/features/editor/settings-panel/arrangement-settings-dialog.html` — `@switch (mode)`
    for title and fields; `app-number-field` for numbers, `mat-checkbox` with
    `i18n="@@editor.settings.randomOrder"`, `mat-select` for the heap aspect (pattern for direction).
  - `frontend/src/app/features/editor/settings-panel/arrangement-settings-section.html` — mode
    `mat-select` (add `<mat-option value="masonry" i18n="@@editor.settings.modeMasonry">Masonry</mat-option>`).
  - `frontend/src/app/features/editor/settings-panel/settings-limits.ts` — `SETTINGS_LIMITS.gridCount`
    (1..20, integer) is reused for the line count; `gapMm`, `marginMm`.
  - `frontend/src/app/features/editor/editor.page.ts` — `openArrangement(mode)` passes the per-mode
    settings to the dialog (add `masonry: settings.masonry`).
- **Existing patterns to follow:** `arrange/heap.ts` + `normalizeHeap` (mode with own settings and
  `random`), grid fields `rows`/`cols` in the dialog (empty = auto via `autoCountControl` and
  `limitValidators(..., { optional: true })`).
- **Commands:** `cd frontend && npx ng build` (verification); dev: `make dev-up && make dev-shell`, then in
  the container `make backend-run` and `make frontend-serve` (http://localhost:4200).
- **Domain terms:** *content area* = page minus margin (`contentRect`); *frame* = photo rectangle on the
  page (`PhotoProps`); *cover crop* = centred crop that fills the frame; *line* = one row (direction
  `rows`) or one column (direction `columns`); *re-arrange* = run the strategy of the current mode for all
  photos; *re-roll* = refresh button "Re-arrange again with the same settings".

## Decision log

- **Count settings:** direction `rows` | `columns` plus one line count; no photo count per line.
  *Rejected:* rows only; rows + one per-row count; a per-row list (UI complexity, edge cases).
- **Empty line count:** auto = the count with the least crop (try `1..min(n, 20)`), ties → fewer lines.
  *Rejected:* grid formula `sqrt(n × aspect)` (ignores photo aspects); required field without auto.
- **Distribution:** best fit, the algorithm may change the photo order. *Rejected:* keep the order with an
  optimal linear partition.
- **Random order:** checkbox "Random order" also for masonry. Off = deterministic best fit; on = shuffled
  greedy + same local search, photos in lines and line order shuffled, so each re-roll gives a different,
  still balanced layout. *Rejected:* shuffle only inside lines (little variety); no random order (re-roll
  gives the same layout).
- **Line thickness:** equal for all lines (more regular look; crop comes from lines with a different aspect
  sum). *Rejected:* thickness per line by natural size (less crop, the developer prefers equal lines).
- **Fixed count > photo count:** lines keep their count and thickness; the first `n` lines get one photo
  each, the rest stay empty. *Rejected:* reduce the line count to the photo count.
- **Name:** mode id `masonry`, UI label "Masonry"; direction labels "Rows" / "Columns".
  *Rejected:* "Justified lines", "Flow".
- **Defaults:** direction `rows`, count `null` (auto), gap 5 mm, margin 10 mm, random order off (same gap /
  margin defaults as grid and center).
- **Limits:** line count `SETTINGS_LIMITS.gridCount` (1..20, integer, optional); gap and margin with the
  shared `gapMm` / `marginMm` limits.
- **`RANDOM_ORDER` in `arrange.ts`:** masonry → `false`; `arrangeMasonry` gets `random` and reads
  `masonry.randomOrder` itself (the random variant changes the split, not only the input order).
- **Crop cost:** one cost function (sum of cropped area fractions) for the local search and the auto count.
- **Crop cost shape (step 1 review):** keep the linear cost `m × (1 − min(s, 1/s))`. A test run showed
  one 4:3 photo alone in a 277 × 60 mm row (≈ 71 % crop); the developer tested and approved the result.
  *Rejected for now:* squared crop per photo (penalizes single outliers more) — option if outliers
  become a problem.
- **Testing:** no automated tests (`AGENTS.md`); `npx ng build` + manual review per step.
- **Shuffle sharing (step 2):** `shuffle` in its own module `arrange/shuffle.ts`, used by `arrange.ts`
  and `masonry.ts`. *Rejected:* a copy in `masonry.ts`; export from `arrange.ts` (circular import, as
  `arrange.ts` imports `masonry.ts`).

## Testing strategy

No automated tests, manual review only. Per step: `cd frontend && npx ng build` must pass, then the
developer follows the manual test instructions of the step.

## Steps

### Step 1 — Mode, settings and deterministic algorithm
- **Status:** done (reviewed 2026-11-14)
- **What:**
  - `collage.ts`: `'masonry'` in `ArrangementMode` / `ARRANGEMENT_MODES`; `MasonryDirection`,
    `MASONRY_DIRECTIONS`, `MasonrySettings { direction; count: number | null; gapMm; marginMm;
    randomOrder: boolean }`, `CollageSettings.masonry`, defaults, `normalizeMasonry`; update the doc
    comment of `defaultCollageSettings()`.
  - `arrange/masonry.ts`: `arrangeMasonry` with all algorithm steps above, **only the deterministic split**
    (random order off); `randomOrder` is read but has no effect yet.
  - `arrange.ts`: `STRATEGIES.masonry`, `RANDOM_ORDER.masonry = () => false`, doc comment of
    `arrangePhotos` lists `masonry`.
  - `snap-grid.ts`: `MODE_MARGIN_MM.masonry`.
  - UI: mode option "Masonry"; dialog title "Re-arrange: Masonry"; fields direction (select Rows /
    Columns), count (empty = auto; label changes with the direction: "Rows" / "Columns"), gap, margin;
    `ArrangementSettings` + `submit()` + `editor.page.ts` `openArrangement()` include `masonry`. No random
    order checkbox yet.
- **Acceptance criteria:**
  - `npx ng build` passes.
  - Select mode "Masonry": dialog opens with direction Rows, empty count, gap 5, margin 10.
  - Rows, auto count: photos fill the content area in rows of equal height, each row fills the full
    width, little crop; a different photo set gives a sensible row count.
  - Fixed count 3 → exactly 3 rows. Columns direction → vertical columns of equal width, each fills the
    full height.
  - Fixed count larger than the photo count → one photo per line, last lines empty.
  - Settings persist after reload; an old collage opens without error (masonry defaults).
  - Snap grid starts at the masonry margin.
- **Notes:** Implemented as planned; `npx ng build` passes without warnings; developer review OK.
  - New `frontend/src/app/features/editor/arrange/masonry.ts`: `arrangeMasonry(photos, page, masonry,
    random)` with `greedySplit`, `improveSplit` (moves + swaps, first improvement), `lineCost`,
    `bestAutoSplit`, `orderedLines`, `lineRect`. `random` is in the signature but not used yet (no ESLint /
    `noUnusedParameters` in the project). Step 2 changes `greedySplit` input order and `orderedLines`.
  - `naturalLength` is a copy of the private function in `justified-line.ts` (that file is unchanged).
  - Local search applies a change only if the cost drops by more than `MIN_IMPROVEMENT = 1e-9` (no loops
    from rounding).
  - `n < k`: `splitLines` returns only the `n` one-photo lines (no empty arrays); thickness still uses `k`.
  - Dialog: direction select reuses the i18n ids `@@editor.settings.rows` / `@@editor.settings.cols` for
    "Rows" / "Columns"; new ids `@@editor.settings.modeMasonry`, `@@editor.arrangementDialog.titleMasonry`,
    `@@editor.settings.masonry.direction`. Count label follows the direction via
    `toSignal(direction.valueChanges)` (two `app-number-field` variants). No hint text under the count.
    `submit()` keeps the input `randomOrder` (no checkbox yet).
  - No i18n message files (`.xlf`) exist in the repo.

### Step 2 — Random good split
- **Status:** done (2026-11-14)
- **What:** "Random order" checkbox for masonry in the dialog (`i18n="@@editor.settings.randomOrder"`);
  random variant of the split (shuffled greedy + local search, shuffled order in lines and of lines) with
  the injected `random`.
- **Acceptance criteria:** `npx ng build` passes. Random order on: each re-roll (refresh button) gives a
  different layout with still little crop. Off: re-roll gives the same layout.
- **Notes:** Implemented as planned; `npx ng build` passes without warnings.
  - `shuffle` moved from `arrange.ts` (private) to the new module `arrange/shuffle.ts` (exported);
    `arrange.ts` and `masonry.ts` import it (no copy).
  - `masonry.ts`: `orderRandom = masonry.randomOrder ? random : null` (type `OrderRandom`) is passed to
    `bestAutoSplit`, `splitLines`, `greedySplit` (shuffled indices instead of the sort) and
    `orderedLines` (shuffle in each line, then the line order). Off: same code path as step 1.
  - Dialog: `mat-checkbox` "Random order" (`@@editor.settings.randomOrder`) after gap / margin; the
    masonry form group already had `randomOrder`, `submit()` returns it unchanged.
  - Doc comments of `arrangeMasonry`, `RANDOM_ORDER` and `arrangePhotos` updated.

### Step 3 — Documentation and close
- **Status:** done (2026-11-14)
- **What:** `README.md` feature line (add "masonry"), `doc/architecture.md` (arrange table row and the
  glossary line "Arrangement / mode"), set **Status:** done, move this file to `doc/agent-plans/done/`.
- **Acceptance criteria:** docs mention the mode; plan file is in `done/`.
- **Notes:** `README.md` feature line, `doc/architecture.md` arrange table row and glossary line
  "Arrangement / mode" (`masonry` = justified rows or columns). `architecture.md` has no other mode list
  and no settings JSON description (it refers to the TypeScript models), so nothing else changed. Plan
  moved to `doc/agent-plans/done/` with plain `mv` (no git).

## Open questions

(none)

## Current state / Next action

All steps done (2026-11-14); changes uncommitted on `main`. No temporary changes. Next action: developer
review of steps 2 and 3 (manual test of random order on/off), then commit.
