// Selection handles (rotate, box width) of the selected text. Plain class without Angular.
import type Konva from 'konva/lib/Core';
import type { PressGestureTracker } from './press-gesture';
import { MIN_TEXT_WIDTH_MM, TextBox } from './scene';
import { SelectionTransformer } from './selection-transformer';
import type { TextView } from './text-view';

/** Only the side handles: they change the box width (the text wraps again, the font size stays). */
const TEXT_ANCHORS = ['middle-left', 'middle-right'];

/** Transform events of the handles. */
export interface TextTransformerCallbacks {
  /** After each pointer move of a transform, with the box as Konva has scaled/rotated it. */
  onTransform: (view: TextView, box: TextBox) => void;
  /** Once when the transform ends (also after a press on a handle without movement). */
  onTransformEnd: (view: TextView, box: TextBox) => void;
}

/**
 * Handles on the selected text (see `SelectionTransformer`): the rotation handle and the two side
 * handles. A side handle is shown by Konva as `scaleX` of the text group; the owner turns it into
 * the box width on every move (live re-wrap, scale reset to 1). The handles fit the text box
 * without the outline stroke.
 */
export class TextTransformer extends SelectionTransformer<TextView> {
  constructor(
    layer: Konva.Layer,
    gestures: PressGestureTracker,
    private readonly callbacks: TextTransformerCallbacks,
  ) {
    super(layer, gestures, {
      minSizeMm: MIN_TEXT_WIDTH_MM,
      enabledAnchors: TEXT_ANCHORS,
      ignoreStroke: true,
    });
  }

  protected override transformed(view: TextView): void {
    this.callbacks.onTransform(view, view.textBox());
  }

  protected override transformEnded(view: TextView): void {
    this.callbacks.onTransformEnd(view, view.textBox());
  }
}
