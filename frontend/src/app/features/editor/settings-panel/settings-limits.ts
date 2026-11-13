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
} as const satisfies Record<string, NumberLimits>;
