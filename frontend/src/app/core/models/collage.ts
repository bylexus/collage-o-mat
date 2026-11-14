/**
 * Collage DTOs and the `settings` JSON document of a collage (owned by the frontend; the backend
 * only stores it). Contains pure helpers for page presets, defaults and labels.
 */

import type { Photo } from './photo';
import type { Shadow } from './shadow';
import type { CollageText } from './text';

/** Ids of the page presets with a fixed size. */
export type FixedPagePresetId = 'A5' | 'A4' | 'A3' | 'Letter' | '30x30';

/** Ids of all page presets; `Custom` means a free width and height. */
export type PagePresetId = FixedPagePresetId | 'Custom';

export type PageOrientation = 'portrait' | 'landscape';

export type ArrangementMode = 'grid' | 'center' | 'heap' | 'masonry';

/** All arrangement modes. */
export const ARRANGEMENT_MODES: readonly ArrangementMode[] = ['grid', 'center', 'heap', 'masonry'];

const PAGE_ORIENTATIONS: readonly PageOrientation[] = ['portrait', 'landscape'];

/** Page size in millimetres. */
export interface PageSize {
  widthMm: number;
  heightMm: number;
}

export interface PageSettings extends PageSize {
  preset: PagePresetId;
  orientation: PageOrientation;
  dpi: number;
}

export interface BorderSettings {
  widthMm: number;
  color: string;
}

export interface GridSettings {
  /** `null` = computed from the photo count. */
  rows: number | null;
  /** `null` = computed from the photo count. */
  cols: number | null;
  gapMm: number;
  marginMm: number;
  /** Photos in random order instead of import order. */
  randomOrder: boolean;
}

export interface CenterSettings {
  /** `null` = the first photo. */
  centerPhotoId: number | null;
  sizePercent: number;
  gapMm: number;
  marginMm: number;
  /** Photos in the top lane; `null` = auto (distributed by lane area). */
  topCount: number | null;
  /** Photos beside the centre photo (split left/right, odd: one more left); `null` = auto. */
  middleCount: number | null;
  /** Photos in the bottom lane; `null` = auto. */
  bottomCount: number | null;
  /** Photos in random order instead of import order (the centre photo stays fixed). */
  randomOrder: boolean;
}

/**
 * Frame aspect of the heap mode: `full` = the image aspect (whole image), else a print aspect
 * `w:h` (landscape for a landscape or square image, portrait for a portrait image; cover crop).
 */
export type HeapAspect = 'full' | '3:2' | '4:3' | '1:1' | '5:4';

/** All heap frame aspects. */
export const HEAP_ASPECTS: readonly HeapAspect[] = ['full', '3:2', '4:3', '1:1', '5:4'];

/** Settings of the "random heap" mode: photos with random position, size and rotation. */
export interface HeapSettings {
  aspect: HeapAspect;
  /** Total photo area in % of the content area (more than 100 = the photos overlap). */
  coveragePercent: number;
  /** Random size change per photo, ± % of the side length. */
  sizeVariationPercent: number;
  /** Random rotation per photo, ± degrees; 0 = no rotation. */
  maxRotationDeg: number;
  marginMm: number;
}

/** Line direction of the masonry mode: `rows` = horizontal lines, `columns` = vertical lines. */
export type MasonryDirection = 'rows' | 'columns';

/** All masonry directions. */
export const MASONRY_DIRECTIONS: readonly MasonryDirection[] = ['rows', 'columns'];

/**
 * Settings of the "masonry" mode: justified lines (rows or columns) of equal thickness; the photos
 * are distributed to the lines with as little crop as possible.
 */
export interface MasonrySettings {
  direction: MasonryDirection;
  /** Number of lines (rows or columns); `null` = auto (the count with the least crop). */
  count: number | null;
  gapMm: number;
  marginMm: number;
  /** Random good split instead of the deterministic best fit. */
  randomOrder: boolean;
}

/**
 * Invisible snap grid for moving and resizing elements by hand (not related to the "grid"
 * arrangement mode). Lines start at the margin of the active arrangement mode.
 */
export interface SnapGridSettings {
  enabled: boolean;
  /** Side of a square grid cell. */
  sizeMm: number;
}

/** What the page background shows; `BackgroundSettings.type`. */
export type BackgroundType = 'color' | 'gradient' | 'image';

/** All background types. */
export const BACKGROUND_TYPES: readonly BackgroundType[] = ['color', 'gradient', 'image'];

/** Shape of a gradient background: along an angle, or from the page centre outwards. */
export type GradientKind = 'linear' | 'radial';

/** All gradient kinds. */
export const GRADIENT_KINDS: readonly GradientKind[] = ['linear', 'radial'];

/** Two-colour gradient of the page background. */
export interface GradientSettings {
  kind: GradientKind;
  /** Start colour (linear: start of the gradient line; radial: page centre). */
  from: string;
  /** End colour (linear: end of the gradient line; radial: farthest page corner). */
  to: string;
  /** Direction of a linear gradient in degrees, CSS convention (0 = towards top, 90 = towards right). */
  angleDeg: number;
}

/** Image background: a collage photo covers the page, dimmed by an overlay colour. */
export interface ImageBackgroundSettings {
  /** Id of the background photo (a photo of the collage); `null` = no image. */
  photoId: number | null;
  overlayColor: string;
  /** Opacity of the overlay colour, 0..100. */
  overlayOpacityPercent: number;
}

/**
 * Page background. Keeps the values of all types, so switching the type restores earlier values;
 * `type` selects what is drawn.
 */
export interface BackgroundSettings {
  type: BackgroundType;
  /** Solid colour; also drawn under the image (visible while loading or without a photo). */
  color: string;
  gradient: GradientSettings;
  image: ImageBackgroundSettings;
}

/** The `settings` JSON document of a collage. */
export interface CollageSettings {
  page: PageSettings;
  background: BackgroundSettings;
  defaultBorder: BorderSettings;
  /** Drop shadow of all photos without an own shadow (`PhotoProps.shadow`). */
  defaultShadow: Shadow;
  mode: ArrangementMode;
  grid: GridSettings;
  center: CenterSettings;
  heap: HeapSettings;
  masonry: MasonrySettings;
  snapGrid: SnapGridSettings;
}

/** List entry of `GET /api/collages`; also returned by create and rename. */
export interface CollageSummary {
  id: number;
  name: string;
  settings: CollageSettings;
  photoCount: number;
  /** ISO 8601 timestamp. */
  updatedAt: string;
}

/** Full collage of `GET /api/collages/{id}`. */
export interface CollageDetail {
  id: number;
  name: string;
  settings: CollageSettings;
  /** Photos in import order (id ascending). */
  photos: Photo[];
  /** Overlay texts (any order; drawn by `props.z`). */
  texts: CollageText[];
}

/** Body of `POST /api/collages`. */
export interface CreateCollageRequest {
  name: string;
  settings: CollageSettings;
}

/** Maximum length of a collage name (same limit as in the backend). */
export const COLLAGE_NAME_MAX_LENGTH = 200;

/** Allowed range for a custom page side in millimetres. */
export const CUSTOM_PAGE_SIZE_MIN_MM = 10;
export const CUSTOM_PAGE_SIZE_MAX_MM = 2000;

export const DEFAULT_DPI = 300;

/** A page preset with a fixed size. The size is given in portrait orientation. */
export interface FixedPagePreset {
  id: FixedPagePresetId;
  label: string;
  portrait: PageSize;
}

/** Fixed-size presets in display order (portrait sizes; landscape swaps width and height). */
export const FIXED_PAGE_PRESETS: readonly FixedPagePreset[] = [
  { id: 'A5', label: 'A5', portrait: { widthMm: 148, heightMm: 210 } },
  { id: 'A4', label: 'A4', portrait: { widthMm: 210, heightMm: 297 } },
  { id: 'A3', label: 'A3', portrait: { widthMm: 297, heightMm: 420 } },
  {
    id: 'Letter',
    label: $localize`:@@collages.preset.letter:Letter`,
    portrait: { widthMm: 215.9, heightMm: 279.4 },
  },
  {
    id: '30x30',
    label: $localize`:@@collages.preset.square30:30 × 30 cm`,
    portrait: { widthMm: 300, heightMm: 300 },
  },
];

/** Ids of all page presets (fixed presets and `Custom`). */
const PAGE_PRESET_IDS: readonly PagePresetId[] = [...FIXED_PAGE_PRESETS.map((p) => p.id), 'Custom'];

/** Label of the `Custom` preset. */
export const CUSTOM_PRESET_LABEL = $localize`:@@collages.preset.custom:Custom`;

const ORIENTATION_LABELS: Record<PageOrientation, string> = {
  portrait: $localize`:@@collages.orientation.portrait:portrait`,
  landscape: $localize`:@@collages.orientation.landscape:landscape`,
};

/** Returns the fixed preset with the given id, or `undefined` (e.g. for `Custom`). */
export function findFixedPreset(id: PagePresetId): FixedPagePreset | undefined {
  return FIXED_PAGE_PRESETS.find((p) => p.id === id);
}

/** A square preset has no orientation (portrait and landscape give the same size). */
export function isSquarePreset(preset: FixedPagePreset): boolean {
  return preset.portrait.widthMm === preset.portrait.heightMm;
}

/** Size of a preset in the given orientation (landscape = longer side horizontal). */
export function orientedSize(portrait: PageSize, orientation: PageOrientation): PageSize {
  const short = Math.min(portrait.widthMm, portrait.heightMm);
  const long = Math.max(portrait.widthMm, portrait.heightMm);
  return orientation === 'landscape'
    ? { widthMm: long, heightMm: short }
    : { widthMm: short, heightMm: long };
}

/** Orientation that matches a size; a square page counts as portrait. */
export function orientationOf(size: PageSize): PageOrientation {
  return size.widthMm > size.heightMm ? 'landscape' : 'portrait';
}

/** Page settings for a fixed preset in the given orientation. */
export function fixedPageSettings(
  preset: FixedPagePresetId,
  orientation: PageOrientation,
  dpi = DEFAULT_DPI,
): PageSettings {
  const fixed = findFixedPreset(preset);
  if (!fixed) {
    throw new Error(`Unknown page preset: ${preset}`);
  }
  return { preset, orientation, dpi, ...orientedSize(fixed.portrait, orientation) };
}

/** Page settings for a custom size; the orientation follows from the size. */
export function customPageSettings(size: PageSize, dpi = DEFAULT_DPI): PageSettings {
  return {
    preset: 'Custom',
    orientation: orientationOf(size),
    dpi,
    widthMm: size.widthMm,
    heightMm: size.heightMm,
  };
}

/**
 * Settings of a new collage: A4 landscape, 300 DPI, white colour background (gradient white to
 * black at 180°, image without photo and with a transparent black overlay), no border, shadow off
 * (black, 40 %, blur 3 mm, offset 1.5/1.5 mm), grid mode,
 * grid and center mode in import order (random order off), heap mode with the whole image,
 * 120 % coverage, ±20 % size, ±15° rotation, masonry mode in rows with an automatic line count
 * (random order off), snap grid off (5 mm).
 */
export function defaultCollageSettings(): CollageSettings {
  return {
    page: fixedPageSettings('A4', 'landscape'),
    background: {
      type: 'color',
      color: '#ffffff',
      gradient: { kind: 'linear', from: '#ffffff', to: '#000000', angleDeg: 180 },
      image: { photoId: null, overlayColor: '#000000', overlayOpacityPercent: 0 },
    },
    defaultBorder: { widthMm: 0, color: '#ffffff' },
    defaultShadow: {
      enabled: false,
      color: '#000000',
      blurMm: 3,
      offsetXMm: 1.5,
      offsetYMm: 1.5,
      opacity: 0.4,
    },
    mode: 'grid',
    grid: { rows: null, cols: null, gapMm: 5, marginMm: 10, randomOrder: false },
    center: {
      centerPhotoId: null,
      sizePercent: 50,
      gapMm: 5,
      marginMm: 10,
      topCount: null,
      middleCount: null,
      bottomCount: null,
      randomOrder: false,
    },
    heap: {
      aspect: 'full',
      coveragePercent: 120,
      sizeVariationPercent: 20,
      maxRotationDeg: 15,
      marginMm: 10,
    },
    masonry: { direction: 'rows', count: null, gapMm: 5, marginMm: 10, randomOrder: false },
    snapGrid: { enabled: false, sizeMm: 5 },
  };
}

/**
 * Settings from the API as a complete `CollageSettings` document: every known field with the right type
 * is kept, a missing or wrongly typed field gets its value from `defaultCollageSettings()` (e.g. the lane
 * counts, the heap, the masonry settings or the default shadow in collages saved before they existed), unknown fields are dropped. Only types are checked (a
 * finite number, a boolean, a string, one of the allowed ids, `null` where allowed); ranges are the job
 * of the users of the settings. Fields are merged one by one, so an invalid page size keeps the stored
 * preset. The legacy string `backgroundColor` (before `background` existed) becomes `background.color`
 * and is dropped.
 */
export function normalizeSettings(raw: unknown): CollageSettings {
  const defaults = defaultCollageSettings();
  const source = asRecord(raw);
  return {
    page: normalizePage(source['page'], defaults.page),
    background: normalizeBackground(
      source['background'],
      source['backgroundColor'],
      defaults.background,
    ),
    defaultBorder: normalizeBorder(source['defaultBorder'], defaults.defaultBorder),
    defaultShadow: normalizeShadow(source['defaultShadow'], defaults.defaultShadow),
    mode: oneOf(source['mode'], ARRANGEMENT_MODES, defaults.mode),
    grid: normalizeGrid(source['grid'], defaults.grid),
    center: normalizeCenter(source['center'], defaults.center),
    heap: normalizeHeap(source['heap'], defaults.heap),
    masonry: normalizeMasonry(source['masonry'], defaults.masonry),
    snapGrid: normalizeSnapGrid(source['snapGrid'], defaults.snapGrid),
  };
}

function normalizePage(raw: unknown, defaults: PageSettings): PageSettings {
  const source = asRecord(raw);
  return {
    preset: oneOf(source['preset'], PAGE_PRESET_IDS, defaults.preset),
    orientation: oneOf(source['orientation'], PAGE_ORIENTATIONS, defaults.orientation),
    widthMm: numberOr(source['widthMm'], defaults.widthMm),
    heightMm: numberOr(source['heightMm'], defaults.heightMm),
    dpi: numberOr(source['dpi'], defaults.dpi),
  };
}

/**
 * Background merged field by field. Migration: without a stored `background.color` string the
 * legacy `backgroundColor` string is used, if there is one.
 */
function normalizeBackground(
  raw: unknown,
  legacyColor: unknown,
  defaults: BackgroundSettings,
): BackgroundSettings {
  const source = asRecord(raw);
  return {
    type: oneOf(source['type'], BACKGROUND_TYPES, defaults.type),
    color: stringOr(source['color'], stringOr(legacyColor, defaults.color)),
    gradient: normalizeGradient(source['gradient'], defaults.gradient),
    image: normalizeImageBackground(source['image'], defaults.image),
  };
}

function normalizeGradient(raw: unknown, defaults: GradientSettings): GradientSettings {
  const source = asRecord(raw);
  return {
    kind: oneOf(source['kind'], GRADIENT_KINDS, defaults.kind),
    from: stringOr(source['from'], defaults.from),
    to: stringOr(source['to'], defaults.to),
    angleDeg: numberOr(source['angleDeg'], defaults.angleDeg),
  };
}

function normalizeImageBackground(
  raw: unknown,
  defaults: ImageBackgroundSettings,
): ImageBackgroundSettings {
  const source = asRecord(raw);
  return {
    photoId: nullableNumberOr(source['photoId'], defaults.photoId),
    overlayColor: stringOr(source['overlayColor'], defaults.overlayColor),
    overlayOpacityPercent: numberOr(
      source['overlayOpacityPercent'],
      defaults.overlayOpacityPercent,
    ),
  };
}

function normalizeBorder(raw: unknown, defaults: BorderSettings): BorderSettings {
  const source = asRecord(raw);
  return {
    widthMm: numberOr(source['widthMm'], defaults.widthMm),
    color: stringOr(source['color'], defaults.color),
  };
}

function normalizeShadow(raw: unknown, defaults: Shadow): Shadow {
  const source = asRecord(raw);
  return {
    enabled: booleanOr(source['enabled'], defaults.enabled),
    color: stringOr(source['color'], defaults.color),
    blurMm: numberOr(source['blurMm'], defaults.blurMm),
    offsetXMm: numberOr(source['offsetXMm'], defaults.offsetXMm),
    offsetYMm: numberOr(source['offsetYMm'], defaults.offsetYMm),
    opacity: numberOr(source['opacity'], defaults.opacity),
  };
}

function normalizeGrid(raw: unknown, defaults: GridSettings): GridSettings {
  const source = asRecord(raw);
  return {
    rows: nullableNumberOr(source['rows'], defaults.rows),
    cols: nullableNumberOr(source['cols'], defaults.cols),
    gapMm: numberOr(source['gapMm'], defaults.gapMm),
    marginMm: numberOr(source['marginMm'], defaults.marginMm),
    randomOrder: booleanOr(source['randomOrder'], defaults.randomOrder),
  };
}

function normalizeCenter(raw: unknown, defaults: CenterSettings): CenterSettings {
  const source = asRecord(raw);
  return {
    centerPhotoId: nullableNumberOr(source['centerPhotoId'], defaults.centerPhotoId),
    sizePercent: numberOr(source['sizePercent'], defaults.sizePercent),
    gapMm: numberOr(source['gapMm'], defaults.gapMm),
    marginMm: numberOr(source['marginMm'], defaults.marginMm),
    topCount: nullableNumberOr(source['topCount'], defaults.topCount),
    middleCount: nullableNumberOr(source['middleCount'], defaults.middleCount),
    bottomCount: nullableNumberOr(source['bottomCount'], defaults.bottomCount),
    randomOrder: booleanOr(source['randomOrder'], defaults.randomOrder),
  };
}

function normalizeHeap(raw: unknown, defaults: HeapSettings): HeapSettings {
  const source = asRecord(raw);
  return {
    aspect: oneOf(source['aspect'], HEAP_ASPECTS, defaults.aspect),
    coveragePercent: numberOr(source['coveragePercent'], defaults.coveragePercent),
    sizeVariationPercent: numberOr(source['sizeVariationPercent'], defaults.sizeVariationPercent),
    maxRotationDeg: numberOr(source['maxRotationDeg'], defaults.maxRotationDeg),
    marginMm: numberOr(source['marginMm'], defaults.marginMm),
  };
}

function normalizeMasonry(raw: unknown, defaults: MasonrySettings): MasonrySettings {
  const source = asRecord(raw);
  return {
    direction: oneOf(source['direction'], MASONRY_DIRECTIONS, defaults.direction),
    count: nullableNumberOr(source['count'], defaults.count),
    gapMm: numberOr(source['gapMm'], defaults.gapMm),
    marginMm: numberOr(source['marginMm'], defaults.marginMm),
    randomOrder: booleanOr(source['randomOrder'], defaults.randomOrder),
  };
}

function normalizeSnapGrid(raw: unknown, defaults: SnapGridSettings): SnapGridSettings {
  const source = asRecord(raw);
  return {
    enabled: booleanOr(source['enabled'], defaults.enabled),
    sizeMm: numberOr(source['sizeMm'], defaults.sizeMm),
  };
}

/** The value as a record of fields if it is a plain object (not `null`, not an array), else `{}`. */
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** True for a finite number. */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** The value if it is a finite number, else `fallback`. */
function numberOr(value: unknown, fallback: number): number {
  return isFiniteNumber(value) ? value : fallback;
}

/** The value if it is `null` or a finite number, else `fallback`. */
function nullableNumberOr(value: unknown, fallback: number | null): number | null {
  return value === null || isFiniteNumber(value) ? value : fallback;
}

/** The value if it is a boolean, else `fallback`. */
function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** The value if it is a string, else `fallback`. */
function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

/** The value if it is one of `allowed`, else `fallback`. */
function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.find((item) => item === value) ?? fallback;
}

/**
 * Short display text of a page: "A4 landscape" for a fixed preset, "30 × 30 cm" for a square
 * preset, "300 × 200 mm" for a custom size.
 */
export function pageLabel(page: PageSettings): string {
  const preset = findFixedPreset(page.preset);
  if (!preset) {
    const width = formatMm(page.widthMm);
    const height = formatMm(page.heightMm);
    return $localize`:@@collages.pageLabel.custom:${width}:width: × ${height}:height: mm`;
  }
  if (isSquarePreset(preset)) {
    return preset.label;
  }
  const name = preset.label;
  const orientation = ORIENTATION_LABELS[page.orientation];
  return $localize`:@@collages.pageLabel.preset:${name}:preset: ${orientation}:orientation:`;
}

/** Formats a length in mm with at most one decimal in the current locale. */
function formatMm(value: number): string {
  return new Intl.NumberFormat($localize.locale ?? 'en', { maximumFractionDigits: 1 }).format(
    value,
  );
}
