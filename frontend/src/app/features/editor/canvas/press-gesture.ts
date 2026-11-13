// Click suppression after gestures on the editor stage. Plain class without Angular.
import type Konva from 'konva/lib/Core';

/** Konva event namespace of the tracker listener. */
const EVENT_NAMESPACE = '.pressGesture';

/**
 * Remembers whether the current (or last) press on the stage became a gesture: a view pan, a
 * transform with the handles or a crop pan. Konva and the browser still fire a click after such a
 * press; that click must not change the selection or end crop mode.
 *
 * The flag is cleared on every `pointerdown` of the stage. Create the tracker before the other
 * stage listeners, so that it is cleared before any of them can mark a new gesture.
 */
export class PressGestureTracker {
  private gesture = false;

  constructor(stage: Konva.Stage) {
    stage.on(`pointerdown${EVENT_NAMESPACE}`, () => (this.gesture = false));
  }

  /** Marks the current press as a gesture. */
  markGesture(): void {
    this.gesture = true;
  }

  /** True if the last press on the stage became a gesture. */
  wasGesture(): boolean {
    return this.gesture;
  }
}
