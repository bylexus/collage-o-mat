// Selection handles (rotate, resize) of the selected photo. Plain class without Angular.
import type Konva from 'konva/lib/Core';
import type { FrameBox } from '../geometry/transform';
import type { PhotoView } from './photo-view';
import type { PressGestureTracker } from './press-gesture';
import { SelectionTransformer } from './selection-transformer';

/** Smallest frame side (mm) the resize handles allow. */
const MIN_FRAME_SIZE_MM = 5;
/** Edge (middle) handles: they change the frame aspect; the corner handles keep it. */
const EDGE_ANCHORS: ReadonlySet<string> = new Set([
  'top-center',
  'middle-left',
  'middle-right',
  'bottom-center',
]);

/** Transform events of the handles; `keepAspect` is false for an edge handle. */
export interface PhotoTransformerCallbacks {
  /** After each pointer move of a transform, with the frame as Konva has scaled/rotated it. */
  onTransform: (view: PhotoView, box: FrameBox, keepAspect: boolean) => void;
  /** Once when the transform ends (also after a press on a handle without movement). */
  onTransformEnd: (view: PhotoView, box: FrameBox, keepAspect: boolean) => void;
}

/**
 * Handles on the selected photo (see `SelectionTransformer`): all eight resize handles; the corner
 * handles keep the frame aspect, the edge handles change it.
 */
export class PhotoTransformer extends SelectionTransformer<PhotoView> {
  /** Aspect mode of the running transform (set from the handle at `transformstart`). */
  private keepAspect = true;

  constructor(
    layer: Konva.Layer,
    gestures: PressGestureTracker,
    private readonly callbacks: PhotoTransformerCallbacks,
  ) {
    super(layer, gestures, { minSizeMm: MIN_FRAME_SIZE_MM });
  }

  protected override transformStarted(): void {
    this.keepAspect = !EDGE_ANCHORS.has(this.transformer.getActiveAnchor() ?? '');
  }

  protected override transformed(view: PhotoView): void {
    this.callbacks.onTransform(view, view.frameBox(), this.keepAspect);
  }

  protected override transformEnded(view: PhotoView): void {
    this.callbacks.onTransformEnd(view, view.frameBox(), this.keepAspect);
  }
}
