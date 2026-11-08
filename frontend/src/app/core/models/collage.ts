/**
 * Collage DTOs and the `settings` JSON document of a collage (owned by the frontend; the backend
 * only stores it). Contains pure helpers for page presets, defaults and labels.
 */

import type { Photo } from './photo';

/** Ids of the page presets with a fixed size. */
export type FixedPagePresetId = 'A5' | 'A4' | 'A3' | 'Letter' | '30x30';

/** Ids of all page presets; `Custom` means a free width and height. */
export type PagePresetId = FixedPagePresetId | 'Custom';

export type PageOrientation = 'portrait' | 'landscape';

export type ArrangementMode = 'grid' | 'center';

/** All arrangement modes. */
export const ARRANGEMENT_MODES: readonly ArrangementMode[] = ['grid', 'center'];

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
}

/** The `settings` JSON document of a collage. */
export interface CollageSettings {
  page: PageSettings;
  backgroundColor: string;
  defaultBorder: BorderSettings;
  mode: ArrangementMode;
  grid: GridSettings;
  center: CenterSettings;
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
  /** Typed when texts are added (step 9). */
  texts: unknown[];
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

/** Settings of a new collage: A4 landscape, 300 DPI, white background, no border, grid mode. */
export function defaultCollageSettings(): CollageSettings {
  return {
    page: fixedPageSettings('A4', 'landscape'),
    backgroundColor: '#ffffff',
    defaultBorder: { widthMm: 0, color: '#ffffff' },
    mode: 'grid',
    grid: { rows: null, cols: null, gapMm: 5, marginMm: 10 },
    center: {
      centerPhotoId: null,
      sizePercent: 50,
      gapMm: 5,
      marginMm: 10,
      topCount: null,
      middleCount: null,
      bottomCount: null,
    },
  };
}

/**
 * Settings from the API as a complete `CollageSettings` document: every known field with the right type
 * is kept, a missing or wrongly typed field gets its value from `defaultCollageSettings()` (e.g. the lane
 * counts in collages saved before they existed), unknown fields are dropped. Only types are checked (a
 * finite number, a string, one of the allowed ids, `null` where allowed); ranges are the job of the users
 * of the settings. Fields are merged one by one, so an invalid page size keeps the stored preset.
 */
export function normalizeSettings(raw: unknown): CollageSettings {
  const defaults = defaultCollageSettings();
  const source = asRecord(raw);
  return {
    page: normalizePage(source['page'], defaults.page),
    backgroundColor: stringOr(source['backgroundColor'], defaults.backgroundColor),
    defaultBorder: normalizeBorder(source['defaultBorder'], defaults.defaultBorder),
    mode: oneOf(source['mode'], ARRANGEMENT_MODES, defaults.mode),
    grid: normalizeGrid(source['grid'], defaults.grid),
    center: normalizeCenter(source['center'], defaults.center),
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

function normalizeBorder(raw: unknown, defaults: BorderSettings): BorderSettings {
  const source = asRecord(raw);
  return {
    widthMm: numberOr(source['widthMm'], defaults.widthMm),
    color: stringOr(source['color'], defaults.color),
  };
}

function normalizeGrid(raw: unknown, defaults: GridSettings): GridSettings {
  const source = asRecord(raw);
  return {
    rows: nullableNumberOr(source['rows'], defaults.rows),
    cols: nullableNumberOr(source['cols'], defaults.cols),
    gapMm: numberOr(source['gapMm'], defaults.gapMm),
    marginMm: numberOr(source['marginMm'], defaults.marginMm),
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
