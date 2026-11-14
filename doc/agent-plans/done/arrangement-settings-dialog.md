# Arrangement settings dialog

**Ticket/Source:** none (idea of the developer, 2026-11-14, while planning `arrange-random-heap.md`)
**Branch:** none
**Status:** done

## Goal

The parameters of the arrangement modes (grid, center, and later heap/masonry) move out of the side panel
into a dialog. The dialog opens when the user clicks "Re-arrange…" or changes the mode. The user edits
the parameters there and clicks "Re-arrange": the settings are saved and the photos are arranged in one
go. The side panel stays short: mode select, "Re-arrange…" button, a quick re-roll icon button (re-arrange
again with the same settings, important for random modes like the planned heap) and the hint text.

## Scope

**In scope:**
- Dialog component and an opener service for the mode parameters (grid, center).
- New store method that saves the settings and re-arranges as one undo step, without a confirm.
- Side panel "Arrangement" section: mode select opens the dialog, "Re-arrange…" button, quick re-roll icon
  button, disabled state with 0 photos.

**Out of scope:**
- Live preview of the arrangement while the dialog is open.
- Saving settings without a re-arrange (no "Save" button; Cancel discards).
- The settings dialog after an import (import keeps today's behaviour).
- Heap fields (step 1 of `doc/agent-plans/arrange-random-heap.md`, which depends on this plan).
- Backend changes.

## Rough Architecture / Concept

Frontend only.

- **Dialog** `frontend/src/app/features/editor/settings-panel/arrangement-settings-dialog.{ts,html}`
  (Angular Material `MatDialog`, standalone component). Dialog data: `mode` (the mode to edit, can differ
  from the saved mode), the current `CollageSettings` parts it needs (`grid`, `center`). It shows only the
  fields of the given mode (the grid and center fields move here unchanged from
  `arrangement-settings-section.html`, with the same validators, limits, i18n ids and `app-number-field`).
  Title "Re-arrange: Grid" / "Re-arrange: Center" (i18n). The existing hint text
  "Re-arranging places all photos again and overwrites manual changes." is shown as a static note.
  Buttons: **Cancel** (closes, returns `undefined`) and **Re-arrange** (disabled while a field of the
  mode is invalid; returns the new settings: `mode` + the changed mode parameters; `center.centerPhotoId`
  is kept, it is not edited in the dialog).
- **Opener service** `ArrangementSettingsDialogService` (same folder or `features/editor/`), pattern of
  `frontend/src/app/shared/confirm-dialog/confirm.service.ts`: `open(data): Promise<result | undefined>`.
- **Store** `frontend/src/app/features/editor/editor.store.ts`: new public method
  `rearrangeWith(settings: CollageSettings)`: set the settings signal, `arrangeAll()`, one `commit()`
  (one undo step restores settings and layout). No confirm (the user opened the dialog deliberately).
  The existing `rearrange()` (with `confirmRearrange()`) stays for the quick re-roll.
- **Panel** `frontend/src/app/features/editor/settings-panel/arrangement-settings-section.{ts,html}`
  (presentational; keeps no own settings form for the mode parameters any more):
  - Mode select: a selection change does **not** commit the mode; it emits a request to open the dialog
    for the selected mode. Cancel resets the select to the saved mode (must be done explicitly:
    `syncFromInput` in `fields/sync-from-input.ts` is an `effect` and does not fire again when the
    `mode` input did not change).
  - Filled button "Re-arrange…" (icon `auto_awesome_mosaic`): opens the dialog for the saved mode.
  - Icon button right of it (icon e.g. `refresh`, tooltip "Re-arrange again with the same settings"):
    calls the existing `store.rearrange()` (confirm as today if manual work may be lost).
  - Hint text "Re-arranging places all photos again and overwrites manual changes." stays below.
  - With 0 photos: mode select, "Re-arrange…" and the icon button are disabled.
  - Who opens the dialog: the panel emits an output (e.g. `openArrangement(mode)`); it is passed through
    `collage-settings-panel.{ts,html}` to `editor.page.{ts,html}`, which opens the dialog with the service
    and calls `store.rearrangeWith(...)` with the result. The exact wiring follows the existing output
    pattern (`rearrange` output → `(rearrange)="store.rearrange()"` in `editor.page.html`).
- Outputs `modeChange`, `gridChange`, `centerChange` of the section (and their `update(...)` handlers in
  `collage-settings-panel.html`) are removed, because mode and parameters are only saved through the
  dialog.

Why: keeps the side panel clean when modes get more parameters (heap, masonry); a dialog with Cancel /
Re-arrange makes "settings + arrangement" one deliberate action and one undo step; the quick re-roll keeps
repeated random arrangements cheap.

## Context for a new agent

- **Sources read:** developer's idea (goal above) and the code. No external sources.
- **Key files (state 2026-11-14):**
  - `frontend/src/app/features/editor/settings-panel/arrangement-settings-section.{ts,html}` — today: mode
    select (`commitMode()` emits `modeChange`), grid fields (rows, cols with "Auto" placeholder, gapMm,
    marginMm; `commitGrid()`), center fields (sizePercent, topCount, middleCount, bottomCount, gapMm,
    marginMm; `commitCenter()` keeps `centerPhotoId`), Re-arrange button (`rearrange.emit()`, disabled if
    `photoCount() === 0` or `parametersInvalid()`), hint text. Validators: `limitValidators` from
    `shared/number-limits.ts`, limits `SETTINGS_LIMITS` in `settings-limits.ts`.
  - `frontend/src/app/features/editor/settings-panel/collage-settings-panel.{ts,html}` — presentational
    panel; `update(change)` emits `settingsChange` (each emit = one committed undo step in the store).
  - `frontend/src/app/features/editor/editor.page.{ts,html}` — hosts the panel (line ~229:
    `<app-collage-settings-panel ... (rearrange)="store.rearrange()" ...>`).
  - `frontend/src/app/features/editor/editor.store.ts` — `rearrange()` (confirm via
    `confirmRearrange()` if `mustConfirmRearrange()`, then `arrangeAll()` + `commit()`), `applyImport()`
    (auto-arrange after import, confirm "Re-arrange / Keep layout"), private `arrangeAll()`
    (`arrangePhotos(...)`, `layoutIsArrangement = true`), private `commit()` (undo history push +
    auto-save).
  - `frontend/src/app/shared/confirm-dialog/{confirm-dialog.ts,confirm.service.ts}` — pattern for a
    `MatDialog` component + opener service (`width: '400px'`, `maxWidth: 'calc(100vw - 32px)'`).
  - `frontend/src/app/features/editor/fields/number-field.ts`, `fields/sync-from-input.ts`,
    `fields/panel-section.scss`.
  - `frontend/src/app/features/editor/geometry/snap-grid.ts` — reads the margin of the saved mode; not
    changed by this plan.
- **Commands:** `cd frontend && npx ng build` (verification); dev: `make dev-up && make dev-shell`, then in
  the container `make backend-run` and `make frontend-serve` (http://localhost:4200).
- **Domain terms:** *re-arrange* = run the arrangement of the current mode for all photos;
  *manual work* = layout changed by hand since the last arrangement (`layoutIsArrangement === false`).

## Decision log

- **Where mode settings live:** in a dialog that opens on "Re-arrange…" (developer decision). *Rejected:*
  dialog via a separate tune button with a one-click Re-arrange (agent recommendation); collapsible panel
  section; keep in panel.
- **Panel content:** mode select + "Re-arrange…" + quick re-roll icon button + hint text. *Rejected:* mode
  select only in the dialog; mode as read-only text.
- **Re-roll for random modes:** dialog closes after Re-arrange; the panel has a quick re-roll icon button
  (same settings, no dialog). *Rejected:* dialog that stays open; no quick re-roll.
- **When settings are saved:** only on Re-arrange in the dialog; Cancel discards. Settings + new frames
  are one undo step. *Rejected:* separate "Save" button.
- **Confirm:** Re-arrange in the dialog never asks again (the user opened the dialog deliberately). The
  quick re-roll button keeps the existing confirm (`confirmRearrange()`).
- **Import:** no settings dialog; auto-arrange and the "Re-arrange / Keep layout" confirm stay as today.
  *Rejected:* open the dialog after each import.
- **Mode change in the panel:** opens the dialog for the new mode; the mode is saved only on Re-arrange;
  Cancel resets the select to the saved mode. *Rejected:* save the mode at once without re-arranging.
- **0 photos:** mode select, "Re-arrange…" and the re-roll button are disabled; mode and parameters cannot
  be changed until photos are imported (the first import uses the saved settings). *Rejected:* "Save"
  button in the dialog with 0 photos.
- **Panel layout:** filled button "Re-arrange…" with an icon button (↻) right of it, hint below.
  *Rejected:* two full-width buttons; tune icon in the mode row.
- **Testing:** no automated tests (project rule in `AGENTS.md`).

## Testing strategy

No automated tests, manual review only. Each step: `cd frontend && npx ng build` must succeed, then the
developer tests in the browser with the manual test steps of the step.

## Steps

### Step 1 — Dialog, service, store method, "Re-arrange…" button
- **Status:** done (reviewed 2026-11-14)
- **What:** `ArrangementSettingsDialog` with the grid and center fields (moved from the panel),
  `ArrangementSettingsDialogService`, `EditorStore.rearrangeWith(settings)`; the panel button becomes
  "Re-arrange…" and opens the dialog for the saved mode (wiring through `collage-settings-panel` to
  `editor.page`); grid/center fields and their outputs are removed from the panel. The mode select keeps
  its current behaviour in this step.
- **Acceptance criteria:** `npx ng build` ok. "Re-arrange…" opens the dialog with the saved values of the
  current mode; changing values + Re-arrange arranges the photos and saves the settings (survive a
  reload); one Undo restores settings and layout; Cancel changes nothing; invalid value disables
  Re-arrange; no confirm after Re-arrange in the dialog, also after manual changes; Center: the centre
  photo (`centerPhotoId`) stays.
- **Notes:** New files in `frontend/src/app/features/editor/settings-panel/`:
  `arrangement-settings-dialog.ts` (component; data/result type `ArrangementSettings` = `mode`, `grid`,
  `center` of `CollageSettings`; result keeps the other mode's parameters and `centerPhotoId`),
  `arrangement-settings-dialog.html` (title, fields, hint note, Cancel / Re-arrange; the dialog is a
  `<form>`, Enter submits when valid), `arrangement-settings-dialog.service.ts`
  (`ArrangementSettingsDialogService.open(data)`, 400px like `ConfirmService`).
  `EditorStore.rearrangeWith(settings)` added. `EditorPage.openArrangement(mode)` opens the dialog and
  calls `store.rearrangeWith({ ...current, ...result })`. Section output `openArrangement` is passed
  through `collage-settings-panel` (output `openArrangement`). Removed: section inputs `grid`/`center`,
  outputs `gridChange`/`centerChange`/`rearrange`, panel output `rearrange` (step 2 adds a re-roll output
  again; `store.rearrange()` stays). Deviations: dialog hint uses new i18n id
  `@@editor.arrangementDialog.hint` (reusing `@@editor.settings.rearrangeHint` gave "Duplicate messages"
  in `ng extract-i18n`); new ids `@@editor.arrangementDialog.{titleGrid,titleCenter,cancel,submit}`,
  `@@editor.settings.rearrangeDialog` ("Re-arrange…"; old `@@editor.settings.rearrange` unused). Dialog
  has its own inline styles (`.field-row`, `.settings-note`) because `panel-section.scss` has a `:host`
  flex layout. Each new mode must add its title and fields to the dialog.

### Step 2 — Mode select opens the dialog, quick re-roll, 0 photos
- **Status:** done (reviewed 2026-11-14)
- **What:** mode select change opens the dialog for the selected mode (Cancel resets the select);
  `modeChange` output removed; icon button (↻, tooltip, i18n) right of "Re-arrange…" calls
  `store.rearrange()`; mode select and both buttons disabled with 0 photos.
- **Acceptance criteria:** switch Grid → Center: dialog "Re-arrange: Center" opens; Cancel → select shows
  Grid again, nothing saved; Re-arrange → mode Center saved and arranged (one undo step). Re-roll after a
  manual move → confirm shows; re-roll right after an arrangement → no confirm. New empty collage →
  controls disabled; after an import → enabled.
- **Notes:** `arrangement-settings-section.ts`: `modeChange` removed; select calls `requestMode()`, which
  emits `openArrangement(selected)` and at once resets the select to `mode()` (while the dialog is open,
  the select behind it already shows the saved mode; after Re-arrange the new mode flows back through the
  `mode` input / `syncFromInput`). Select is enabled/disabled with a second `syncFromInput` on
  `canRearrange` (`emitEvent: false`; no `[disabled]` on a reactive control). New output `rearrangeAgain`
  (section → `collage-settings-panel` → `editor.page.html`: `(rearrangeAgain)="store.rearrange()"`).
  Icon button `refresh` with tooltip + aria-label i18n `@@editor.settings.rearrangeAgain`; row styles
  inline in the section (`.rearrange-row`, filled button `flex: 1`). Build and `ng extract-i18n` ok.

### Step 3 — Close
- **Status:** done (reviewed 2026-11-14)
- **What:** check `doc/architecture.md` (today it does not describe the side panel; update only if
  needed), set status done and move this file to `doc/agent-plans/done/`. Update "Current state" in
  `doc/agent-plans/arrange-random-heap.md` (prerequisite done).
- **Acceptance criteria:** plan in `done/`; heap plan points to the finished dialog.
- **Notes:** `doc/architecture.md` does not describe the side panel; no change needed. Plan moved to
  `doc/agent-plans/done/`.

## Open questions

- None.

## Current state / Next action

All steps done and reviewed by the developer (2026-11-14). Follow-up `doc/agent-plans/done/arrange-random-heap.md` (heap fields in this dialog) is also done.
