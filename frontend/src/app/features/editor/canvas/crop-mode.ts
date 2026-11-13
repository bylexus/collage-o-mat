// Crop mode of one photo: pan and zoom the image inside its frame. Plain class without Angular.
import Konva from 'konva/lib/Core';
import type { KonvaEventObject } from 'konva/lib/Node';
import { Image as KonvaImage } from 'konva/lib/shapes/Image';
import { Rect as KonvaRect } from 'konva/lib/shapes/Rect';
import type { NormalizedRect, PhotoProps } from '../../../core/models/photo';
import { coverCrop } from '../geometry/crop';
import { clamp } from '../geometry/numbers';
import { panCrop, zoomCrop } from '../geometry/transform';
import type { ImageSize } from '../geometry/transform';
import { SELECTION_COLOR, SELECTION_STROKE_PX } from './canvas-theme';
import type { PhotoView } from './photo-view';
import { pointInElement } from './pointer';
import type { PressGestureTracker } from './press-gesture';
import { sameCrop, sameGeometry, ScenePhoto } from './scene';
import { Point, wheelZoomFactor } from './viewport';

/** Konva event namespace of the crop mode listeners on the photo group. */
const EVENT_NAMESPACE = '.cropMode';
/** Opacity of the full source image shown around the frame. */
const GHOST_OPACITY = 0.35;
/** Smallest crop zoom: the cover crop (largest crop with the frame aspect). */
export const CROP_MIN_ZOOM = 1;
/** Largest crop zoom (crop width = cover crop width / zoom). */
export const CROP_MAX_ZOOM = 5;
/** A wheel zoom is committed this long after its last change (ms). */
const ZOOM_COMMIT_DELAY_MS = 300;
/** `MouseEvent.button` of the primary (left) button. */
const PRIMARY_BUTTON = 0;
const ESCAPE_KEY = 'Escape';
/** Normalized centre of the frame (zoom anchor of the slider). */
const FRAME_CENTRE: Readonly<Point> = { x: 0.5, y: 0.5 };

/** What the crop mode controls (zoom slider) show. */
export interface CropModeState {
  photoId: number;
  /** Current zoom, `CROP_MIN_ZOOM`..`CROP_MAX_ZOOM`. */
  zoom: number;
  minZoom: number;
  maxZoom: number;
  /** Container px: horizontal centre and bottom of the frame's bounding box (rotation included). */
  anchor: Point;
}

/** Events of the crop mode to its owner. */
export interface CropModeCallbacks {
  /** A committed crop change: the complete new props of the photo. */
  onCommit: (photoId: number, props: PhotoProps) => void;
  /** The zoom changed, or crop mode ended (`null`). */
  onStateChange: (state: CropModeState | null) => void;
}

/** The photo in crop mode. */
interface CropSession {
  view: PhotoView;
  image: ImageSize;
  /** Props at the start or of the last commit; a scene with another frame or crop ends crop mode. */
  props: PhotoProps;
  /** The crop shown now; ahead of `props.crop` until it is committed. */
  crop: NormalizedRect;
}

/** A drag inside the frame. */
interface PanGesture {
  pointerId: number;
  /** Frame-local mm of the press. */
  start: Point;
  startCrop: NormalizedRect;
}

/**
 * Crop mode of one photo. The full source image is shown semi-transparent around the frame (lined
 * up with the frame content, rotation included) with an outline of the frame on top.
 *
 * - Drag inside the frame pans the image; committed on release.
 * - Wheel over the frame (see `handleWheel`) zooms the crop; committed `ZOOM_COMMIT_DELAY_MS`
 *   after the last change.
 * - `setZoom` (slider) zooms the crop live; `commitZoom` commits it (slider released).
 * - `Esc` ends crop mode (pending changes are committed); the owner ends it for other reasons.
 *
 * The owner must call `sync` after each scene update: a changed frame or crop of the photo (undo,
 * re-arrange) or its removal ends crop mode and drops an uncommitted zoom.
 */
export class CropMode {
  private readonly ghost = new Konva.Group({ listening: false, visible: false });
  private readonly ghostImage = new KonvaImage({
    image: undefined,
    opacity: GHOST_OPACITY,
    perfectDrawEnabled: false,
  });
  private readonly outline = new KonvaRect({
    stroke: SELECTION_COLOR,
    strokeWidth: SELECTION_STROKE_PX,
    strokeScaleEnabled: false,
    listening: false,
    visible: false,
  });
  private session: CropSession | null = null;
  private pan: PanGesture | null = null;
  private commitTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly layer: Konva.Layer,
    private readonly gestures: PressGestureTracker,
    private readonly callbacks: CropModeCallbacks,
  ) {
    this.ghost.add(this.ghostImage);
    layer.add(this.ghost, this.outline);
  }

  /** Id of the photo in crop mode, or `null`. */
  get photoId(): number | null {
    return this.session?.view.id ?? null;
  }

  /** Starts crop mode for a photo (ends a running one first, committing its changes). */
  start(view: PhotoView, photo: ScenePhoto): void {
    this.end(true);
    this.session = { view, image: photo.image, props: photo.props, crop: photo.props.crop };
    view.group.on(`pointerdown${EVENT_NAMESPACE}`, (event) => this.onPointerDown(event));
    window.addEventListener('keydown', this.onKeyDown, true);
    this.ghost.visible(true);
    this.outline.visible(true);
    this.drawOverlay();
    this.notify();
  }

  /** Ends crop mode; pending changes are committed or dropped. */
  end(commitPending: boolean): void {
    const session = this.session;
    if (!session) {
      return;
    }
    if (commitPending) {
      this.commitPending();
    } else {
      this.cancelCommitTimer();
    }
    this.stopPan();
    session.view.group.off(EVENT_NAMESPACE);
    window.removeEventListener('keydown', this.onKeyDown, true);
    this.ghost.visible(false);
    this.outline.visible(false);
    this.session = null;
    this.layer.batchDraw();
    this.callbacks.onStateChange(null);
  }

  /**
   * Follows a scene update. The photo keeps crop mode while its frame and crop are the committed
   * ones (border or z changes are taken over); otherwise crop mode ends without committing.
   */
  sync(view: PhotoView | undefined, photo: ScenePhoto | undefined): void {
    const session = this.session;
    if (!session) {
      return;
    }
    if (view !== session.view || !photo || !sameGeometry(photo.props, session.props)) {
      this.end(false);
      return;
    }
    session.props = photo.props;
    session.image = photo.image;
    view.showCrop(session.crop);
    this.drawOverlay();
  }

  /** Draws the overlay again (e.g. after the source image has loaded). */
  redraw(): void {
    this.drawOverlay();
  }

  /** True if the node belongs to the photo in crop mode. */
  contains(node: Konva.Node): boolean {
    return this.session?.view.contains(node) ?? false;
  }

  /** Puts the overlay in front: source image, then the photo, then the frame outline. */
  raise(): void {
    if (this.session) {
      this.ghost.moveToTop();
      this.session.view.group.moveToTop();
      this.outline.moveToTop();
    }
  }

  /**
   * Wheel over the frame zooms the crop at the pointer (container px). Returns false (not handled)
   * outside crop mode or outside the frame.
   */
  handleWheel(pointer: Point, deltaYPx: number): boolean {
    const session = this.session;
    if (!session) {
      return false;
    }
    const local = session.view.toLocal(pointer);
    const { widthMm, heightMm } = session.view;
    if (local.x < 0 || local.y < 0 || local.x > widthMm || local.y > heightMm) {
      return false;
    }
    if (this.zoomBy(wheelZoomFactor(deltaYPx), { x: local.x / widthMm, y: local.y / heightMm })) {
      this.scheduleCommit();
    }
    return true;
  }

  /** Sets the zoom around the frame centre while the slider moves (not committed). */
  setZoom(zoom: number): void {
    const session = this.session;
    if (session) {
      this.cancelCommitTimer();
      this.zoomBy(zoom / this.zoomOf(session), FRAME_CENTRE);
    }
  }

  /** Commits the zoom of the slider (slider released). */
  commitZoom(): void {
    this.commitPending();
  }

  /** The view (pan/zoom of the stage) changed: reports the new position of the frame. */
  viewChanged(): void {
    this.notify();
  }

  /** Stops listeners and timers without callbacks (the Konva nodes go with the stage). */
  destroy(): void {
    this.cancelCommitTimer();
    this.stopPan();
    window.removeEventListener('keydown', this.onKeyDown, true);
    this.session = null;
  }

  /**
   * Zooms by `factor` (limited to the zoom range) around a normalized frame point. Returns false
   * if the zoom did not change.
   */
  private zoomBy(factor: number, anchor: Point): boolean {
    const session = this.session;
    if (!session) {
      return false;
    }
    const zoom = this.zoomOf(session);
    const limitedFactor = clamp(zoom * factor, CROP_MIN_ZOOM, CROP_MAX_ZOOM) / zoom;
    if (limitedFactor === 1) {
      return false;
    }
    this.showCrop(session, zoomCrop(session.crop, limitedFactor, anchor));
    this.notify();
    return true;
  }

  /** Zoom of the shown crop: cover crop width / crop width. */
  private zoomOf(session: CropSession): number {
    const { props, image, crop } = session;
    const cover = coverCrop(image.widthPx / image.heightPx, props.widthMm / props.heightMm);
    return cover.width / crop.width;
  }

  private showCrop(session: CropSession, crop: NormalizedRect): void {
    session.crop = crop;
    session.view.showCrop(crop);
    this.drawOverlay();
    this.layer.batchDraw();
  }

  /**
   * Lines the overlay up with the frame. In frame-local mm the crop fills the frame, so the whole
   * image is `width / crop.width` wide and starts at `-crop.x` of that width (same for y).
   */
  private drawOverlay(): void {
    const session = this.session;
    if (!session) {
      return;
    }
    const { view, crop } = session;
    const frame = view.frameTransform();
    const imageWidth = view.widthMm / crop.width;
    const imageHeight = view.heightMm / crop.height;
    const source = view.loadedImage();
    this.ghost.setAttrs(frame);
    this.ghostImage.setAttrs({
      image: source ?? undefined,
      visible: source !== null,
      x: -crop.x * imageWidth,
      y: -crop.y * imageHeight,
      width: imageWidth,
      height: imageHeight,
    });
    this.outline.setAttrs({ ...frame, width: view.widthMm, height: view.heightMm });
  }

  private notify(): void {
    const session = this.session;
    if (session) {
      this.callbacks.onStateChange({
        photoId: session.view.id,
        zoom: this.zoomOf(session),
        minZoom: CROP_MIN_ZOOM,
        maxZoom: CROP_MAX_ZOOM,
        anchor: this.anchorOf(session),
      });
    }
  }

  /** Bottom centre of the frame's bounding box in container px. */
  private anchorOf(session: CropSession): Point {
    const box = session.view.group.getClientRect({ skipShadow: true, skipStroke: true });
    return { x: box.x + box.width / 2, y: box.y + box.height };
  }

  private scheduleCommit(): void {
    this.cancelCommitTimer();
    this.commitTimer = setTimeout(() => this.commitPending(), ZOOM_COMMIT_DELAY_MS);
  }

  private cancelCommitTimer(): void {
    if (this.commitTimer !== null) {
      clearTimeout(this.commitTimer);
      this.commitTimer = null;
    }
  }

  /** Commits the shown crop if it differs from the committed one. */
  private commitPending(): void {
    this.cancelCommitTimer();
    const session = this.session;
    if (!session || sameCrop(session.crop, session.props.crop)) {
      return;
    }
    session.props = { ...session.props, crop: session.crop };
    this.callbacks.onCommit(session.view.id, session.props);
  }

  private onPointerDown(event: KonvaEventObject<PointerEvent>): void {
    const session = this.session;
    const evt = event.evt;
    if (!session || evt.button !== PRIMARY_BUTTON || this.pan) {
      return;
    }
    // A pending zoom is its own change (undo step), separate from the pan.
    this.commitPending();
    this.pan = {
      pointerId: evt.pointerId,
      start: session.view.toLocal(this.pointerOf(evt)),
      startCrop: session.crop,
    };
    window.addEventListener('pointermove', this.onPanMove);
    window.addEventListener('pointerup', this.onPanEnd);
    window.addEventListener('pointercancel', this.onPanEnd);
  }

  /** Pans from the start crop by the pointer movement in frame-local mm (clamping stays exact). */
  private readonly onPanMove = (event: PointerEvent): void => {
    const pan = this.pan;
    const session = this.session;
    if (!pan || !session || event.pointerId !== pan.pointerId) {
      return;
    }
    const local = session.view.toLocal(this.pointerOf(event));
    const crop = panCrop(
      pan.startCrop,
      local.x - pan.start.x,
      local.y - pan.start.y,
      session.view.widthMm,
      session.view.heightMm,
    );
    this.gestures.markGesture();
    this.showCrop(session, crop);
  };

  private readonly onPanEnd = (event: PointerEvent): void => {
    if (event.pointerId !== this.pan?.pointerId) {
      return;
    }
    this.stopPan();
    this.commitPending();
  };

  private stopPan(): void {
    this.pan = null;
    window.removeEventListener('pointermove', this.onPanMove);
    window.removeEventListener('pointerup', this.onPanEnd);
    window.removeEventListener('pointercancel', this.onPanEnd);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === ESCAPE_KEY) {
      event.preventDefault();
      event.stopPropagation();
      this.end(true);
    }
  };

  private pointerOf(event: MouseEvent): Point {
    return pointInElement(this.layer.getStage().container(), event);
  }
}
