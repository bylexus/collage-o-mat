import { NumberLimits } from '../../../shared/number-limits';

/** Limits of the numeric text properties in the text panel (see decision log "Text decisions"). */
export const TEXT_LIMITS = {
  fontSizePt: { min: 4, max: 400, step: 1 },
  shadowBlurMm: { min: 0, max: 20, step: 0.5 },
  shadowOffsetMm: { min: -20, max: 20, step: 0.5 },
  /** Shadow opacity in percent (stored as 0..1). */
  shadowOpacityPercent: { min: 0, max: 100, step: 5 },
  outlineWidthMm: { min: 0, max: 5, step: 0.1 },
} as const satisfies Record<string, NumberLimits>;
