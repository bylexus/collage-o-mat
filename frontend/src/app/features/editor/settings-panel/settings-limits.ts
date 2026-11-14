import { NumberLimits } from '../../../shared/number-limits';

/**
 * Limits of the numeric collage settings in the settings panel. The border width limits are
 * `BORDER_WIDTH_LIMITS` (shared with the photo border).
 */
export const SETTINGS_LIMITS = {
  dpi: { min: 72, max: 1200, step: 1, integer: true },
  gridCount: { min: 1, max: 20, step: 1, integer: true },
  /** Photos in one lane of the center mode (top, middle, bottom). */
  laneCount: { min: 0, max: 30, step: 1, integer: true },
  gapMm: { min: 0, max: 50, step: 0.5 },
  marginMm: { min: 0, max: 100, step: 1 },
  sizePercent: { min: 10, max: 100, step: 5 },
  /** Heap mode: total photo area in % of the content area. */
  coveragePercent: { min: 30, max: 300, step: 10, integer: true },
  /** Heap mode: random size change per photo (± %). */
  sizeVariationPercent: { min: 0, max: 50, step: 5, integer: true },
  /** Heap mode: random rotation per photo (± degrees). */
  maxRotationDeg: { min: 0, max: 45, step: 1, integer: true },
  /** Cell size of the snap grid (toolbar popover). */
  snapGridSizeMm: { min: 1, max: 100, step: 0.5 },
  /** Direction of a linear background gradient in degrees (CSS convention). */
  gradientAngleDeg: { min: 0, max: 359, step: 1, integer: true },
  /** Opacity of the overlay colour over a background image (slider). */
  overlayOpacityPercent: { min: 0, max: 100, step: 1, integer: true },
  /** Blur radius of a background image in mm (slider). */
  backgroundBlurMm: { min: 0, max: 30, step: 0.5 },
} as const satisfies Record<string, NumberLimits>;
