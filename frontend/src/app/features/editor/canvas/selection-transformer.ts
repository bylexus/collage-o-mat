// Shared base of the selection handles (photo, text). Plain class without Angular.
import type Konva from 'konva/lib/Core';
import { Transformer } from 'konva/lib/shapes/Transformer';
import type { Box, TransformerConfig } from 'konva/lib/shapes/Transformer';
import { HANDLE_FILL, SELECTION_COLOR, SELECTION_STROKE_PX } from './canvas-theme';
import type { PressGestureTracker } from './press-gesture';

/** Angles (degrees) the rotation handle snaps to. */
const ROTATION_SNAPS_DEG = [0, 90, 180, 270];
/** The rotation handle snaps when it is closer than this to a snap angle (degrees). */
const ROTATION_SNAP_TOLERANCE_DEG = 4;
/** Side of the square handles (screen px). */
const ANCHOR_SIZE_PX = 10;
/** Distance of the rotation handle above the box (screen px). */
const ROTATE_ANCHOR_OFFSET_PX = 30;

/** A view the handles can be attached to: a Konva group plus the gesture flag of the view. */
export interface TransformableView {
  readonly group: Konva.Group;
  /** A transform starts: scene updates must not reset the geometry until `endGesture`. */
  beginGesture(): void;
  endGesture(): void;
}

/** What differs between the handles of the element kinds. */
export interface SelectionTransformerOptions {
  /** Smallest box side (mm) the resize handles allow. */
  minSizeMm: number;
  /** Resize handles; Konva's default (all eight) if omitted. */
  enabledAnchors?: string[];
  /** True: the handles fit the box without the stroke of the shapes (e.g. a text outline). */
  ignoreStroke?: boolean;
}

/**
 * A `Konva.Transformer` on the selected element with the look and behaviour all element kinds
 * share: rotation handle (snaps at 0/90/180/270°), no flipping, a minimum box size, handles and
 * border in screen px (same size at any zoom). A transform marks the press as a gesture (no click
 * selection afterwards) and keeps the view in its gesture state from start to end.
 *
 * Konva shows a transform as a scale of the view's group; subclasses report it to the owner, which
 * converts it into props (and resets the scale by redrawing the view).
 */
export abstract class SelectionTransformer<V extends TransformableView> {
  protected readonly transformer: Transformer;
  protected view: V | null = null;

  constructor(
    layer: Konva.Layer,
    private readonly gestures: PressGestureTracker,
    private readonly options: SelectionTransformerOptions,
  ) {
    const config: TransformerConfig = {
      flipEnabled: false,
      rotationSnaps: ROTATION_SNAPS_DEG,
      rotationSnapTolerance: ROTATION_SNAP_TOLERANCE_DEG,
      rotateAnchorOffset: ROTATE_ANCHOR_OFFSET_PX,
      anchorSize: ANCHOR_SIZE_PX,
      anchorFill: HANDLE_FILL,
      anchorStroke: SELECTION_COLOR,
      borderStroke: SELECTION_COLOR,
      borderStrokeWidth: SELECTION_STROKE_PX,
      ignoreStroke: options.ignoreStroke ?? false,
      boundBoxFunc: (oldBox, newBox) => this.limitSize(oldBox, newBox),
    };
    if (options.enabledAnchors) {
      config.enabledAnchors = options.enabledAnchors;
    }
    this.transformer = new Transformer(config);
    this.transformer.on('transformstart', () => this.onTransformStart());
    this.transformer.on('transform', () => this.onTransform());
    this.transformer.on('transformend', () => this.onTransformEnd());
    layer.add(this.transformer);
  }

  /** Shows the handles on a view, or hides them (`null`). */
  attach(view: V | null): void {
    if (view === this.view) {
      return;
    }
    this.view = view;
    this.transformer.nodes(view ? [view.group] : []);
  }

  /** Lays the handles out again (after the attached view was redrawn) and puts them in front. */
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

  /** Hook: a transform of the view starts (before the first `transformed`). */
  protected transformStarted(_view: V): void {
    // Nothing by default.
  }

  /** After each pointer move of a transform, with the view as Konva has scaled/rotated it. */
  protected abstract transformed(view: V): void;

  /** Once when the transform ends (also after a press on a handle without movement). */
  protected abstract transformEnded(view: V): void;

  private onTransformStart(): void {
    if (this.view) {
      this.view.beginGesture();
      this.transformStarted(this.view);
    }
  }

  private onTransform(): void {
    this.gestures.markGesture();
    if (this.view) {
      this.transformed(this.view);
    }
  }

  private onTransformEnd(): void {
    const view = this.view;
    if (view) {
      view.endGesture();
      this.transformEnded(view);
    }
  }

  /**
   * Keeps the previous box when a side would shrink below the minimum size. Boxes are in screen
   * px. A box that is already smaller can still grow (or keep its size, e.g. a low text box).
   */
  private limitSize(oldBox: Box, newBox: Box): Box {
    const minSizePx = this.options.minSizeMm * (this.transformer.getStage()?.scaleX() ?? 1);
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
