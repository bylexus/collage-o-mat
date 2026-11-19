// Selection handles (rotate, resize) of the selected photo. Plain class without Angular.
import type Konva from 'konva/lib/Core';
import type { Box } from 'konva/lib/shapes/Transformer';
import { MovingEdges, SnapGrid, snapResizeRect } from '../geometry/snap-grid';
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
/** All resize handles (Konva anchor names); the rotation handles are not in it. */
const RESIZE_ANCHORS: ReadonlySet<string> = new Set([
  ...EDGE_ANCHORS,
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
]);
/** Sides of a box in clockwise order (one quarter turn clockwise moves a side one step on). */
const SIDES = ['top', 'right', 'bottom', 'left'] as const;
type Side = (typeof SIDES)[number];
/** Degrees in a quarter turn. */
const QUARTER_TURN_DEG = 90;
/** A rotation closer than this (degrees) to a multiple of 90° counts as one (resize snapping). */
const QUARTER_TURN_TOLERANCE_DEG = 0.01;

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
 *
 * With a snap grid (`setSnapGrid`) a resize snaps for frames rotated by a multiple of 90°: an edge
 * handle puts the moved edge on a grid line; a corner handle puts the moved edge that is nearer to
 * a grid line on it, the other side follows from the aspect. The opposite edge or corner stays.
 * Alt/Option held: free resize (Konva also scales around the centre then).
 */
export class PhotoTransformer extends SelectionTransformer<PhotoView> {
  /** Aspect mode of the running transform (set from the handle at `transformstart`). */
  private keepAspect = true;
  private snapGrid: SnapGrid | null = null;

  constructor(
    layer: Konva.Layer,
    gestures: PressGestureTracker,
    private readonly callbacks: PhotoTransformerCallbacks,
  ) {
    super(layer, gestures, { minSizeMm: MIN_FRAME_SIZE_MM });
  }

  /** The snap grid for resizing, or `null` (free resize). */
  setSnapGrid(grid: SnapGrid | null): void {
    this.snapGrid = grid;
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

  /**
   * Resize snapping: converts the box (screen px, rotation in radians, `x`/`y` = the frame's
   * top-left corner) into the axis-aligned box in world mm, snaps it and converts it back. No
   * change for the rotation handles, with Alt, without a grid or for other rotations.
   */
  protected override adjustBox(newBox: Box): Box {
    const anchor = this.transformer.getActiveAnchor() ?? '';
    const layer = this.transformer.getLayer();
    const quarterTurns = quarterTurnsOf(newBox.rotation);
    if (
      !this.snapGrid ||
      this.altPressed ||
      !RESIZE_ANCHORS.has(anchor) ||
      !layer ||
      quarterTurns === null ||
      !(newBox.width > 0 && newBox.height > 0)
    ) {
      return newBox;
    }
    const toScreen = layer.getAbsoluteTransform();
    const scale = layer.getAbsoluteScale().x;
    const cos = Math.cos(newBox.rotation);
    const sin = Math.sin(newBox.rotation);
    const corner = toScreen.copy().invert().point({ x: newBox.x, y: newBox.y });
    const widthMm = newBox.width / scale;
    const heightMm = newBox.height / scale;
    // Centre of the frame (world mm): from the top-left corner along the rotated frame axes.
    const cx = corner.x + (widthMm * cos - heightMm * sin) / 2;
    const cy = corner.y + (widthMm * sin + heightMm * cos) / 2;
    const swapped = quarterTurns % 2 === 1;
    const worldWidth = swapped ? heightMm : widthMm;
    const worldHeight = swapped ? widthMm : heightMm;
    const snapped = snapResizeRect(
      { x: cx - worldWidth / 2, y: cy - worldHeight / 2, width: worldWidth, height: worldHeight },
      movingEdgesOf(anchor, quarterTurns),
      this.keepAspect,
      this.snapGrid,
    );
    const newWidthMm = swapped ? snapped.height : snapped.width;
    const newHeightMm = swapped ? snapped.width : snapped.height;
    const newCx = snapped.x + snapped.width / 2;
    const newCy = snapped.y + snapped.height / 2;
    const newCorner = toScreen.point({
      x: newCx - (newWidthMm * cos - newHeightMm * sin) / 2,
      y: newCy - (newWidthMm * sin + newHeightMm * cos) / 2,
    });
    return {
      x: newCorner.x,
      y: newCorner.y,
      width: newWidthMm * scale,
      height: newHeightMm * scale,
      rotation: newBox.rotation,
    };
  }
}

/** Number of clockwise quarter turns (0..3) of a rotation in radians, or `null` if it is not a multiple of 90°. */
function quarterTurnsOf(rotationRad: number): number | null {
  const deg = (rotationRad * 180) / Math.PI;
  const turns = Math.round(deg / QUARTER_TURN_DEG);
  if (
    !Number.isFinite(deg) ||
    Math.abs(deg - turns * QUARTER_TURN_DEG) > QUARTER_TURN_TOLERANCE_DEG
  ) {
    return null;
  }
  return ((turns % SIDES.length) + SIDES.length) % SIDES.length;
}

/**
 * The world edges a resize handle moves: the frame sides in the anchor name, turned with the frame
 * (e.g. 'middle-right' of a frame rotated by 90° moves the bottom edge on the page).
 */
function movingEdgesOf(anchor: string, quarterTurns: number): MovingEdges {
  const edges: MovingEdges = { x: null, y: null };
  for (const [index, side] of SIDES.entries()) {
    if (anchor.includes(side)) {
      setEdge(edges, SIDES[(index + quarterTurns) % SIDES.length]);
    }
  }
  return edges;
}

function setEdge(edges: MovingEdges, worldSide: Side): void {
  if (worldSide === 'left' || worldSide === 'right') {
    edges.x = worldSide === 'left' ? 'start' : 'end';
  } else {
    edges.y = worldSide === 'top' ? 'start' : 'end';
  }
}
