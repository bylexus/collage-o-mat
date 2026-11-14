# Photo shadow

**Ticket/Source:** none (developer request, 2026-11-14)
**Branch:** none (work on `main`, no feature branch — developer decision)
**Status:** done

## Goal
Photos on a collage page get an optional drop shadow. The collage has a default shadow (Appearance
section of the settings panel); each photo can use that default or have its own full shadow (photo
properties panel). This works like the existing photo border (collage `defaultBorder` + per-photo
`border`). Before this feature, only overlay texts had a shadow; photos never had one (checked in the
full git history — it was never implemented, not removed).

## Scope
**In scope:**
- Shared shadow type and shared shadow form fields (text panel refactored to use them).
- Collage default shadow (`CollageSettings.defaultShadow`) with UI in the Appearance section.
- Per-photo shadow override (`PhotoProps.shadow`) with UI in the photo panel.
- "Apply to all photos" button for the shadow in Appearance (removes all per-photo shadows).
- Shadow on the canvas and in the PNG/JPG export.
- Re-arrange keeps per-photo border (width + colour) and per-photo shadow (behaviour change: today
  re-arrange resets the border to the collage default).
- Docs update in `doc/architecture.md`.

**Out of scope:**
- Per-field shadow inheritance (like the border's per-field `null`s).
- Polar offset (distance + angle) instead of offset X/Y.
- Shadow for the page background or the background image.
- Backend changes (settings and photo props are opaque JSON for the backend).
- Automated tests.

## Rough Architecture / Concept
- **Model:** one shared `Shadow` type `{ enabled, color, blurMm, offsetXMm, offsetYMm, opacity (0..1) }`
  in `frontend/src/app/core/models/shadow.ts`; `TextShadow` in `core/models/text.ts` becomes an alias of
  it (no data change for texts).
- **Collage default:** `CollageSettings.defaultShadow: Shadow`. Default value: `enabled: false,
  color: '#000000', opacity: 0.4, blurMm: 3, offsetXMm: 1.5, offsetYMm: 1.5`. `normalizeSettings` in
  `core/models/collage.ts` gets a `normalizeShadow` (field by field, like `normalizeBorder`), so old
  collages get the default (off → they look unchanged).
- **Per photo:** `PhotoProps.shadow?: Shadow | null`. Missing or `null` = use `defaultShadow`; an object
  = a full own shadow (an object with `enabled: false` switches the shadow off for this one photo).
  Photo props are not normalized on load, so every reader must treat a missing field as `null`. Helper
  functions in `features/editor/photo-shadow.ts` (like `photo-border.ts`): `effectiveShadow(props,
  defaultShadow)`, `hasShadowOverride(props)`, `sameShadow`-based comparison.
- **Rendering (`features/editor/canvas/photo-view.ts`):** today the one photo group is clipped to the
  frame, which would cut off a Konva shadow. New structure: an outer group (`name: 'photo'`, position,
  offset, rotation, scale, draggable — everything the rest of the code reads via `view.group`) with
  (1) a shadow-casting `Konva.Rect` of frame size, `listening: false`, filled (any opaque colour, it is
  hidden under the photo), with `shadowColor/Blur/OffsetX/OffsetY/Opacity`, visible only if the
  effective shadow is enabled; and (2) an inner group with the frame `clip` that holds the image and the
  border rect. Lengths are world mm; Konva multiplies shadow blur/offset by the absolute scale and pixel
  ratio, so the mm values are right at every zoom and in the export (same as `canvas/text-view.ts`).
  Konva does not rotate the shadow offset with the node: all photos have the same light direction,
  also rotated ones (wanted for the heap mode). The export (`canvas/page-image-renderer.ts`) uses
  `PhotoView`, so it gets the shadow automatically.
- **UI:** shared `ShadowFields` component in `features/editor/fields/shadow-fields.ts` (enabled
  checkbox + colour, opacity %, blur mm, offset X/Y mm; owner creates the controls; emits `committed`),
  shared `SHADOW_LIMITS` (blur 0–20 mm step 0.5, offset −20..20 mm step 0.5, opacity 0–100 % step 5 —
  the current text limits). Used by the text panel, the Appearance section and the photo panel.
- **Re-arrange:** the store keeps `border` and `shadow` of the existing props when it applies the new
  arrangement frames; swap keeps the shadow with the photo (like the border).

*Why:* follows the existing border pattern (low surprise, DRY with the text shadow), no backend change,
no migration, no new library.

## Context for a new agent
- **Sources read:**
  - `doc/agent-plans/done/arrange-random-heap.md` line 24 and 151: photo shadow was explicitly out of
    scope there ("photos have no shadow property today; only texts have `TextShadow`. Possible own
    feature").
  - `doc/architecture.md`: layering and conventions (core/models = DTOs + pure helpers, only
    `core/api` uses `HttpClient`, editor feature code in `features/editor`).
  - `AGENTS.md`: no automated tests; verify with `go build ./... && go vet ./...` (backend, unchanged
    here) and `npx ng build` (frontend); all UI texts English with `i18n="@@<feature>.<key>"` /
    `$localize`; no new libraries without approval; no commits unless asked.
- **Key files and directories (all under `frontend/src/app/`):**
  - `core/models/text.ts` — `TextShadow`, `TextProps.shadow`.
  - `core/models/collage.ts` — `CollageSettings`, `BorderSettings`, `defaultCollageSettings()`,
    `normalizeSettings()`, `normalizeBorder()`.
  - `core/models/photo.ts` — `PhotoProps`, `PhotoBorder` (per-field `null` = inherit).
  - `features/editor/photo-border.ts` — `inheritedBorder`, `hasBorderOverride`, `sameBorder`.
  - `features/editor/text-props.ts` — `newTextProps` (text shadow defaults), `sameShadow`.
  - `features/editor/text-panel/text-properties-panel.{ts,html}` — current text shadow form (form group
    `shadow` with `enabled, color, blurMm, offsetXMm, offsetYMm, opacityPercent`; mapping
    `opacity*100` ↔ `opacityPercent`), `text-limits.ts` (`TEXT_LIMITS.shadow*`).
  - `features/editor/fields/` — `border-fields.ts` (`BorderFields`, `BORDER_WIDTH_LIMITS`),
    `color-field.ts`, `number-field.ts`, `sync-from-input.ts`, `panel-section.scss`.
  - `features/editor/settings-panel/appearance-settings-section.ts` — background, default border,
    "Apply to all photos" (`applyBorderToAll`, `hasBorderOverrides`).
  - `features/editor/settings-panel/collage-settings-panel.{ts,html}` — wires the Appearance outputs to
    `update(...)` / `preview(...)` and `applyBorderToAll`.
  - `features/editor/photo-panel/photo-properties-panel.{ts,html}` — "Use collage default border"
    checkbox + `BorderFields`, outputs `borderChange`, `borderPreview`.
  - `features/editor/editor.store.ts` — `previewPhotoBorder`, `setPhotoBorder`,
    `applyDefaultBorderToAll`, `hasBorderOverrides`, `withBorderPreview`, `arrangeAll`,
    `applyFrames` (replaces the whole props today), `swapPlacedFrames`.
  - `features/editor/editor.page.{ts,html}` — wires panels to the store.
  - `features/editor/canvas/photo-view.ts` — Konva nodes of one photo; `update(props, defaultBorder)`.
  - `features/editor/canvas/scene.ts`, `collage-renderer.ts`, `editor-canvas.ts`,
    `page-image-renderer.ts` — the scene carries `defaultBorder`; renderer calls `view.update`.
  - `features/editor/canvas/crop-mode.ts`, `selection-transformer.ts` — use `view.group`
    (`getClientRect({ skipShadow: true, ... })` in crop mode).
  - `features/editor/arrange/frame.ts` — `frameProps` sets `border: inheritedBorder()`.
  - `features/editor/swap-frames.ts` — swaps frames, border stays with the photo.
- **Existing patterns to follow:** the border (`defaultBorder` + `PhotoProps.border`, `photo-border.ts`,
  `BorderFields`, store preview/commit/apply-to-all) and the text shadow rendering in
  `canvas/text-view.ts`.
- **Commands:**
  - Host: `make dev-up && make dev-shell`
  - Container: `make backend-run` (Go server :8080), `make frontend-serve` (ng serve :4200)
  - Verify: `cd frontend && npx ng build`
- **Environment / prerequisites:** a user (`collageomat user add`), a collage with several photos
  (local upload is enough).
- **Domain terms:** *frame* = position/size/rotation of a photo on the page; *props* = per-photo JSON
  document; *re-arrange* = re-run the active arrangement mode; *re-roll* = re-arrange with the same
  settings; *Appearance* = section of the collage settings panel.
- **External references:** Konva shadow attributes (`shadowColor`, `shadowBlur`, `shadowOffsetX/Y`,
  `shadowOpacity`, `shadowEnabled`) — https://konvajs.org/api/Konva.Shape.html; clipping a group clips
  the shadows of its children (reason for the two-group structure).

## Decision log
- **Was the photo shadow removed?** No. It never existed in any commit (all refs incl. T3 checkpoints
  searched). New feature.
- **Override model:** whole shadow per photo (`shadow: Shadow | null`), not per-field inheritance —
  *Rationale:* simpler model and UI. *Rejected:* per-field `null`s like the border (6 nullable fields,
  complex form).
- **Parameters:** same as the text shadow (enabled, colour, opacity %, blur mm, offset X/Y mm) with the
  same limits — *Rationale:* one shared type and one shared component. *Rejected:* polar offset;
  minimal fixed-colour shadow.
- **Default values:** off; black, 40 %, blur 3 mm, offset 1.5/1.5 mm — *Rationale:* existing collages
  look unchanged; text values (1 mm / 0.5 mm) are too small for photos. *Rejected:* text values; on by
  default for new collages.
- **Re-arrange:** keeps the per-photo shadow AND the whole per-photo border (width + colour) —
  *Rationale:* border and shadow are look settings, not layout (developer decision; changes the old
  behaviour that reset borders). *Rejected:* reset like before; keep only the border colour.
- **Apply to all:** own "Apply to all photos" button for the shadow in Appearance, enabled only if a
  photo has an own shadow. *Rejected:* one button for border and shadow; no button.
- **UI reuse:** shared `Shadow` type + `ShadowFields` component, text panel refactored to use it —
  *Rationale:* DRY. *Rejected:* a photo-only copy.
- **Colour preview:** the shadow colour is previewed live while the picker is open (same as the
  background and border colours). `ShadowFields` emits `colorPreview(color)`; the owner emits a
  preview of the whole shadow (only if the group is valid). The text panel needs no extra wiring: it
  previews on `form.valueChanges`, which the colour input fires on every `input` event. *Changed
  2026-11-14 (developer review of Step 2); earlier decision "commit only" rejected.*
- **Rendering:** outer unclipped group + shadow rect + inner clipped group (see architecture).
- **Branch:** no feature branch (developer decision).

## Testing strategy
No automated tests (project has none). Each step: `cd frontend && npx ng build`, then manual review
by the developer with the steps given at the end of the step.

## Steps

### Step 1 — Shared shadow type, limits and ShadowFields; refactor text panel
- **Status:** done (reviewed 2026-11-14)
- **What:** `core/models/shadow.ts` with `Shadow`; `TextShadow` = alias. `SHADOW_LIMITS` (shared,
  e.g. in `fields/shadow-fields.ts`); `TEXT_LIMITS.shadow*` removed or pointing to it. `ShadowFields`
  component (checkbox + fields shown only if enabled; inputs: the controls of a form group
  `enabled, color, opacityPercent, blurMm, offsetXMm, offsetYMm`; output `committed`). Shared
  `sameShadow` moved out of `text-props.ts` into a shared place. Text panel uses `ShadowFields`; same
  i18n ids where possible (`@@editor.text.shadow*` may become `@@editor.shadow.*`).
- **Acceptance criteria:** `npx ng build` passes; text shadow checkbox, colour, opacity, blur, offsets
  look and work as before (incl. undo).
- **Notes:** Implemented as planned.
  - `core/models/shadow.ts` (`Shadow`); `TextShadow = Shadow` alias in `core/models/text.ts`.
  - `features/editor/shadow.ts`: pure `sameShadow` (moved from `text-props.ts`).
  - `features/editor/fields/shadow-fields.ts`: `SHADOW_LIMITS`, `ShadowFormValue`, `ShadowFormGroup`,
    `shadowFormGroup(fb, shadow)`, `toShadowFormValue` (opacity → `Math.round(opacity*1000)/10`),
    `shadowFromFormValue`, component `ShadowFields` (input `group`, output `committed`; shows the fields
    from the `valueChanges` of `enabled`). Reuse these in steps 2–3.
  - Shadow limits removed from `text-panel/text-limits.ts`; text panel uses `ShadowFields`.
  - i18n ids are now `@@editor.shadow.{enabled,color,opacityPercent,blurMm,offsetXMm,offsetYMm}`; no
    extracted message files exist in the repo.
  - Gotcha: an owner that resets the shadow group with `emitEvent: false` must then call
    `group.controls.enabled.updateValueAndValidity({ onlySelf: true })`, else the fields do not
    show/hide (done in the text panel).

### Step 2 — Collage default shadow: model, rendering, Appearance UI
- **Status:** done (reviewed 2026-11-14)
- **What:** `defaultShadow` in `CollageSettings`, `defaultCollageSettings`, `normalizeSettings`
  (+ `normalizeShadow`). `PhotoProps.shadow?: Shadow | null` type + `photo-shadow.ts` helpers.
  Scene carries `defaultShadow`; `PhotoView` two-group structure draws the effective shadow; check that
  drag, transformer, crop mode, swap pick and selection still work with the new structure (transformer
  and crop rects must ignore the shadow). Appearance section: `ShadowFields` for the default shadow
  below the border, with a hint text; emits `defaultShadowChange`; wired via
  `collage-settings-panel` to `update({ defaultShadow })`.
- **Acceptance criteria:** switching on the default shadow shows a shadow on all photos (also rotated
  ones; same light direction); values change the shadow; zoom keeps the mm size; PNG/JPG export shows
  the shadow; an old collage opens with shadow off; drag, resize/rotate, crop mode, swap work; undo of
  the setting works.
- **Notes:** Implemented as planned, plus live colour preview (decision log "Colour preview").
  - `core/models/collage.ts`: `defaultShadow` (default off, `#000000`, 0.4, blur 3, offset 1.5/1.5),
    `normalizeShadow`. `core/models/photo.ts`: `PhotoProps.shadow?: Shadow | null`.
  - `features/editor/photo-shadow.ts`: `effectiveShadow(props, defaultShadow)`,
    `hasShadowOverride(props)` (not used yet; for Step 3).
  - `canvas/scene.ts` has `defaultShadow`; filled in `editor-canvas.ts` and `page-image-renderer.ts`;
    `PhotoView.update(props, defaultBorder, defaultShadow)` (called by `collage-renderer.ts` on every
    render, no scene comparison).
  - `canvas/photo-view.ts`: outer `group` (no clip) → `shadowCaster` rect (`listening: false`, black
    fill, visible only if the effective shadow is enabled) + inner `content` group (frame clip) with
    image and border. Verified in Konva 10.9.1 source: Transformer (`shapes/Transformer.js` ~600) and
    crop mode use `getClientRect({ skipShadow: true })`; hit testing unaffected.
  - Appearance section: `ShadowFields` + hint `@@editor.settings.shadowHint` below the border block;
    outputs `defaultShadowChange`, `defaultShadowPreview` (picker colour); wired in
    `collage-settings-panel.html` to `update`/`preview({ defaultShadow })`. `ShadowFields` has output
    `colorPreview`.
  - Known visual effect (accepted, not changed): in crop mode the shadow is drawn over the
    semi-transparent full image around the frame.

### Step 3 — Per-photo shadow override and "Apply to all photos"
- **Status:** done (reviewed 2026-11-14)
- **What:** photo panel: checkbox "Use collage default shadow" + `ShadowFields` (prefilled with the
  default shadow when the override is switched on); output `shadowChange(Shadow | null)`. Store:
  `setPhotoShadow(id, shadow | null)`, `hasShadowOverrides`, `applyDefaultShadowToAll()`. Appearance:
  "Apply to all photos" button for the shadow (enabled only with overrides) + hint text.
- **Acceptance criteria:** own shadow on one photo; own shadow with "Shadow" off removes it for one
  photo while the default is on; "Apply to all photos" removes all own shadows; undo works; values
  survive reload.
- **Notes:** Implemented as planned.
  - `editor.store.ts`: `setPhotoShadow(id, Shadow | null)` (no-op if unchanged; helper
    `sameOptionalShadow` treats missing and `null` as equal), `previewPhotoShadow` (own preview signal,
    applied after the border preview, cleared in `clearPreviews()`), `hasShadowOverrides`,
    `applyDefaultShadowToAll()` (one undoable commit).
  - Photo panel: input `defaultShadow`, outputs `shadowChange(Shadow | null)`, `shadowPreview(Shadow)`;
    checkbox "Use collage default shadow" (`@@editor.photo.useDefaultShadow`) + hint, else
    `ShadowFields` (prefilled from the default; unchecking commits the shown values as own shadow).
  - Appearance: input `hasShadowOverrides`, output `applyShadowToAll`, button "Apply to all photos"
    (icon `shadow`, `@@editor.settings.applyShadowToAll`) + hint; CSS class `apply-border-button`
    renamed to `apply-to-all-button` (used by both buttons). Wired via `collage-settings-panel` and
    `editor.page.html`.
  - Save, undo/redo, move/resize and crop mode needed no change (full props copied/compared).

### Step 4 — Re-arrange keeps own border and shadow
- **Status:** done (reviewed 2026-11-14)
- **What:** re-arrange / re-roll keeps `border` and `shadow` of placed photos (merge in the store when
  applying arrangement frames, or equivalent); update the `arrangePhotos` doc comment. Swap keeps
  `shadow` with the photo (check `swap-frames.ts`).
- **Acceptance criteria:** a photo with own border and own shadow keeps both after re-arrange, re-roll,
  mode change and swap.
- **Notes:** Implemented as planned.
  - `editor.store.ts`: `arrangeAll` (used by `rearrange`, `rearrangeWith` = re-roll / mode change,
    and "Re-arrange" after import) passes the frames through the new pure function
    `keepLook(frames, photos)` (end of file): placed photos keep their whole `border` and their
    `shadow` (field stays absent if it was absent). Unplaced photos keep the defaults.
  - `arrangePhotos` (`arrange/arrange.ts`) unchanged in behaviour; doc comment updated. `applyFrames`
    unchanged (also used by swap and `placeBesidePage`).
  - Swap: no change needed (`inFrameOf` in `swap-frames.ts` spreads the old props).
  - Re-arrange confirm text unchanged (still correct: border/shadow are not layout).

### Step 5 — Documentation
- **Status:** done (reviewed 2026-11-14)
- **What:** `doc/architecture.md`: settings (`defaultShadow`), photo props (`shadow`), shared shadow
  type/component, re-arrange keeps border/shadow. Set this plan to done and move it to
  `doc/agent-plans/done/`.
- **Acceptance criteria:** developer reviews the docs.
- **Notes:** `doc/architecture.md`: `shadow.ts` in the models row, new row `features/editor/fields/`,
  paragraph "Photo look" under Data model (defaults, override rules, shared `Shadow`, re-arrange keeps
  border/shadow), domain term "Drop shadow (photo)". Plan moved to `doc/agent-plans/done/`.

## Open questions
- Known issue, older than this feature, not in scope: the canvas works on the photos with
  previews applied; a crop/move/resize while a colour picker is open can save the previewed border
  or shadow colour. Not fixed; developer to decide if it becomes its own task.

## Current state / Next action
All steps done (reviewed 2026-11-14). Feature complete. Nothing is committed (developer decides).
