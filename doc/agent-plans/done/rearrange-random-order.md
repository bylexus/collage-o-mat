# Re-arrange in random order

**Ticket/Source:** none (idea of the developer, 2026-11-14)
**Branch:** none (work on `main`)
**Status:** done

## Goal

Today every arrangement places the photos in the same order (import order = photo id ascending), so the
result of the `grid` and `center` modes is always the same. A new per-mode checkbox "Random order" in the
arrangement settings dialog makes the arrangement shuffle the photos. With it on, each re-arrange (also the
quick re-roll button) gives a new layout.

## Scope

**In scope:**
- Checkbox "Random order" in the arrangement settings dialog for the modes `grid` and `center`.
- Persistent per-mode setting in `collages.settings` (`grid.randomOrder`, `center.randomOrder`).
- Shuffled photo order in `arrangePhotos()` when the setting of the active mode is on.

**Out of scope:**
- The `heap` mode (random anyway; no checkbox, no setting).
- Other sort orders (date taken, file name, aspect ratio), manual ordering of a photo list.
- A random centre photo in `center` mode (the centre photo stays fixed, see decision log).
- Saving a random seed (the result is saved as frames anyway).
- Backend changes (the backend only stores the settings JSON).

## Rough Architecture / Concept

Frontend only.

- `frontend/src/app/core/models/collage.ts`: new field `randomOrder: boolean` in `GridSettings` and
  `CenterSettings`; default `false` in `defaultCollageSettings()`; `normalizeGrid` / `normalizeCenter` read
  it with `booleanOr`, so collages saved before get `false`.
- `frontend/src/app/features/editor/arrange/arrange.ts`: `arrangePhotos(photos, settings, random)` sorts the
  photos by id (as today). If the active mode has `randomOrder === true`, it shuffles that sorted copy with
  Fisher–Yates using the injected `random` (default `Math.random`). Which mode reads which flag is a small
  per-mode lookup beside `STRATEGIES` (`heap` → never shuffles). The mode algorithms (`grid.ts`,
  `center.ts`, `heap.ts`) do not change.
- `center` mode: `arrangeCenter` picks the centre photo with `resolveCentrePhotoId()` (explicit
  `centerPhotoId`, else the smallest photo id), not by list position. So the centre photo stays fixed and
  only the lane photos are shuffled — no change in `center.ts` needed.
- `frontend/src/app/features/editor/settings-panel/arrangement-settings-dialog.ts/.html`: a `mat-checkbox`
  bound to `form.controls.grid.controls.randomOrder` / `form.controls.center.controls.randomOrder` in the
  `grid` and `center` cases. The value goes into the dialog result through the existing `getRawValue()` in
  `submit()`.

*Why:* the setting is per mode (the developer wants it in the per-mode dialog), all arrangement paths go
through `arrangePhotos()`, so one place handles the order for the dialog, the re-roll button and the
arrangement after an import. The random source is already injected there (used by `heap`), so the module
stays pure.

## Context for a new agent

- **Sources read:** `AGENTS.md` (rules: no commits unasked; verify with `npx ng build`; UI texts English
  with `i18n`/`$localize`; no new libraries), `doc/architecture.md` (pure arrange functions in
  `features/editor/arrange/`, `collages.settings` JSON owned by the frontend),
  `doc/agent-plans/done/arrangement-settings-dialog.md` (dialog with per-mode parameters, opens on
  "Re-arrange…" and on mode change; quick re-roll button re-arranges with the saved settings).
- **Key files and directories:**
  - `frontend/src/app/core/models/collage.ts` — `GridSettings`, `CenterSettings`, `defaultCollageSettings()`,
    `normalizeGrid`, `normalizeCenter`, `booleanOr`.
  - `frontend/src/app/features/editor/arrange/arrange.ts` — `arrangePhotos()`, `STRATEGIES`, `sortedById()`.
  - `frontend/src/app/features/editor/arrange/center.ts` — `arrangeCenter`, `resolveCentrePhotoId` (centre
    rule: explicit id if present, else smallest id), `pickCentrePhoto`.
  - `frontend/src/app/features/editor/settings-panel/arrangement-settings-dialog.ts/.html` — dialog form
    (`form.controls.grid`, `form.controls.center`), `submit()`.
  - `frontend/src/app/features/editor/editor.store.ts` — `rearrange()`, `rearrangeWith()`, `applyImport()`,
    private `arrangeAll()` → `arrangePhotos(this.photosSignal(), this.requireSettings())`.
  - `frontend/src/app/features/editor/editor.page.ts` — `openArrangement(mode)`; `centrePhotoId` computed
    with `resolveCentrePhotoId` for the "Set as centre" button.
- **Existing patterns to follow:** checkbox with reactive forms: `features/editor/photo-panel/photo-properties-panel.html`
  (`mat-checkbox`, `MatCheckboxModule`); boolean normalization: `normalizeSnapGrid` in `collage.ts`.
- **Commands:** `cd frontend && npx ng build`; dev: `make dev-up && make dev-shell`, then in the container
  `make backend-run` and `make frontend-serve` (http://localhost:4200).
- **Environment / prerequisites:** a collage with several photos (local upload or Immich).
- **Domain terms:** *arrangement / mode* = algorithm that sets all frames (`grid`, `center`, `heap` =
  random heap); *re-roll* = refresh icon button beside "Re-arrange…" that re-arranges with the saved
  settings; *centre photo* = large photo of the `center` mode.
- **External references:** none.

## Decision log

- **Where is the choice made:** a persistent checkbox "Random order" in the arrangement settings dialog,
  only for `grid` and `center`. — *Rationale:* developer request; `heap` is random anyway. Rejected: a
  separate "Shuffle" button or a menu on the Re-arrange button.
- **Data model:** per mode, `grid.randomOrder` and `center.randomOrder` (boolean, default `false`),
  normalized with `booleanOr`. — *Rationale:* the dialog is per mode; old collages keep today's behaviour.
- **Centre photo in `center` mode:** always fixed — `centerPhotoId`, else the smallest photo id (today's
  rule). Only the lane photos are shuffled. — *Rationale:* the editor UI (`editor.page.ts` "Set as
  centre", `EditorStore.setCenterPhoto`, `EditorStore.swapPhotos`) uses `resolveCentrePhotoId()` to know
  the centre. Rejected: (a) random centre without saving — UI would show the wrong centre; (b) random centre
  saved to `centerPhotoId` each time — an explicit "Set as centre" would be overwritten by the next
  shuffle; (c) random centre + new flag (`centerPhotoAuto`) — more code and state than the feature is worth.
  A different centre: "Set as centre" or swap.
- **Which arrangements use the setting:** all arrangements of that mode — dialog "Re-arrange", quick
  re-roll button, automatic arrangement after an import. — *Rationale:* one rule in `arrangePhotos()`, no
  extra parameter from the store.
- **Random seed:** not saved. — *Rationale:* the result is saved as frames.
- **Confirm dialog:** unchanged (`confirmRearrange` rule). Several re-rolls in a row do not ask, because
  `layoutIsArrangement` is true after an arrangement.

## Testing strategy

No automated tests (project rule in `AGENTS.md`). Verify with `cd frontend && npx ng build`, then manual
review by the developer.

## Steps

### Step 1 — Random order setting, shuffle and dialog checkbox
- **Status:** done (reviewed 2026-11-14)
- **What:**
  - `collage.ts`: `randomOrder: boolean` in `GridSettings` and `CenterSettings` (with doc comment); default
    `false` in `defaultCollageSettings()`; `normalizeGrid` / `normalizeCenter` with `booleanOr`.
  - `arrange.ts`: shuffle (Fisher–Yates with `random`) of the id-sorted copy when the active mode's
    `randomOrder` is true; `heap` never; update doc comments.
  - Dialog: `randomOrder` control in the `grid` and `center` form groups; `mat-checkbox` "Random order"
    (`i18n="@@editor.settings.randomOrder"`) in the `grid` and `center` cases; import `MatCheckboxModule`.
- **Acceptance criteria:**
  - `cd frontend && npx ng build` passes.
  - Grid mode, checkbox on, "Re-arrange" → photos in a new order; each click on the re-roll button gives
    another order. Checkbox off → id order (as before).
  - Center mode, checkbox on → lane photos shuffled; the centre photo stays (explicit "Set as centre" photo,
    or the first imported photo).
  - Heap dialog has no checkbox.
  - The checkbox value is saved (reload the editor, open the dialog: same value). An existing collage
    opens with the checkbox off.
  - Import with checkbox on → all photos arranged in random order.
- **Notes:** Implemented as planned, no deviations. `arrange.ts` has a `RANDOM_ORDER` lookup
    (`Record<ArrangementMode, (settings) => boolean>`, `heap` → `false`) beside `STRATEGIES` and a private
    Fisher–Yates `shuffle()` that shuffles the id-sorted copy in place with the injected `random`. Other
    code that builds `GridSettings` / `CenterSettings` (`editor.store.ts`, `layout-snapshot.ts`) uses
    spreads only and needed no change. `npx ng build` passes; manual test approved by the developer.

## Open questions

None.

## Current state / Next action

All steps done (2026-11-14). Feature complete; plan moved to `doc/agent-plans/done/`. Nothing
half-finished, no temporary changes.
