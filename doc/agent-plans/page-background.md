# Page background types

**Ticket/Source:** Backlog of `doc/agent-plans/done/poc-implementation.md` (requested by the developer 2026-11-13)
**Branch:** none
**Status:** done

## Goal

The page background of a collage is more than a solid colour. The user chooses between
- **colour**: a solid colour (as before),
- **gradient**: 2 colours, linear (angle) or radial (from the page centre),
- **image**: one of the collage photos covers the page, dimmed by an overlay colour with an opacity.

The background looks the same in the editor canvas and in the exported PNG/JPG.

## Scope

**In scope:**
- New settings object `settings.background` with the three types; migration of the old
  `settings.backgroundColor`.
- Rendering in the editor canvas and in the export (one shared Konva view).
- Appearance section UI: type select, fields per type, live preview for colours and the overlay opacity.
- Photo panel: button "Use as background" for the selected photo.

**Out of scope (decided):**
- Blur of the background image.
- Image fit other than cover (no contain / stretch / tile, no focus point / position).
- Adjustable radial centre or radius; more than 2 gradient colours.
- A separate Immich import or a local upload only for the background image (the background is always a
  photo that is already in the collage).
- Higher-resolution background images: the export uses the stored file (~1440 px Immich preview).
- Excluding the background photo from the page / arrangement (see decision "Background photo is shared").
- Backend changes (none needed).

## Rough Architecture / Concept

- **Data:** `CollageSettings.background` (frontend-owned JSON in `collages.settings`) replaces
  `backgroundColor`. It keeps the values of all three types; `type` selects what is drawn:
  ```ts
  export type BackgroundType = 'color' | 'gradient' | 'image';
  export type GradientKind = 'linear' | 'radial';
  export interface BackgroundSettings {
    type: BackgroundType;
    /** Solid colour; also drawn under the image (visible while loading or without a photo). */
    color: string;
    gradient: { kind: GradientKind; from: string; to: string; /** CSS convention */ angleDeg: number };
    image: { photoId: number | null; overlayColor: string; /** 0..100 */ overlayOpacityPercent: number };
  }
  ```
  Defaults: `{ type: 'color', color: '#ffffff', gradient: { kind: 'linear', from: '#ffffff', to: '#000000',
  angleDeg: 180 }, image: { photoId: null, overlayColor: '#000000', overlayOpacityPercent: 0 } }`.
  `normalizeSettings` migrates: if `background` is missing (or wrongly typed) and the old string
  `backgroundColor` exists, it becomes `background.color`. `backgroundColor` is dropped from the settings.
- **Rendering:** new `frontend/src/app/features/editor/canvas/page-background-view.ts`
  (`PageBackgroundView`, plain class, one Konva group: base colour rect, gradient rect or image, overlay
  rect). `CollageRenderer` (editor) and `page-image-renderer.ts` (export) both use it — same pattern as
  `PhotoView`, so editor and export are identical. Pure helper
  `frontend/src/app/features/editor/geometry/gradient.ts`: CSS angle + page size → linear start/end points
  (gradient line covers the page like CSS); radial: centre = page centre, radius = distance to the farthest
  corner. The image uses `coverCrop` from `geometry/crop.ts`.
- **Scene:** `Scene.backgroundColor` → `Scene.background` (the `BackgroundSettings` plus, if the type is
  `image` and the photo exists, its file URL and pixel size). Editor: the image comes from the renderer's
  `ImageCache`. Export: the background photo is loaded together with the photo images (`ExportError('imageLoad')`
  on failure).

**Why:** no backend change (settings JSON is frontend-owned, the background image is an existing stored
photo file served by `photoFileUrl`); one rendering class for editor and export avoids two renderers that
must give the same result (a PoC architecture rule); keeping all type values makes switching the type
lossless.

## Context for a new agent

- **Sources read:**
  - `doc/agent-plans/done/poc-implementation.md`: architecture conventions (frontend owns geometry and
    rendering; backend only stores JSON settings and checks ownership; one API service per resource;
    presentational components with `input()`/`output()`; signals; all UI texts with i18n ids
    `@@<feature>.<key>`, English only); data model (`collages.settings` JSON, `photos` rows with stored
    files `data/photos/<collageId>/<photoId>.<ext>`, Immich previews ~1440 px, JPEG/WebP).
  - `doc/agent-plans/local-upload-connector.md`: local upload is not built yet (planning only) → not usable
    as background source.
- **Key files and directories (frontend: `frontend/src/app/`):**
  - `core/models/collage.ts` — `CollageSettings`, `defaultCollageSettings()`, `normalizeSettings()` (merges
    each field with defaults; helpers `asRecord`, `stringOr`, `numberOr`, `nullableNumberOr`, `oneOf`).
  - `core/models/photo.ts` — `Photo`, `photoFileUrl(collageId, photoId)`.
  - `features/editor/canvas/scene.ts` — `Scene` (renderer input), `scenePhotos()`.
  - `features/editor/canvas/editor-canvas.ts` — builds the `Scene` in a `computed` (around line 190, today
    `backgroundColor: settings.backgroundColor`).
  - `features/editor/canvas/collage-renderer.ts` — `pageRect` (a `KonvaRect`, fill = `scene.backgroundColor`
    in `render()`); `ImageCache` keyed by photo id (`images`), `onImageLoaded`.
  - `features/editor/canvas/page-image-renderer.ts` — export: `exportScene()`, `loadPhotoImages()`,
    `drawScene()` draws its own background rect today.
  - `features/editor/canvas/photo-view.ts` — pattern for a Konva view class used by editor and export.
  - `features/editor/canvas/image-cache.ts` — `ImageCache` (keyed by photo id), `loadImage(url)`.
  - `features/editor/geometry/crop.ts` — `coverCrop(...)`, `fullCrop()`.
  - `features/editor/settings-panel/appearance-settings-section.ts` — background colour field
    (`ColorField`, outputs `backgroundColorChange`, `backgroundColorPreview`), default border.
  - `features/editor/settings-panel/collage-settings-panel.html` / `.ts` — wires the section:
    `update({...})` commits a settings change, `preview({...})` sets a live preview
    (`EditorStore.previewSettings` → `displayedSettings`).
  - `features/editor/fields/color-field.ts` (native colour picker: `previewed` on input, `committed` on
    change), `fields/number-field.ts` (number field, `committed` on change), `shared/number-limits.ts`
    (`limitValidators`).
  - `features/editor/canvas/crop-mode-controls.ts` — pattern for a `mat-slider` with live value + commit on
    release.
  - `features/editor/photo-panel/photo-properties-panel.{ts,html}` — panel of the selected photo (border,
    z-order, delete); place of the "Use as background" button.
  - `features/editor/editor.store.ts` — `updateSettings()`, `previewSettings()`, `deletePhoto()` (resets
    `settings.center.centerPhotoId` of a deleted photo with `autoSaver.schedule()`, no undo step — same
    pattern for `background.image.photoId`).
- **Existing patterns to follow:** `PhotoView` (view class shared by editor and export), `ColorField` live
  preview, `crop-mode-controls.ts` slider, `normalizeSettings` field-by-field merge, `centerPhotoId` reset on
  delete.
- **Commands** (in the dev container, `make dev-up && make dev-shell`, or on the host in `frontend/`):
  - `cd frontend && npx ng build` — must pass after every step.
  - `make backend-run` (:8080) + `make frontend-serve` (:4200) — manual test at `http://localhost:4200`.
- **Environment / prerequisites:** a user (`make user-add USERNAME=... ADMIN=1`), an Immich connector and a
  collage with imported photos for testing. Sandbox notes (agents on the host): the developer's dev container
  may already use `:8080`/`:4200`; stop own servers with `lsof -ti tcp:<port> | xargs kill`.
- **Konva notes (konva 10.9.1):** a `Rect` with gradient attributes still draws `fill` unless
  `fillPriority` is set (`'color' | 'linear-gradient' | 'radial-gradient' | 'pattern'`). Linear:
  `fillLinearGradientStartPoint`, `fillLinearGradientEndPoint`, `fillLinearGradientColorStops: [0, from, 1, to]`.
  Radial: `fillRadialGradientStartPoint`/`EndPoint` (both = centre), `fillRadialGradientStartRadius: 0`,
  `fillRadialGradientEndRadius`, `fillRadialGradientColorStops`.
- **Domain terms:** *page* = the printable area (mm, origin top-left); *frame* = the placed rectangle of a
  photo; *Appearance* = settings panel section with background and default border; *bg photo* = the photo
  referenced by `background.image.photoId`.
- **External references:** CSS `linear-gradient` angle convention (0deg = towards top, 90deg = towards
  right, 180deg = towards bottom; gradient line length = `|w·sin a| + |h·cos a|`):
  https://developer.mozilla.org/en-US/docs/Web/CSS/gradient/linear-gradient

## Decision log

- **Image source:** one of the collage photos (existing `photos` row) — *Rationale:* no backend change,
  import dialog reused, export uses the same stored file. Rejected: separate Immich import (backend flag or
  separate storage needed), local upload (connector not built yet).
- **Background photo is shared:** the bg photo stays a normal frame on the page, and arrangement / swap /
  centre photo treat it as before — *Rationale:* simplest code; the developer accepted that a
  "background-only" photo is not stable (re-arrange puts it back on the page; deleting the photo removes the
  background image). Rejected: exclusive (photo leaves page and arrangement), shared + toggle.
- **Choosing the bg photo:** button "Use as background" in the photo panel of the selected photo (sets
  `type = 'image'` and `image.photoId`); Appearance has the type select and the image fields. Rejected:
  thumbnail picker grid in Appearance.
- **Gradient:** linear and radial, exactly 2 colours (From, To). Linear: angle number field 0–359°, CSS
  convention (0° = towards top, 180° = top→bottom, default 180°), gradient line covers the page like CSS.
  Radial: fixed centre = page centre, From at the centre, To at the farthest corner (like CSS
  `radial-gradient(circle farthest-corner)`), no extra fields. Rejected: angle presets, adjustable centre /
  radius.
- **Image fit:** cover only, centred (`coverCrop`) — *Rationale:* simplest; no extra field. Rejected:
  contain/stretch select, focus point.
- **Dimming:** overlay colour + opacity 0–100 % (default `#000000`, 0 %). No blur.
- **Data model:** one object keeps the values of all types; `type` selects — *Rationale:* switching back
  restores earlier values. Rejected: discriminated union with reset on type change.
- **Missing image:** `background.color` is always drawn first (under the image), so it shows while the image
  loads, without a photo, or if the photo is gone; the overlay is drawn in all these cases too. Deleting the
  bg photo sets `image.photoId = null` (saved, no undo step, like `centerPhotoId`); the type stays `image`.
  Export with type `image` and no photo = colour + overlay. Rejected: switching the type back to colour.
- **Inputs / live preview:** all colour pickers with live preview (as today); overlay opacity as `mat-slider`
  0–100 % with live preview while dragging and commit on release; angle as number field, commit on change, no
  live preview.
- **Image UI in Appearance:** small thumbnail (`photoFileUrl`) of the bg photo + [Remove image] button
  (`photoId = null`). Without a photo: hint "Select a photo on the page and click "Use as background"".
  Photo panel: if the selected photo is already the bg photo (and type is `image`), the button is disabled
  and reads "Background image". Rejected: hint text only.
- **Testing:** manual review only.

## Testing strategy

No automated tests, manual review per step. `cd frontend && npx ng build` must pass after each step.

## Steps

### Step 1 — Data model, migration, shared background view (colour only)
- **Status:** done (reviewed 2026-11-13)
- **What:**
  - `core/models/collage.ts`: `BackgroundType`, `GradientKind`, `GradientSettings`, `ImageBackgroundSettings`,
    `BackgroundSettings`, `BACKGROUND_TYPES`, `GRADIENT_KINDS`; `CollageSettings.background` replaces
    `backgroundColor`; defaults as in "Rough Architecture"; `normalizeBackground()` in `normalizeSettings`
    with the migration of the old `backgroundColor` string.
  - `canvas/scene.ts`: `Scene.background` (type `SceneBackground` = `BackgroundSettings` + optional
    `image: { url, image: ImageSize }` of the bg photo) replaces `backgroundColor`.
  - `canvas/page-background-view.ts`: `PageBackgroundView` with `group` and `update(page, background)`;
    in this step it draws only the colour rect (all types draw `color`).
  - `collage-renderer.ts` uses the view instead of `pageRect`; `page-image-renderer.ts` uses it instead of
    its own rect; `editor-canvas.ts` builds `Scene.background`.
  - Appearance colour field reads/writes `background.color` (outputs adapted in
    `collage-settings-panel.html`).
- **Acceptance criteria:** an existing collage (saved with `backgroundColor`) opens with the same colour;
  colour change with live preview works; reload keeps it; export PNG has the colour; `npx ng build` passes.
- **Notes:** implemented 2026-11-13 (developer asked to implement all steps without a review gate; manual
  review pending). Deviation: the scene field for the bg photo file is `SceneBackground.imageFile?: { url,
  image: ImageSize }` (not `image`, which clashes with `BackgroundSettings.image`). `normalizeBackground`
  with sub-helpers in `collage.ts`; `collage-settings-panel.ts` has `updateBackgroundColor` /
  `previewBackgroundColor` (spread `{ ...background, color }`). The appearance section keeps its
  `backgroundColor` input/outputs and i18n id.

### Step 2 — Gradient
- **Status:** done (reviewed 2026-11-13)
- **What:**
  - `geometry/gradient.ts`: pure functions for linear start/end points (CSS angle, page size) and radial
    centre/radius.
  - `PageBackgroundView` draws the gradient for `type = 'gradient'` (`fillPriority`).
  - Appearance: type select (Colour / Gradient; Image follows in step 3), kind select (Linear / Radial),
    From / To colour fields with live preview, angle number field (0–359, integer, only for linear).
- **Acceptance criteria:** linear at 0°/90°/180°/270° goes towards top/right/bottom/left (as CSS); 45° on a
  non-square page matches CSS `linear-gradient(45deg, ...)`; radial: From at the centre, To at the corners;
  switching the type keeps the gradient values; undo/redo; reload; export identical to the canvas.
- **Notes:** implemented 2026-11-13. `geometry/gradient.ts`:
  `linearGradientLine(page, angleDeg)`, `radialGradientCircle(page)`. `PageBackgroundView` has a separate
  gradient rect above the colour rect (visible only for type `gradient`, explicit `fillPriority`).
  `settings-limits.ts`: `gradientAngleDeg` (0–359 integer). Appearance section now has input `background`
  and outputs `backgroundChange` / `backgroundPreview` (full `BackgroundSettings`); step 1 helpers in
  `collage-settings-panel.ts` removed. An invalid angle blocks every background commit (field marked
  touched, like `commitBorder`); previews use the last valid angle. New i18n ids
  `@@editor.settings.{backgroundType,backgroundTypeColor,backgroundTypeGradient,gradientKind,gradientKindLinear,gradientKindRadial,gradientFrom,gradientTo,gradientAngleDeg}`.

### Step 3 — Image background
- **Status:** done (reviewed 2026-11-13)
- **What:**
  - Photo panel: "Use as background" button → store sets `background.type = 'image'` and
    `image.photoId` (one undo step); disabled and labelled "Background image" if the selected photo is
    already the bg photo with type `image`.
  - Appearance: type `Image` in the select; thumbnail + [Remove image] (`photoId = null`) or the hint
    without a photo; overlay colour field (live preview); opacity `mat-slider` 0–100 % (live preview,
    commit on release).
  - `editor-canvas.ts`: `Scene.background.image` from the bg photo (`photoFileUrl`, pixel size) if it exists.
  - `PageBackgroundView`: colour rect, then the image (cover crop with `coverCrop`), then the overlay rect
    (`overlayColor`, opacity = percent / 100). Editor gets the image from `ImageCache` (redraw on load);
    export loads it with the photo images (`ExportError('imageLoad')` on failure).
  - `EditorStore.deletePhoto`: resets `background.image.photoId` of a deleted bg photo (saved, no undo step).
- **Acceptance criteria:** "Use as background" shows the photo covering the page, cropped centred; the frame
  of the photo stays on the page; overlay colour + opacity dim it live; switching types keeps the image
  settings; [Remove image] → colour + overlay; delete the bg photo → colour + overlay, reload keeps it;
  undo/redo; export identical to the canvas.
- **Notes:** implemented 2026-11-13. `scene.ts`: `sceneBackground(background,
  photos, collageId)` (shared by `editor-canvas.ts` and the export; uses all photos, placed or not).
  `PageBackgroundView`: colour rect → gradient rect → Konva Image (centred `coverCrop`, `setImage`) →
  overlay rect (hidden at 0 %). `CollageRenderer.syncBackground` requests the bg image from `ImageCache`
  (key = photo id, shared with the photo view; `removePhoto` keeps the cache entry while it is the bg photo).
  Export: `loadBackgroundImage` in parallel with the photos; failure → `ExportError('imageLoad', 'background
  photo N ...')`. Store: `useAsBackground(photoId)` (one undo step); `deletePhoto` uses
  `withoutDeletedPhoto` (resets `centerPhotoId` and `background.image.photoId` in one update, saved, no undo
  step). Photo panel: input `isBackground` (from committed settings), output `useAsBackground`, icon
  `wallpaper`. Deviation: the appearance section gets `backgroundImageUrl: string | null` (computed in
  `editor.page.ts`, passed through `collage-settings-panel`) instead of collage id + photo id; [Remove image]
  uses icon `hide_image`. `settings-limits.ts`: `overlayOpacityPercent` (0–100 integer). New i18n ids
  `@@editor.settings.{backgroundTypeImage,backgroundImageRemove,backgroundImageHint,overlayColor,overlayOpacity,overlayOpacityAria}`,
  `@@editor.photo.{useAsBackground,isBackground}`.

## Open questions

- The bg image crop aspect uses the stored `widthPx`/`heightPx`; a mismatch with the real file size would
  distort it (same assumption as `PhotoView`).
- The photo panel button state uses the committed settings, not a running preview.
- Known accepted limits: background image resolution = stored file (~1440 px); a background-only photo
  is not stable (see decision "Background photo is shared").

## Current state / Next action

- Done: research, grilling, plan approved (2026-11-13). Steps 1–3 implemented on 2026-11-13 in one run (the
  developer asked to skip the review gate); `npx ng build` passes. Not committed.
- All three steps reviewed and approved by the developer (2026-11-13). Feature done; no open step.
- No temporary changes to revert.
