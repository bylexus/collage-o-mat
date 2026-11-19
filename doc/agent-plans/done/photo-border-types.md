# Photo border types (colour, Polaroid, photo corners)

**Ticket/Source:** none (developer request, 2026-11-19; reference https://www.template.net/graphic-design/polaroid-sizes/)
**Branch:** none (work on `main`, not committed — developer decision)
**Status:** done

## Goal
A photo border is no longer only "width + colour". The user first selects a **border type**, then the
fields of that type:

- **None** — no border.
- **Colour** — the simple colour border of today (width + colour).
- **Polaroid** — a Polaroid-style card around the photo, from pre-defined Polaroid formats, scaled to
  the frame, with a selectable card colour (default white).
- **Photo corners** — four coloured triangles at the photo corners, like the sticky paper pockets that
  hold a photo in an album; selectable colour and size (fixed mm or relative to the frame).

This works for the collage default border (Appearance section of the settings panel) and for the own
border of a single photo (border popover of the selection toolbar).

## Scope
**In scope:**
- New border model (type + values of all types) for the collage default and the per-photo border.
- Shared border form component with a type select; used in Appearance and in the photo border popover.
- Rendering of all types on the canvas and in the PNG/JPG export.
- "Apply to all photos" and "Use collage default border" keep working.
- `doc/architecture.md` update.

**Out of scope:**
- Reading the old border format (see decision log: old values are dropped).
- Combining types (e.g. colour border + photo corners).
- Instax / other non-Polaroid formats; user-defined Polaroid formats.
- Moving the Polaroid thick border to another side; auto-rotation for landscape frames.
- Locking the frame aspect to the Polaroid format.
- Changing arrange, swap to know about the border. (Crop mode was changed for the Polaroid only,
  see decision log "Crop mode with a Polaroid border".)
- Configurable corner shadow, corner opacity.
- Backend changes (settings and photo props are opaque JSON for the backend).
- Automated tests.

## Rough Architecture / Concept
- **Model** (`frontend/src/app/core/models/collage.ts`):
  ```ts
  export type BorderType = 'none' | 'color' | 'polaroid' | 'corners';
  export type PolaroidFormat = 'p600' | 'go' | 'spectra';
  export type CornerSizeMode = 'fixed' | 'relative';
  export interface BorderSettings {
    type: BorderType;
    color: { widthMm: number; color: string };
    polaroid: { format: PolaroidFormat; color: string };
    corners: { color: string; sizeMode: CornerSizeMode; sizeMm: number; sizePercent: number };
  }
  ```
  All type values are stored, so switching the type back restores the old values (same pattern as
  `BackgroundSettings`). Defaults: `type: 'none'`, `color: { widthMm: 3, color: '#ffffff' }`
  (3 mm instead of today's 0, so "Colour" shows a border at once), `polaroid: { format: 'p600', color: '#ffffff' }`, `corners: { color: '#000000',
  sizeMode: 'relative', sizeMm: 10, sizePercent: 12 }`.
  Step 1 adds only `type` (`'none' | 'color'`) and `color`; step 2 adds `polaroid` (and the type
  value); step 3 adds `corners`.
- **Collage default:** `CollageSettings.defaultBorder: BorderSettings`. `normalizeBorder` returns the
  defaults if the raw value has no valid `type` (old format `{ widthMm, color }` → dropped, the collage
  shows no border); else it normalizes field by field (missing type values → defaults).
- **Per photo:** `PhotoProps.border?: BorderSettings | null` — missing or `null` = collage default,
  an object = a full own border (same pattern as `PhotoProps.shadow`). Photo props are not normalized
  on load, so `effectiveBorder(props, defaultBorder)` in `features/editor/photo-border.ts` uses the own
  border only if it is a valid new-format object (valid `type`, type values present); an old-format
  border (`{ widthMm, color }` with `null`s) is treated as "no own border". Helpers like
  `photo-shadow.ts`: `effectiveBorder`, `hasBorderOverride`, `sameBorder`. `arrange/frame.ts` sets
  no border (`null`), re-arrange and swap keep the own border with the photo (unchanged behaviour).
- **Pure geometry** (new file, e.g. `features/editor/border-geometry.ts`, no Konva): computes from the
  frame size and the effective border the inner image rect, the card/border fill and the corner
  triangles. `PhotoView` only applies the result to Konva nodes.
- **Rendering** (`features/editor/canvas/photo-view.ts`):
  - Colour: as today — filled rect of frame size, image frame size, clipped to the inner area.
  - Polaroid: scale `s = min(frameW / formatW, frameH / formatH)`; side, top and bottom border =
    `s ×` the format values; the thick border is always at the bottom edge of the frame (it rotates
    with the frame). The card is a filled rect of frame size in the Polaroid colour. The image is
    **cover-fitted** into the inner rect: the drawn source part is the centred sub-rect of the stored
    crop with the inner-rect aspect (stored crop unchanged; arrange, swap unchanged; crop mode
    lines up with the drawn image, see decision log).
  - Photo corners: 4 right-angled triangles at the frame corners, on top of the image; the two legs
    lie on the lines g = 2.5 % of the leg outside the frame edges (gap, see decision log "Corner
    gap"). Leg = `sizeMm` (fixed) or `sizePercent % × min(frameW, frameH)` (relative),
    clamped to `min(frameW, frameH) / 2`. Each triangle has a small fixed soft shadow (not
    configurable; blur and offset proportional to the leg length, e.g. blur ≈ 8 % of the leg, offset
    ≈ 3 % of the leg, opacity ≈ 0.35, black). Use Konva `Line` (closed) shapes. The shadow must not
    be cut off unexpectedly: it falls on the photo; since the corner gap the triangles are not
    clipped, so the frame does not cut the shadow. The image is not changed (full frame, no border inset).
  - The photo drop shadow (`shadowCaster`, frame size) stays as it is for all types.
  - The export (`canvas/page-image-renderer.ts`) uses `PhotoView`, so it gets all types automatically.
- **UI:** `features/editor/fields/border-fields.ts` becomes a form-group based component (like
  `shadow-fields.ts`: owner creates the group via a helper, e.g. `borderFormGroup(fb, defaults)`,
  `toBorderFormValue`, `borderFromFormValue`). It shows a `mat-select` "Border type" (None / Colour /
  Polaroid / Photo corners) and below it only the fields of the selected type:
  - Colour: width (length field, display unit) + colour (as today).
  - Polaroid: format select (Polaroid 600 / i-Type, Polaroid Go, Polaroid Spectra) + card colour.
  - Photo corners: colour + size mode select (Fixed / Relative to frame) + either size (length field,
    display unit) or size in %.
  Emits `committed` and a colour preview (as today). Used by
  `settings-panel/appearance-settings-section.ts` (collage default; "Apply to all photos" stays) and
  `photo-panel/photo-border-section.ts` ("Use collage default border" checkbox stays; unchecking
  starts the own border from the current default border).
- **Why:** follows existing patterns (background settings with a type and kept values; photo shadow
  with a full own override; shared field components), no backend change, no migration, no new
  library. Cover-fit for the Polaroid keeps the frame aspect free and avoids changes in crop mode,
  arrange, swap and resize.

## Polaroid format table (mm, W × H; approximations accepted by the developer)

| Key | Label | Card W × H | Image W × H | Sides | Top | Bottom |
|---|---|---|---|---|---|---|
| `p600` | Polaroid 600 / i-Type | 88 × 107 | 79 × 79 | 4.5 | 6 | 22 |
| `go` | Polaroid Go | 53.9 × 66.6 | 47 × 46 | 3.45 | 4.5 | 16.1 |
| `spectra` | Polaroid Spectra | 101 × 102 | 92 × 73 | 4.5 | 6 | 23 |

Only card size and the border values are used for drawing (image = rest). Spectra image size is from
memory (template.net says 73 × 73, which conflicts with "wide format"); exactness is not required.

## Limits
- Colour border width: `BORDER_WIDTH_LIMITS` 0–20 mm step 0.5 (as today).
- Corner size fixed: 2–40 mm step 0.5. Corner size relative: 5–40 % step 1.

## Context for a new agent
- **Sources read:**
  - `AGENTS.md`: no automated tests; verify with `npx ng build` (frontend) and give manual test steps;
    UI texts English with `i18n="@@<feature>.<key>"` / `$localize`; no new libraries; no commits.
  - `doc/architecture.md` "Data model" → "Photo look" paragraph describes `defaultBorder` + per-photo
    `border` (per-field `null` today) — must be updated.
  - `doc/agent-plans/done/photo-shadow.md`: the shadow override pattern (`photo-shadow.ts`,
    `effectiveShadow`, `hasShadowOverride`), the two-group structure in `PhotoView` (outer group not
    clipped for the drop shadow, inner `content` group clipped to the frame).
  - template.net Polaroid sizes page: 600/SX-70/i-Type 4.2 × 3.5 in (107 × 88 mm), image 79 × 79;
    Go 66.6 × 53.9, image 47 × 46; Spectra 103 × 101, image 73 × 73 (conflicting); no border split.
    Polaroid support page gives 600 image 78.94 × 76.80 (measured). Top/bottom split is not public.
- **Key files (under `frontend/src/app/`):**
  - `core/models/collage.ts` — `BorderSettings`, `defaultCollageSettings()` (`defaultBorder`),
    `normalizeSettings()`, `normalizeBorder()`.
  - `core/models/photo.ts` — `PhotoBorder` (old per-field type, to be replaced), `PhotoProps.border`.
  - `features/editor/photo-border.ts` — `inheritedBorder`, `hasBorderOverride`, `sameBorder` (to be
    rewritten like `photo-shadow.ts`).
  - `features/editor/fields/border-fields.ts` — `BorderFields`, `BORDER_WIDTH_LIMITS`.
  - `features/editor/fields/shadow-fields.ts` — pattern for a form-group based field component.
  - `features/editor/settings-panel/appearance-settings-section.ts` — default border form,
    `commitBorder`, `previewBorderColor`, "Apply to all photos".
  - `features/editor/settings-panel/collage-settings-panel.{ts,html}` — wiring to `update`/`preview`.
  - `features/editor/photo-panel/photo-border-section.{ts,html}` — per-photo border form.
  - `features/editor/toolbar/selection-toolbar.{ts,html}` — border popover (`photoBorder`),
    outputs `borderChange`, `borderPreview`.
  - `features/editor/editor.page.html` — wires `store.setPhotoBorder`, `store.previewPhotoBorder`,
    `store.applyDefaultBorderToAll`, `store.hasBorderOverrides`.
  - `features/editor/editor.store.ts` — `BorderPreview`, `previewPhotoBorder`, `setPhotoBorder`,
    `applyDefaultBorderToAll`, `hasBorderOverrides`, `withBorderPreview`, `applyFrames` (keeps
    `border`, `shadow`, `adjust`).
  - `features/editor/arrange/frame.ts` — `frameProps` sets `border: inheritedBorder()`.
  - `features/editor/swap-frames.ts` — border stays with the photo.
  - `features/editor/canvas/photo-view.ts` — `drawBorder`, `picture` clip, `update(props,
    defaultBorder, defaultShadow)`.
  - `features/editor/canvas/scene.ts`, `collage-renderer.ts`, `editor-canvas.ts`,
    `page-image-renderer.ts` — pass `defaultBorder` to the views.
- **Existing patterns to follow:** `BackgroundSettings` type select in
  `appearance-settings-section.ts`; `photo-shadow.ts`; `shadow-fields.ts`.
- **Commands:**
  - Host: `make dev-up && make dev-shell`
  - Container: `make backend-run` (Go :8080), `make frontend-serve` (ng serve :4200)
  - Verify: `cd frontend && npx ng build`
- **Environment:** a user (`collageomat user add`), a collage with several photos (local upload is
  enough).
- **Domain terms:** *frame* = rectangle of a photo on the page (centre, size, rotation, mm); *crop* =
  normalized part of the source image shown in the frame; *props* = per-photo JSON; *Appearance* =
  section of the collage settings panel; *photo corners* = the triangle border type.
- **External references:** https://www.template.net/graphic-design/polaroid-sizes/ ,
  https://support.polaroid.com/hc/en-us/articles/115012363647-What-are-Polaroid-photo-dimensions ,
  Konva `Line` (`closed: true`) and shadow attributes https://konvajs.org/api/Konva.Line.html .

## Decision log
- **Border types:** exclusive select None / Colour / Polaroid / Photo corners — *Rationale:* simple
  model and UI; "None" replaces "width 0". Rejected: no "None"; corners combinable with a base border.
- **Per-photo override:** full own border object, missing/`null` = collage default (like the shadow)
  — *Rationale:* per-field inheritance over 4 types is confusing. Rejected: per-field `null`.
- **Value shape:** values of all types are stored; switching type restores them — *Rationale:* same
  as `BackgroundSettings`. Rejected: discriminated union with only the active type.
- **Old format:** not supported. Old collage `defaultBorder` → defaults (type `none`); old per-photo
  borders → ignored (= collage default). Users re-define borders once — *Rationale:* developer
  decision (2026-11-19): only test collages exist.
- **Polaroid fit:** scale `s = min(frameW/formatW, frameH/formatH)`, image cover-fitted into the inner
  area — *Rationale:* free frame aspect, no change in crop/arrange/swap. Rejected: clip like the colour
  border (hides the lower part of the photo); lock frame aspect (large change).
- **Colour border fit:** unchanged (image frame size, clipped) — *Rationale:* no visible change, no
  scope creep.
- **Polaroid formats:** 600 / i-Type, Go, Spectra with the table above; approximations are fine —
  *Rationale:* developer choice; exact top/bottom values are not public. Rejected: Instax formats.
- **Polaroid colour:** selectable, default white.
- **Polaroid on landscape frames:** thick border always at the bottom of the frame. Rejected:
  auto-rotate, user option.
- **Corner size:** mode select Fixed (mm, 2–40) / Relative (% of the shorter frame side, 5–40); both
  values stored, only the active field shown. Rejected: one mm value + "scale" checkbox.
- **Corner look:** solid colour (default black) + small fixed soft shadow. Rejected: flat only;
  opacity setting.
- **Corner gap:** (developer decision, 2026-11-19) the triangles have a small gap to the photo, like
  an album photo-corner pocket that is a bit larger than the photo: g = 2.5 % of the (clamped) leg (first 5 %, reduced to 2.5 % after the live test: too much offset), not
  configurable (`CORNER_GAP_RATIO`). The photo stays full frame; the triangles move out by g (the
  right-angle corner is the frame corner moved out by g in both directions, the legs lie g outside the
  frame edges), so they stick out of the frame and the page background shows in the gap. They and
  their shadow are not clipped by the frame. Rejected: inset the photo by g inside the frame.
- **Selection = frame:** (developer decision, 2026-11-19) with photo corners the selection box,
  handles, resize snapping, resize scaling and the toolbar position use the frame only, as for all
  other border types; the corners outside the frame and all shadows are left out. Done by a photo
  group subclass that reports the frame as its client rect while corners are visible. Rejected:
  selection box including the sticking-out corners.
- **Crop mode with a Polaroid border:** align crop mode (developer decision, 2026-11-19): ghost
  image, pan and wheel zoom anchor use the placement of the drawn image (Polaroid inner area, cover
  part of the crop), so the user crops exactly what is visible (WYSIWYG). The stored crop semantics
  stay (crop has the frame aspect; `PhotoView` draws its centred cover part). Outline = image area
  (inner area with a Polaroid, frame otherwise). — *Rationale:* WYSIWYG cropping. Rejected: hide the
  Polaroid layout in crop mode (image at frame size); accept the misalignment as is.
- **Workflow:** work on `main`, no feature branch; all steps in sub-agents without review stops; plan
  stays `in progress` until the developer has tested live.
- **Testing:** no automated tests (AGENTS.md); `npx ng build` + manual test by the developer.

## Testing strategy
No automated tests. After each step: `cd frontend && npx ng build` must pass. The developer tests all
steps live at the end with the manual test steps below.

## Steps

### Step 1 — New border model and type select (None + Colour)
- **Status:** done (reviewed 2026-11-19, developer live test passed)
- **What:** `BorderSettings` with `type` (`'none' | 'color'`) and `color` values; `normalizeBorder`
  drops the old format; `PhotoProps.border?: BorderSettings | null`, remove `PhotoBorder`;
  `photo-border.ts` rewritten (`effectiveBorder` with shape check, `hasBorderOverride`,
  `sameBorder`); store, toolbar, page, frame, swap adapted; `BorderFields` with type select + colour
  fields; Appearance and photo border popover use it; `PhotoView.drawBorder` uses the effective
  border and draws nothing for `none`; pure border geometry file introduced;
  `doc/architecture.md` "Photo look" updated.
- **Acceptance criteria:** Appearance shows "Border type" with None / Colour; Colour shows width and
  colour; canvas and export look like before for colour borders; per photo: "Use collage default
  border" off → type select + fields, own border kept after re-arrange and swap; "Apply to all
  photos" removes own borders; an old collage opens without error and shows no borders.
- **Notes:**
  - `core/models/collage.ts`: `BorderType`, `BORDER_TYPES`, `ColorBorderSettings`, `BorderSettings
    { type; color }`; default `{ type: 'none', color: { widthMm: 3, color: '#ffffff' } }`;
    `normalizeBorder` returns a copy of the defaults without a valid `type`, else normalizes
    `color.widthMm` / `color.color` field by field.
  - `core/models/photo.ts`: `PhotoBorder` removed; `PhotoProps.border?: BorderSettings | null`.
  - `features/editor/photo-border.ts` (rewritten): `effectiveBorder`, `hasBorderOverride(props)`,
    `ownBorder(props)` (own border or `null`), `sameBorder`, `sameOptionalBorder`; private shape
    check `isBorderSettings` (+ `isColorBorder`). Step 2/3: extend `sameBorder` and the shape check
    with the new sub-objects.
  - `features/editor/border-geometry.ts` (new, no Konva): `BorderLayout { fill: string | null;
    inner: Rect }`, `borderLayout(border, widthMm, heightMm)` with a `switch` on the type. Step 2/3:
    add fields (e.g. image rect for cover-fit, triangles) and cases.
  - `canvas/photo-view.ts`: `drawBorder` uses `effectiveBorder` + `borderLayout`; before the first
    `update` the fallback is the default border (type `none`). Colour look unchanged (fill rect of
    frame size, image frame size clipped to `inner`).
  - `fields/border-fields.ts` (rewritten, form-group based): `BorderFormGroup` (`type` + one
    sub-group per type, same shape as `BorderSettings`), `borderFormGroup(fb, border)`,
    `toBorderFormValue`, `borderFromForm(group, fallback)` (returns `null` if the fields of the
    selected type are invalid; invalid values of a hidden type come from `fallback`),
    `borderWithPreviewColor(group, fallback, color)`; `BORDER_TYPE_OPTIONS` list (`$localize`
    labels) for the `mat-select`; outputs `committed` and `colorPreview` (string, owners build the
    preview border). `BORDER_WIDTH_LIMITS` unchanged.
  - New i18n ids: `editor.border.type`, `editor.border.typeNone`, `editor.border.typeColor`,
    `editor.border.width` ("Width"), `editor.border.color` ("Colour"). The old ids
    `editor.settings.borderWidth` / `editor.settings.borderColor` are no longer used.
  - `settings-panel/appearance-settings-section.ts`: form control `border` (border form group);
    `commitBorder` / `previewBorderColor` use `borderFromForm` / `borderWithPreviewColor` with the
    input `defaultBorder()` as fallback. "Apply to all photos" unchanged.
  - `photo-panel/photo-border-section.{ts,html}`: same structure as `photo-shadow-section`
    (`useDefault` + `border` group, `BorderFormState`); outputs `borderChange: BorderSettings | null`,
    `borderPreview: BorderSettings`; unchecking commits the shown border (= current default).
  - `editor.store.ts`: `BorderPreview.border: BorderSettings | null`; `setPhotoBorder(id, border |
    null)` compares with `sameOptionalBorder(ownBorder(props), border)`; `applyDefaultBorderToAll`
    sets `border: null`; `keepLook` keeps `border` only if defined (like `shadow`).
  - `toolbar/selection-toolbar.ts`: output types. `arrange/frame.ts`: `border: null`.
    `swap-frames.ts` unchanged (spreads the props, the border stays). `collage-settings-panel`,
    `editor.page.html`, `scene.ts`, renderers: no change needed.
  - `doc/architecture.md`: "Photo look" paragraph and `fields/` table row updated.
  - Small decision: an own border of type `none` is a valid override (a photo without border in a
    collage with a default border).
  - `npx ng build` passes without warnings; changed files formatted with Prettier.

### Step 2 — Polaroid border
- **Status:** done (reviewed 2026-11-19, developer live test passed)
- **What:** type `polaroid`, `polaroid` values, format table, geometry (scale + cover-fit), rendering
  in `PhotoView`, fields (format select + card colour, colour preview).
- **Acceptance criteria:** Polaroid look on canvas and in the export, thick border at the bottom;
  photo fills the inner area without distortion for portrait, square and landscape frames; format
  and colour change the look; values of other types kept when switching type.
- **Notes:**
  - `core/models/collage.ts`: `BorderType` + `BORDER_TYPES` include `'polaroid'`; new
    `PolaroidFormat`, `POLAROID_FORMATS`, `PolaroidBorderSettings { format; color }`;
    `BorderSettings.polaroid`; default `{ format: 'p600', color: '#ffffff' }`; `normalizeBorder`
    normalizes `polaroid.format` (must be a known format) and `polaroid.color` field by field.
  - `features/editor/photo-border.ts`: `sameBorder` compares `polaroid.format` / `polaroid.color`;
    shape check `isBorderSettings` also needs a valid `polaroid` sub-object (`isPolaroidBorder`).
    Consequence: an own border saved by step 1 (no `polaroid`) counts as no own border (old format
    is not supported, see decision log).
  - `features/editor/border-geometry.ts`: `POLAROID_FORMAT_SIZES` (card W/H, side, top, bottom in mm,
    the plan table); `BorderLayout` got `image: Rect` (where the image is drawn) and `cover: boolean`;
    `borderLayout` case `polaroid` (private `polaroidInner`: scale `s`, borders `s ×` format values,
    thick border at the bottom, inner = frame minus borders; `fill` = card colour, `image` = inner,
    `cover: true`); `none`/`color` return `image` = frame, `cover: false` (look unchanged). New pure
    `coverPart(crop, width, height)`: centred largest part of a source-px crop with the target aspect.
  - `canvas/photo-view.ts`: frame size is kept in `frameWidthMm`/`frameHeightMm` (the `widthMm`/
    `heightMm` getters no longer read the image size, because the image has the inner size with a
    Polaroid); `drawBorder` stores the layout and sets image position/size to `layout.image`;
    `showProps` now calls `drawBorder` before `showCrop`; `applySource` draws `coverPart(...)` of the
    crop when `layout.cover`. The card rect listens, so clicks on the card select the photo. Shadow
    caster unchanged (frame size). Export (`page-image-renderer.ts`) uses `PhotoView.update`, so it
    gets the Polaroid look with no change.
  - `fields/border-fields.ts`: option "Polaroid" (`@@editor.border.typePolaroid`); form sub-group
    `polaroid { format, color }`; `toBorderFormValue`, `borderFromForm` (invalid `polaroid` → from
    `fallback`), `borderWithPreviewColor` case `polaroid`; template: "Format" select
    (`@@editor.border.polaroidFormat`; options `@@editor.border.polaroidP600` "Polaroid 600 / i-Type",
    `@@editor.border.polaroidGo` "Polaroid Go", `@@editor.border.polaroidSpectra` "Polaroid Spectra")
    + `ColorField` "Card colour" (`@@editor.border.polaroidColor`) with colour preview. Owners
    (Appearance, photo border popover) needed no change.
  - `doc/architecture.md` "Photo look" paragraph updated.
  - Crop mode alignment (added after the developer decision, see decision log):
    - `canvas/photo-view.ts`: new accessor `imageLayout()` → `{ image, cover }` of the stored border
      layout (fallback before the first `showProps`: frame, `cover: false`).
    - `canvas/crop-mode.ts`: new private `sourcePlacement(session, crop)`: the whole source image in
      frame-local mm, so that the drawn part (the crop, or with `cover` its `coverPart` with the
      image-area aspect, computed in source px from `session.image`) fills `imageLayout().image`.
      `drawOverlay` places the ghost image at it; the outline is the image area (frame offset minus
      `image.x/y`, image size). `onPanMove` calls `panCrop` with the crop size in mm of that
      placement (`placement.width × startCrop.width`, same for y), so the image moves 1:1 with the
      pointer. `handleWheel` keeps the frame hit test (wheel over the card also zooms) and computes
      the anchor as the source point under the pointer, normalized in the crop (`zoomCrop` clamps it
      to 0..1). Slider anchor (crop centre) unchanged; zoom value (`zoomOf`) unchanged.
    - None / colour / corners: `image` = frame and `cover: false`, so placement, pan, anchor and
      outline are mathematically the same as before (colour border: image frame size, clipped, and
      outline on the frame, unchanged).
  - During a transformer resize the group is scaled, so the card borders stretch until the resize is
    committed (same behaviour as the colour border).
  - `npx ng build` passes without warnings; changed files formatted with Prettier.

### Step 3 — Photo corners
- **Status:** done (reviewed 2026-11-19, developer live test passed)
- **What:** type `corners`, `corners` values, triangle geometry (fixed / relative, clamped),
  triangles with small shadow in `PhotoView`, fields (colour, size mode, size mm or %).
- **Acceptance criteria:** four triangles at the frame corners on canvas and in the export, with a
  small shadow; fixed size stays the same mm on frames of different size; relative size scales with
  the frame; clicks on a triangle select the photo.
- **Notes:**
  - `core/models/collage.ts`: `BorderType` + `BORDER_TYPES` include `'corners'`; new
    `CornerSizeMode`, `CORNER_SIZE_MODES`, `CornersBorderSettings { color; sizeMode; sizeMm;
    sizePercent }`; `BorderSettings.corners`; default `{ color: '#000000', sizeMode: 'relative',
    sizeMm: 10, sizePercent: 12 }`; `normalizeBorder` normalizes the four values field by field.
  - `features/editor/photo-border.ts`: `sameBorder` compares the four corner values; the shape check
    also needs a valid `corners` sub-object (`isCornersBorder`). Consequence (same as step 2): an own
    border saved by step 1 or 2 (no `corners`) counts as no own border.
  - `features/editor/border-geometry.ts`: `BorderLayout.corners: CornersLayout | null` (`color`,
    clamped `legMm`, four `triangles` as flat point lists, first point = frame corner); exported pure
    `cornerLegMm` (fixed: `sizeMm`; relative: `sizePercent / 100 × min(w, h)`; clamped to
    0 … `min(w, h) / 2`); case `corners`: no fill, `inner` = `image` = frame, `cover: false` (image as
    with `none`). Other types: `corners: null`.
  - `canvas/photo-view.ts`: four closed `KonvaLine` (import `konva/lib/shapes/Line`) added to the
    clipped `content` group after `picture` (on top of the image); they listen, so a click selects
    the photo. `drawBorder` calls new `drawCorners`, which hides them without corners or with leg 0.
    Shadow constant `CORNER_SHADOW`: black, opacity 0.35, blur 8 % of the leg, offset 3 % of the leg
    to the right and down. Decision: down-right (not toward the photo centre), same light direction
    as the photo drop shadow; the offset is in world direction (Konva does not rotate shadow
    offsets). The frame clip cuts the shadow parts outside the frame (accepted in the plan). Export
    (`page-image-renderer.ts`) uses `PhotoView`, no change needed.
  - `fields/border-fields.ts`: `CORNER_SIZE_LIMITS` next to `BORDER_WIDTH_LIMITS` (`sizeMm` 2–40
    step 0.5, `sizePercent` 5–40 step 1, no integer check); option "Photo corners"; form sub-group
    `corners { color, sizeMode, sizeMm, sizePercent }`; `borderFromForm` for type `corners` checks
    only the colour and the size field of the selected mode; corner values are taken value by value
    from `fallback` when invalid (private `cornersFromForm`), so an invalid hidden size field does not
    block saving; `borderWithPreviewColor` case `corners`. Template: row "Size mode" select + colour
    field (preview), then either `app-length-field` "Size" (display unit) or `app-number-field`
    "Size (%)"; new `sizeMode` signal follows the `sizeMode` control. Owners needed no change.
  - New i18n ids: `editor.border.typeCorners` ("Photo corners"), `editor.border.cornerSizeMode`
    ("Size mode"), `editor.border.cornerSizeFixed` ("Fixed"), `editor.border.cornerSizeRelative`
    ("Relative to frame"), `editor.border.cornerColor` ("Colour"), `editor.border.cornerSize`
    ("Size"), `editor.border.cornerSizePercent` ("Size (%)").
  - `doc/architecture.md` "Photo look" paragraph updated.
  - `npx ng build` passes without warnings; changed files formatted with Prettier.
  - Corner gap (2026-11-19, see decision log "Corner gap"): `border-geometry.ts` exports
    `CORNER_GAP_RATIO = 0.025` (g = ratio × clamped leg); the first point of each triangle is the frame corner moved out by g (e.g. top-left `(-g, -g)`), the legs lie on the
    lines g outside the frame edges. `canvas/photo-view.ts`: the four corner lines moved from the
    clipped `content` group into the outer `group`, above `content` (same z-order as before); they
    still listen; the frame clip no longer cuts them or their shadow. Crop mode (`imageLayout`,
    `toLocal`, `contains`) and the export (`page-image-renderer.ts`) need no change.
  - Selection = frame (2026-11-19, see decision log): Konva ignores clips in `getClientRect`, so
    the sticking-out corners made the photo group bounds g larger on each side (transformer box and
    handles outside the frame, resize snapping on the box edge, `bottomCentreOf` g lower). Fix in
    `canvas/photo-view.ts`: the outer group is a module-private `PhotoGroup extends Konva.Group`
    with `frameBounds: IRect | null`; `getClientRect` returns `frameBounds` (frame-local, with
    `skipTransform`) or `_transformedRect(frameBounds, relativeTo)`, else Konva's own result
    (`frameBounds` null, or `_forDrawing` measuring for isolated-group drawing). `drawCorners` sets
    `frameBounds` to the frame while corners are visible, else `null`, so the other border types are
    unchanged. Checked: the Konva `Transformer` measures groups on each update (no bounds cache for
    groups); hit testing, drag and drag snapping (`frameBox()`) do not use `getClientRect`; the app
    calls no `cache` / `toCanvas` / `toDataURL` on photo groups; only one node is selected at a time.

## Open questions
- None.

## Current state / Next action
Done (2026-11-19). All steps (1–3), the crop-mode alignment for the Polaroid and the photo-corner gap
(2.5 % of the leg) and frame-only selection are implemented and passed the developer's live test.
`npx ng build` passes. The developer commits the changes. No next action.
