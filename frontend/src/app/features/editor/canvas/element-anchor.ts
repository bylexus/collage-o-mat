// Screen anchor of a canvas element for HTML overlays (crop controls, selection toolbar).
import type Konva from 'konva/lib/Core';
import type { Point } from './viewport';

/**
 * Bottom centre of the node's bounding box in container px (rotation, pan and zoom included;
 * shadow and stroke not). Works for the group of a `PhotoView` or a `TextView`.
 */
export function bottomCentreOf(node: Konva.Node): Point {
  const box = node.getClientRect({ skipShadow: true, skipStroke: true });
  return { x: box.x + box.width / 2, y: box.y + box.height };
}

/** True if both anchors are `null` or at the same point. */
export function sameAnchor(a: Point | null, b: Point | null): boolean {
  return a === b || (a !== null && b !== null && a.x === b.x && a.y === b.y);
}
