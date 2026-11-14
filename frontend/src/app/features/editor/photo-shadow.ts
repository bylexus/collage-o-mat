// Rules of the per-photo shadow override. Pure functions: no Angular, no DOM.
import type { PhotoProps } from '../../core/models/photo';
import type { Shadow } from '../../core/models/shadow';

/** The shadow drawn for the photo: its own shadow, or the collage `defaultShadow` without one. */
export function effectiveShadow(props: PhotoProps, defaultShadow: Shadow): Shadow {
  return props.shadow ?? defaultShadow;
}

/** True if the photo has an own shadow (missing or `null` = the collage `defaultShadow`). */
export function hasShadowOverride(props: PhotoProps): boolean {
  return typeof props.shadow === 'object' && props.shadow !== null;
}
