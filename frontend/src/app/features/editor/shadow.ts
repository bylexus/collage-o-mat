// Shadow comparison. Pure functions: no Angular, no DOM.
import type { Shadow } from '../../core/models/shadow';

/** True if both shadows have the same values. */
export function sameShadow(a: Shadow, b: Shadow): boolean {
  return (
    a.enabled === b.enabled &&
    a.color === b.color &&
    a.blurMm === b.blurMm &&
    a.offsetXMm === b.offsetXMm &&
    a.offsetYMm === b.offsetYMm &&
    a.opacity === b.opacity
  );
}
