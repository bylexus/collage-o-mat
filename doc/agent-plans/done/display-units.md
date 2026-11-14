# Display units (mm / px)

**Ticket/Source:** none (idea of the developer, 2026-11-13; grilled 2026-11-14)
**Branch:** none (developer decision: work on `main`, no feature branch)
**Status:** done

## Goal

The user can switch the unit of all lengths shown and entered in the editor between millimetres and
pixels. The unit is a selector in the right settings panel, in the "Page" section. In px mode every length
field, label and hint shows whole pixels at the collage DPI, so the user can work in export pixels. The
stored data stays in mm.

In the same feature the "Page" section is re-arranged to save space:
- Row 1: page size dropdown + portrait/landscape toggle (icons only, with tooltip).
- Row 2: unit selector + resolution (DPI) field.

## Scope

**In scope:**
- New per-collage setting `displayUnit` (`'mm' | 'px'`), default `'mm'`, selected in the Page section.
- Page section re-layout (see Goal; full order in the decision log).
- Conversion of all editor length fields: custom page width/height, default border width, default shadow
  (blur, offset X/Y), photo border width, photo shadow, text outline width, text shadow, arrangement dialog
  gap/margin, snap grid size (toolbar popover).
- Background blur slider: only its label ("Blur: 35 px") follows the unit.
- `pageLabel()` for custom page sizes (editor subtitle and collage list).

**Out of scope:**
- Create-collage dialog (`features/collages/collage-create-dialog.*`) stays in mm.
- Export dialog: no change (it has no mm values; it already shows px for the export DPI).
- Font size stays in pt. %, degrees and DPI are not lengths.
- Backend, DB, data model in mm: no change. No automated tests.
- No keyboard shortcut, no toolbar button for the unit.

## Rough Architecture / Concept

Frontend only. The world unit stays mm everywhere (models, forms, store, canvas). Conversion happens only
in the UI fields:
- `CollageSettings.displayUnit` stored in `collages.settings` (opaque JSON for the backend).
- A pure module `features/editor/geometry/length-unit.ts` converts mm <-> display value with the collage
  DPI (`settings.page.dpi`).
- A new form field component `app-length-field` (`features/editor/fields/length-field.ts`) wraps the mm
  `FormControl`: it shows/accepts the display unit, writes mm into the outer control and appends the unit
  to the label. All forms and commit logic stay in mm.
- The unit is changed without an undo step: `EditorStore.setDisplayUnit()` saves without `history.push`;
  undo/redo keeps the current unit.
- `lengthUnit = { unit, dpi }` flows as an `input()` from `editor.page` to the panels / popover and in the
  `data` of the arrangement dialog (panels are dumb components; they do not inject the store).

## Context for a new agent

- **Sources read:** this file (initial version listed the open questions, all answered below);
  `AGENTS.md` (rules: no commits, verify with `npx ng build`, UI texts English + i18n, no new libraries);
  `doc/architecture.md` conventions.
- **Key files (all under `frontend/src/app/`):**
  - `core/models/collage.ts` — `CollageSettings` (top-level fields `page`, `background`, ..., `snapGrid`),
    `PageSettings` (`preset`, `orientation`, `widthMm`, `heightMm`, `dpi`), `defaultCollageSettings()`,
    `normalizeSettings()` (merges defaults into old JSON, uses helpers like `oneOf`), `pageLabel(page)` and
    `formatMm()` (label "300 × 200 mm" for custom sizes, i18n id `@@collages.pageLabel.custom`).
  - `features/editor/editor.store.ts` — `updateSettings()` -> `commit()` (`history.push(snapshot)` +
    `autoSaver.schedule()`); `undo()/redo()` -> `restore(snapshot)` sets `settingsSignal` from the snapshot.
  - `features/editor/editor.page.ts/.html` — composition of toolbar, canvas, panels; `pageLabel` computed
    (subtitle); `updateSnapGrid()`; opens the arrangement dialog via `ArrangementSettingsDialogService`.
  - `features/editor/settings-panel/page-settings-section.ts/.html` — page preset select, orientation
    `mat-button-toggle-group` (shown only when `showOrientation()`: not custom, not square), custom
    width/height (`app-number-field`, limits `PAGE_SIDE_LIMITS` from `shared/page-size-form`), DPI field,
    "Export size" note. Emits `pageChange` with `pageForm.pageSettings(dpi)` (that builds a NEW
    `PageSettings`, so extra fields on the page would be lost — reason `displayUnit` is top-level).
  - `features/editor/settings-panel/collage-settings-panel.html/.ts` — sections Page, Appearance,
    Arrangement; `update({...})` emits partial settings.
  - `features/editor/settings-panel/appearance-settings-section.ts` — background (blur slider, label
    `Blur: {{ blurMm() }} mm`), default border (`app-border-fields`), default shadow (`app-shadow-fields`).
  - `features/editor/settings-panel/arrangement-settings-dialog.{ts,html}` + `.service.ts` — Gap (mm),
    Margin (mm) fields; dialog opened by a root service with `data`.
  - `features/editor/settings-panel/settings-limits.ts` — limits in mm (`gapMm`, `marginMm`,
    `snapGridSizeMm`, `backgroundBlurMm`, `dpi`).
  - `features/editor/fields/number-field.ts` — `app-number-field` (control, label, limits, placeholder,
    `committed` on native change; range/integer errors). Pattern to copy for `app-length-field`.
  - `features/editor/fields/border-fields.ts` (`Border (mm)`, `BORDER_WIDTH_LIMITS`),
    `features/editor/fields/shadow-fields.ts` (`Blur (mm)`, `Offset X (mm)`, `Offset Y (mm)`),
    `features/editor/fields/panel-section.scss` (`.field-row` flex row, `.settings-note`).
  - `features/editor/photo-panel/photo-properties-panel.*` — per-photo border/shadow.
  - `features/editor/text-panel/text-properties-panel.html` — outline `Width (mm)`, shadow fields, text limits
    in `text-limits.ts`.
  - `features/editor/snap-grid/snap-grid-popover.ts` — `Grid size (mm)`.
  - `core/models/units.ts` — `mmToPx(mm, dpi)`, `pxToMm`, `ptToMm`, `MM_PER_INCH`, `PT_PER_INCH`
    (moved from `features/editor/geometry/units.ts` in the review of 2026-11-14).
  - `features/collages/collages.page.ts` — list uses `pageLabel(c.settings.page)`.
- **Existing patterns to follow:** `app-number-field` (field), `snapGrid` in `collage.ts` (adding a settings
  field with default + normalize), `syncFromInput` (`fields/sync-from-input.ts`) for input -> form sync.
- **Commands:** `cd frontend && npx ng build` (verification); dev: `make dev-up && make dev-shell`, then
  `make backend-run` and `make frontend-serve` (http://localhost:4200).
- **Environment:** no translation files exist (only source locale), so renaming i18n ids is free.
- **Domain terms:** "display unit" = unit of shown/entered lengths; "collage DPI" = `settings.page.dpi`
  (print resolution, default 300).

## Decision log

- **px basis:** collage DPI (`settings.page.dpi`); px = export px. When the DPI changes, mm values stay and
  the shown px values change. — *Rationale:* px then match the export; selector sits next to DPI.
  Rejected: screen px (96 DPI) — not useful for export/print.
- **Storage:** per collage, `CollageSettings.displayUnit: 'mm' | 'px'`, default `'mm'`, old collages get
  `'mm'` via `normalizeSettings`. — *Rationale:* selector is in the collage settings panel. Rejected:
  localStorage (no sync across devices), session only.
- **Field location:** top-level in `CollageSettings`, not in `PageSettings`. — *Rationale:* the page section
  rebuilds `PageSettings` on each commit (`pageForm.pageSettings()`), a field there would be lost.
- **Undo:** a unit change is NOT an undo step. `EditorStore.setDisplayUnit(unit)` sets the settings and calls
  `autoSaver.schedule()` without `history.push`; `restore()` keeps the current `displayUnit` (overrides the
  snapshot's value). — *Rationale:* developer choice. Rejected: undoable like snap grid.
- **Scope outside editor panels:** `pageLabel()` follows the unit (custom sizes only: "3543 × 2362 px");
  create dialog stays mm; export dialog unchanged. — *Rationale:* developer choice; create dialog has no
  collage/unit yet.
- **px rounding (revised in developer review 2026-11-14):** `Math.round` everywhere. Display =
  `round(mmToPx(mm, dpi))`; px limits = `round(mmToPx(min))` / `round(mmToPx(max))`, step 1,
  `integer: true`. A valid px input becomes mm rounded to 3 decimals, then clamped into the mm limits
  (a px value at a rounded limit can be a bit outside them), then written to the control. The stored mm
  changes only when the user edits the field (0.5 mm border shows "6" at 300 DPI and stays 0.5 mm).
  — *Rationale:* exact round trip px -> mm (3 decimals) -> px for DPI 72..1200 (checked for all px
  values of all length limits); a stored value at a limit always shows inside the px limits.
  Rejected: one-decimal px; ceil/floor limits (first implementation) — ceil breaks the round trip
  (float error after the 3-decimal rounding) and floor/ceil do not fix the max limit (50 mm = 590.55 px
  shows as 591 px, but 591 px = 50.04 mm > 50 mm).
- **Conversion helpers location:** `MM_PER_INCH`, `PT_PER_INCH`, `mmToPx`, `pxToMm`, `ptToMm` live in
  `core/models/units.ts` (developer review 2026-11-14). — *Rationale:* layering, `core` must not depend
  on `features` (`pageLabel()` in `core/models/collage.ts` needs `mmToPx`). Rejected: import from
  `features/editor/geometry/units.ts`, a re-export shim. The duplicate `ptToMm` / `MM_PER_PT` in
  `core/models/text.ts` is removed (DRY, developer review 2026-11-14); `canvas/text-view.ts` imports
  `ptToMm` from `core/models/units.ts`.
- **Background blur slider:** slider stays in mm (range/step); only the label shows the converted value
  (rounded px). — *Rationale:* small change. Rejected: px slider, mm-only.
- **Unit control:** `mat-select` "Unit" with options `mm` / `px`, same height as the DPI field. Rejected:
  button toggle.
- **Page section order:** Row 1 page size select + orientation toggle (icons `crop_portrait` /
  `crop_landscape`, `matTooltip` "Portrait"/"Landscape", aria-labels kept; dropdown fills the row when the
  toggle is hidden) -> custom Width/Height row (custom only) -> Row 2 Unit select + Resolution (DPI) ->
  "Export size" note. Rejected: unit/DPI row before width/height.
- **Field component:** new `app-length-field` with inputs `control` (mm), `limits` (mm), `label` (no unit),
  `lengthUnit`; internal display control; label gets " (mm)" / " (px)". — *Rationale:* DRY, forms stay mm.
- **Data flow:** `lengthUnit` input from `editor.page` through panels; dialog `data`. — *Rationale:* panels
  are dumb components today.
- **i18n:** labels without unit, ids lose the `Mm` suffix (e.g. `@@editor.settings.width`); unit
  abbreviations `mm`/`px` not translated. — *Rationale:* no translation files exist.
- **Branch:** none, work on `main`. Implementation of all steps without review stops between steps
  (developer decision 2026-11-14), coding in sub-agents.

## Testing strategy

No automated tests (AGENTS.md). Verify with `cd frontend && npx ng build`; manual review by the developer.

## Steps

### Step 1 — Unit setting + Page section re-layout
- **Status:** done (reviewed 2026-11-14)
- **What:** `displayUnit` in model/defaults/normalize; `EditorStore.setDisplayUnit()` without undo,
  `restore()` keeps the unit; Page section re-layout (row 1, row 2 with Unit select). Unit is saved but
  does not convert values yet.
- **Acceptance criteria:** layout as in the decision log; tooltip on orientation icons; unit change saved
  (reload keeps it), not in undo history; undo of other edits does not change the unit.
- **Notes:**
  - `core/models/collage.ts`: `DisplayUnit`, `DISPLAY_UNITS`, `CollageSettings.displayUnit` (default
    `'mm'`, `normalizeSettings` via `oneOf`).
  - `editor.store.ts`: `setDisplayUnit(unit)` (sets settings + `autoSaver.schedule()`, no history push, no
    change if equal); `restore()` keeps the current `displayUnit`.
  - `page-settings-section.{ts,html}`: row 1 `.page-row` (select flex 1 + icon toggle with `matTooltip`
    and aria-labels, ids `@@editor.settings.portrait/landscape` reused); row 2 `.field-row` with Unit
    `mat-select` (own control `unitControl`, not in `form`, id `@@editor.settings.displayUnit`) + DPI.
    New output `displayUnitChange`; `collage-settings-panel` forwards it as `displayUnitChange`;
    `editor.page.html` calls `store.setDisplayUnit($event)`.

### Step 2 — Conversion core + page values
- **Status:** done (reviewed 2026-11-14)
- **What:** `pxToMm` in `units.ts`; `geometry/length-unit.ts`; `fields/length-field.ts`; use for custom
  page width/height; `pageLabel()` with unit (editor subtitle and collage list).
- **Acceptance criteria:** custom A4-size page at 300 DPI shows 2480 × 3508 px in px mode; entering px
  stores mm; subtitle/list show px for custom pages in px mode.
- **Notes:**
  - New `core/models/units.ts` (review): content of the former `features/editor/geometry/units.ts`
    (deleted, no shim) plus `pxToMm`; imports updated in `core/models/collage.ts`,
    `geometry/length-unit.ts`, `settings-panel/page-settings-section.ts`. No behaviour change.
  - New `geometry/length-unit.ts`: `LengthUnit { unit, dpi }`, `toDisplayLength` (px: `round`),
    `fromDisplayLength` (px: mm rounded to 3 decimals), `toDisplayLimits` (px: `round` of the mm limits,
    step 1, `integer`), `lengthLabel` ("Width (px)").
  - New `fields/length-field.ts` (`app-length-field`): wraps `app-number-field` with an internal display
    control. The outer mm control stays the source of truth: `ngDoCheck` re-shows the value when the
    control, its value, unit or DPI changes (also catches `setValue(..., { emitEvent: false })` of
    `pageForm.setPage` / text panel reset), mirrors disabled and touched. Valid input -> `setValue(mm)`
    (3-decimal mm, then clamped into the mm limits). Invalid/empty input -> mm value unchanged, outer
    control gets error `lengthDisplay` (so `form.invalid` / `.valid` checks of the callers block the
    commit); an owner reset clears the error and the field shows the mm value again.
  - `editor.page.ts`: `lengthUnit` computed (`{ unit: displayUnit, dpi: page.dpi }`, custom equality) ->
    `collage-settings-panel` input `lengthUnit` -> page section (replaces the Step 1 `displayUnit` input;
    the Unit select reads `lengthUnit().unit`).
  - Page width/height use `app-length-field`, labels "Width"/"Height", ids `@@editor.settings.width/height`.
  - `pageLabel(page, unit = 'mm')`: custom + px -> "2480 × 3508 px" (new id
    `@@collages.pageLabel.customPx`); editor subtitle and collage list pass `settings.displayUnit` (an old
    collage without the field in the list falls back to mm).
  - Review changes 2026-11-14: helpers moved to `core/models/units.ts`; ceil/floor px limits replaced by
    `round` + clamp to the mm limits; px input stored as mm with 3 decimals. Round trip checked with a
    script for DPI 72..1200 and all px values of all length limits: no mismatch. Values at 300 DPI:
    page side 10 mm = 118 px (min 118; 118 px -> 9.991 mm -> clamped 10 mm), max 2000 mm = 23622 px;
    gap 50 mm = 591 px (max 591; 591 px -> 50.038 mm -> clamped 50 mm); 119 px -> 10.075 mm.

### Step 3 — All other lengths
- **Status:** done (reviewed 2026-11-14)
- **What:** appearance (border, shadow, blur label), photo panel (border, shadow), text panel (outline width,
  shadow), arrangement dialog (gap/margin), snap grid popover (grid size) use `app-length-field` /
  converted labels.
- **Acceptance criteria:** every length label shows the active unit; values convert; errors show px limits.
- **Notes:**
  - `border-fields.ts`, `shadow-fields.ts`: new required input `lengthUnit`; border width, shadow blur,
    offset X/Y use `app-length-field` (ids `@@editor.settings.borderWidth`, `@@editor.shadow.blur`,
    `@@editor.shadow.offsetX`, `@@editor.shadow.offsetY`). Opacity stays `app-number-field` (%).
  - `appearance-settings-section.ts`: input `lengthUnit` (from `collage-settings-panel`), passed to
    border/shadow fields; blur slider label "Blur: {{ blurDisplay() }} {{ unit }}" (slider stays mm).
  - `photo-properties-panel.{ts,html}`, `text-properties-panel.{ts,html}`: input `lengthUnit` (from
    `editor.page.html`); text outline width uses `app-length-field` (id `@@editor.text.outlineWidth`).
  - `arrangement-settings-dialog.{ts,html}`: `ArrangementSettingsDialogData` = `ArrangementSettings &
    { lengthUnit }`; gap/margin of all modes use `app-length-field` (ids `@@editor.settings.gap/margin`);
    `editor.page.ts` `openArrangement()` passes `lengthUnit`.
  - `snap-grid-popover.ts`: input `lengthUnit` (from `editor.page.html`), grid size uses
    `app-length-field` (id `@@editor.snapGrid.size`).

## Open questions

(none)

## Current state / Next action

- Plan approved 2026-11-14.
- 2026-11-14: Steps 1–3 implemented, `npx ng build` OK after each step. Nothing committed.
- 2026-11-14: developer review changes done (helpers in `core/models/units.ts`, `round` limits + clamp,
  3-decimal mm); `npx ng build` OK.
- 2026-11-14: duplicate `ptToMm` removed from `core/models/text.ts`; build OK.
- 2026-11-14: all steps reviewed and approved by the developer. Feature done; plan moved to
  `doc/agent-plans/done/`. Nothing committed yet.
