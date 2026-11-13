// DOM pointer helpers of the editor canvas.
import type { Point } from './viewport';

/** Position of a mouse/pointer event relative to the top-left corner of an element (px). */
export function pointInElement(element: HTMLElement, event: MouseEvent): Point {
  const bounds = element.getBoundingClientRect();
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
}
