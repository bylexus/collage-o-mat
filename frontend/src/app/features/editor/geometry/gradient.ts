// Gradient geometry of the page background in page mm. Pure functions: no Angular, no Konva.
import type { PageSize } from '../../../core/models/collage';
import { finiteOr } from './numbers';

/** Angle used for a non-finite gradient angle (CSS default: towards bottom). */
const FALLBACK_ANGLE_DEG = 180;

/** Point in page mm, origin top-left. */
export interface PagePoint {
  x: number;
  y: number;
}

/** Gradient line of a linear gradient: the From colour is at `start`, the To colour at `end`. */
export interface LinearGradientLine {
  start: PagePoint;
  end: PagePoint;
}

/** Circle of a radial gradient: the From colour is at `center`, the To colour at `radius`. */
export interface RadialGradientCircle {
  center: PagePoint;
  radius: number;
}

/**
 * Gradient line of a linear gradient like CSS `linear-gradient(<angle>deg, ...)`: through the page
 * centre, in the direction of the angle (0 = towards top, 90 = towards right), long enough that the
 * page corners get the From and To colours (`|w·sin a| + |h·cos a|`). A non-finite angle gives 180.
 */
export function linearGradientLine(page: PageSize, angleDeg: number): LinearGradientLine {
  const angleRad = (finiteOr(angleDeg, FALLBACK_ANGLE_DEG) * Math.PI) / 180;
  const dx = Math.sin(angleRad);
  const dy = -Math.cos(angleRad);
  const halfLength = (Math.abs(page.widthMm * dx) + Math.abs(page.heightMm * dy)) / 2;
  const center = pageCenter(page);
  return {
    start: { x: center.x - dx * halfLength, y: center.y - dy * halfLength },
    end: { x: center.x + dx * halfLength, y: center.y + dy * halfLength },
  };
}

/**
 * Circle of a radial gradient like CSS `radial-gradient(circle farthest-corner, ...)`: centred on the
 * page, the radius reaches the page corners.
 */
export function radialGradientCircle(page: PageSize): RadialGradientCircle {
  return {
    center: pageCenter(page),
    radius: Math.hypot(page.widthMm / 2, page.heightMm / 2),
  };
}

function pageCenter(page: PageSize): PagePoint {
  return { x: page.widthMm / 2, y: page.heightMm / 2 };
}
