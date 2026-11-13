// Selection handles (move, rotate, resize) of the selected photo. Plain class without Angular.
import type Konva from 'konva/lib/Core';
import { Transformer } from 'konva/lib/shapes/Transformer';
import type { Box } from 'konva/lib/shapes/Transformer';
import type { FrameBox } from '../geometry/transform';
import { HANDLE_FILL, SELECTION_COLOR, SELECTION_STROKE_PX } from './canvas-theme';
import type { PhotoView } from './photo-view';
import type { PressGestureTracker } from './press-gesture';

/** Smallest frame side (mm) the resize handles allow. */
const MIN_FRAME_SIZE_MM = 5;
/** Angles (degrees) the rotation handle snaps to. */
const ROTATION_SNAPS_DEG = [0, 90, 180, 270];
/** The rotation handle snaps when it is closer than this to a snap angle (degrees). */
const ROTATION_SNAP_TOLERANCE_DEG = 4;
/** Side of the square handles (screen px). */
const ANCHOR_SIZE_PX = 10;
/** Distance of the rotation handle above the frame (screen px). */
const ROTATE_ANCHOR_OFFSET_PX = 30;
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
 * A `Konva.Transformer` on the selected photo: rotation handle (snaps at 0/90/180/270°), corner
 * handles that keep the frame aspect, edge handles that change it, no flipping, a minimum frame size.
 * The transformer is laid out in screen px, so handles and border keep their size at any zoom.
 *
 * Konva shows a transform as a scale of the photo group; the owner converts it into frame size with
 * the callbacks (and resets the scale by redrawing the photo).
 */
export class PhotoTransformer {
  private readonly transformer: Transformer;
  private view: PhotoView | null = null;
  /** Aspect mode of the running transform (set from the handle at `transformstart`). */
  private keepAspect = true;

  constructor(
    layer: Konva.Layer,
    private readonly gestures: PressGestureTracker,
    private readonly callbacks: PhotoTransformerCallbacks,
  ) {
    this.transformer = new Transformer({
      flipEnabled: false,
      rotationSnaps: ROTATION_SNAPS_DEG,
      rotationSnapTolerance: ROTATION_SNAP_TOLERANCE_DEG,
      rotateAnchorOffset: ROTATE_ANCHOR_OFFSET_PX,
      anchorSize: ANCHOR_SIZE_PX,
      anchorFill: HANDLE_FILL,
      anchorStroke: SELECTION_COLOR,
      borderStroke: SELECTION_COLOR,
      borderStrokeWidth: SELECTION_STROKE_PX,
      boundBoxFunc: (oldBox, newBox) => this.limitSize(oldBox, newBox),
    });
    this.transformer.on('transformstart', () => this.onTransformStart());
    this.transformer.on('transform', () => this.onTransform());
    this.transformer.on('transformend', () => this.onTransformEnd());
    layer.add(this.transformer);
  }

  /** Shows the handles on a photo, or hides them (`null`). */
  attach(view: PhotoView | null): void {
    if (view === this.view) {
      return;
    }
    this.view = view;
    this.transformer.nodes(view ? [view.group] : []);
  }

  /** Lays the handles out again (after the attached photo was redrawn) and puts them in front. */
  refresh(): void {
    this.transformer.moveToTop();
    if (this.view) {
      this.transformer.forceUpdate();
    }
  }

  /** True if the node is part of the transformer (handle, border). */
  owns(node: Konva.Node): boolean {
    return node === this.transformer || this.transformer.isAncestorOf(node);
  }

  destroy(): void {
    this.transformer.destroy();
  }

  private onTransformStart(): void {
    this.keepAspect = !EDGE_ANCHORS.has(this.transformer.getActiveAnchor() ?? '');
    this.view?.beginGesture();
  }

  private onTransform(): void {
    this.gestures.markGesture();
    if (this.view) {
      this.callbacks.onTransform(this.view, this.view.frameBox(), this.keepAspect);
    }
  }

  private onTransformEnd(): void {
    const view = this.view;
    if (view) {
      view.endGesture();
      this.callbacks.onTransformEnd(view, view.frameBox(), this.keepAspect);
    }
  }

  /**
   * Keeps the previous box when a side would shrink below `MIN_FRAME_SIZE_MM`. Boxes are in screen
   * px. A frame that is already smaller can still grow.
   */
  private limitSize(oldBox: Box, newBox: Box): Box {
    const minSizePx = MIN_FRAME_SIZE_MM * (this.transformer.getStage()?.scaleX() ?? 1);
    const tooSmall =
      shrinksBelow(oldBox.width, newBox.width, minSizePx) ||
      shrinksBelow(oldBox.height, newBox.height, minSizePx);
    return tooSmall ? oldBox : newBox;
  }
}

/** True if a side gets smaller than before and smaller than `min`. */
function shrinksBelow(oldSide: number, newSide: number, min: number): boolean {
  const side = Math.abs(newSide);
  return side < min && side < Math.abs(oldSide);
}
