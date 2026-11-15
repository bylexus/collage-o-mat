import type { PhotoAdjust } from '../../../core/models/photo';
import { NumberLimits } from '../../../shared/number-limits';

/** Limits of the adjustment sliders in the photo properties panel. */
export const ADJUST_LIMITS = {
  brightness: { min: -100, max: 100, step: 1, integer: true },
  contrast: { min: -100, max: 100, step: 1, integer: true },
  /** Mix of the tint with the original in percent. */
  tintStrength: { min: 0, max: 100, step: 1, integer: true },
} as const satisfies Record<string, NumberLimits>;

/** Tint colours of the preset buttons. */
export const TINT_PRESETS = {
  sepia: '#a0784f',
  /** Mid-grey: the tint formula gives an exact greyscale. */
  greyscale: '#808080',
} as const;

/** Values shown for a photo without an adjustment (neutral; the tint colour is Sepia). */
export const DEFAULT_ADJUST: Readonly<PhotoAdjust> = {
  brightness: 0,
  contrast: 0,
  tintColor: TINT_PRESETS.sepia,
  tintStrength: 0,
};

/** Tint strength that a preset sets when the strength is 0 (else the strength stays). */
export const PRESET_TINT_STRENGTH = 100;
