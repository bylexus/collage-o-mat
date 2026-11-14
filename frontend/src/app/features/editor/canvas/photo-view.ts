// Konva nodes of one photo. Plain class without Angular; owned by `CollageRenderer`.
import Konva from 'konva/lib/Core';
import { Image as KonvaImage } from 'konva/lib/shapes/Image';
import { Rect as KonvaRect } from 'konva/lib/shapes/Rect';
import type { BorderSettings } from '../../../core/models/collage';
import type { NormalizedRect, PhotoProps } from '../../../core/models/photo';
import type { Shadow } from '../../../core/models/shadow';
import { fullCrop } from '../geometry/crop';
import type { FrameBox } from '../geometry/transform';
import { effectiveShadow } from '../photo-shadow';
import { DRAG_THRESHOLD_PX } from './canvas-theme';
import { isLoaded } from './image-cache';
import type { Point } from './viewport';

/** Konva name of the photo groups. */
const PHOTO_NAME = 'photo';
const PLACEHOLDER_FILL = '#c8c8c8';
/** Fill of the shadow-casting rect; any opaque colour (the photo covers it). */
const SHADOW_CASTER_FILL = '#000000';

/** The photo group that contains the node (or is the node), or `null`. */
export function photoGroupOf(node: Konva.Node): Konva.Node | null {
  return node.findAncestor(`.${PHOTO_NAME}`, true) ?? null;
}

/** Drag events of a photo view to its owner. */
export interface PhotoViewEvents {
  onDragStart: (view: PhotoView) => void;
  /**
   * After each drag step (Konva has moved the group, before the layer is drawn): the owner may
   * adjust the position. `event` is the native pointer event of the step.
   */
  onDragMove: (view: PhotoView, event: Event | undefined) => void;
  onDragEnd: (view: PhotoView) => void;
}

/** Position, centre offset and rotation of a frame: the attributes overlays copy to line up with it. */
export interface FrameTransform {
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  rotation: number;
}

/**
 * The Konva nodes of one placed photo: a group at the frame centre (rotated, draggable, not
 * clipped) with
 * 1. a rect of frame size that only casts the drop shadow (a clip would cut the shadow off; the
 *    rect itself is hidden under the photo and does not listen to events), and
 * 2. an inner group clipped to the frame with the image (source crop) and the border (stroke
 *    inside the frame).
 *
 * Shadow blur and offset are world mm: Konva multiplies them by the absolute scale and the pixel
 * ratio when it draws, so they keep their mm size at every zoom and in the export. The offset is
 * not rotated with the frame (same light direction for all photos).
 *
 * Frame-local coordinates are mm with the origin at the top-left frame corner (both groups).
 */
export class PhotoView {
  /** Outer group: position, rotation, drag (the node all other code uses). */
  readonly group: Konva.Group;
  /** Inner group clipped to the frame. */
  private readonly content: Konva.Group;
  private readonly shadowCaster: KonvaRect;
  private readonly image: KonvaImage;
  private readonly border: KonvaRect;
  private source: HTMLImageElement | null = null;
  private crop: NormalizedRect = fullCrop();
  private defaultBorder: BorderSettings | null = null;
  private defaultShadow: Shadow | null = null;
  /** True while a drag or transform changes the group; `update` then keeps the gesture's geometry. */
  private inGesture = false;

  /** @param events drag events; without them the view is static (not draggable, e.g. the export). */
  constructor(
    readonly id: number,
    events?: PhotoViewEvents,
  ) {
    this.group = new Konva.Group({
      name: PHOTO_NAME,
      draggable: events !== undefined,
      dragDistance: DRAG_THRESHOLD_PX,
    });
    this.image = new KonvaImage({
      image: undefined,
      fill: PLACEHOLDER_FILL,
      perfectDrawEnabled: false,
    });
    this.border = new KonvaRect({ listening: false, perfectDrawEnabled: false });
    this.shadowCaster = new KonvaRect({
      fill: SHADOW_CASTER_FILL,
      listening: false,
      perfectDrawEnabled: false,
      visible: false,
    });
    this.content = new Konva.Group();
    this.content.add(this.image, this.border);
    this.group.add(this.shadowCaster, this.content);
    if (events) {
      this.group.on('dragstart', () => events.onDragStart(this));
      this.group.on('dragmove', (event) => events.onDragMove(this, event.evt));
      this.group.on('dragend', () => events.onDragEnd(this));
    }
  }

  /** Frame width and height in mm (as drawn, without a pending transformer scale). */
  get widthMm(): number {
    return this.image.width();
  }

  get heightMm(): number {
    return this.image.height();
  }

  /** Shows the props of the scene; ignored while a gesture changes this photo. */
  update(props: PhotoProps, defaultBorder: BorderSettings, defaultShadow: Shadow): void {
    this.defaultBorder = defaultBorder;
    this.defaultShadow = defaultShadow;
    if (!this.inGesture) {
      this.showProps(props);
    }
  }

  /** Draws frame, crop, border and shadow of the props (scale reset to 1). */
  showProps(props: PhotoProps): void {
    const { cxMm, cyMm, widthMm, heightMm, rotationDeg } = props;
    this.group.setAttrs({
      x: cxMm,
      y: cyMm,
      scaleX: 1,
      scaleY: 1,
      offsetX: widthMm / 2,
      offsetY: heightMm / 2,
      rotation: rotationDeg,
    });
    this.content.clip({ x: 0, y: 0, width: widthMm, height: heightMm });
    this.image.size({ width: widthMm, height: heightMm });
    this.showCrop(props.crop);
    this.drawBorder(props);
    this.drawShadow(props);
  }

  /** Shows another part of the source image in the frame (crop mode preview). */
  showCrop(crop: NormalizedRect): void {
    this.crop = crop;
    this.applySource();
  }

  /** Sets the source image; it is shown once it has loaded (placeholder colour until then). */
  setImage(image: HTMLImageElement): void {
    this.source = image;
    this.applySource();
  }

  /** The source image if it has loaded. */
  loadedImage(): HTMLImageElement | null {
    return this.source && isLoaded(this.source) ? this.source : null;
  }

  /**
   * The frame as currently drawn, including a move or transformer scale not yet committed. The
   * rotation is Konva's (not normalized; `applyFrameBox` normalizes it).
   */
  frameBox(): FrameBox {
    return {
      cxMm: this.group.x(),
      cyMm: this.group.y(),
      widthMm: this.widthMm * Math.abs(this.group.scaleX()),
      heightMm: this.heightMm * Math.abs(this.group.scaleY()),
      rotationDeg: this.group.rotation(),
    };
  }

  /** Position, offset and rotation of the group (for overlays that must line up with the frame). */
  frameTransform(): FrameTransform {
    return {
      x: this.group.x(),
      y: this.group.y(),
      offsetX: this.group.offsetX(),
      offsetY: this.group.offsetY(),
      rotation: this.group.rotation(),
    };
  }

  /** Converts a point in container px into frame-local mm (rotation and view transform included). */
  toLocal(point: Point): Point {
    return this.group.getAbsoluteTransform().copy().invert().point(point);
  }

  /** True if the node is the group or one of its children. */
  contains(node: Konva.Node): boolean {
    return node === this.group || this.group.isAncestorOf(node);
  }

  setDraggable(draggable: boolean): void {
    if (this.group.draggable() !== draggable) {
      this.group.draggable(draggable);
    }
  }

  /** A drag or transform starts: scene updates must not reset the geometry until `endGesture`. */
  beginGesture(): void {
    this.inGesture = true;
  }

  endGesture(): void {
    this.inGesture = false;
  }

  destroy(): void {
    this.group.destroy();
  }

  /** Border inside the frame: the stroke is centred on its path, so it is inset by half its width. */
  private drawBorder(props: PhotoProps): void {
    const defaults = this.defaultBorder;
    const width = Math.min(
      props.border.widthMm ?? defaults?.widthMm ?? 0,
      props.widthMm / 2,
      props.heightMm / 2,
    );
    this.border.setAttrs({
      x: width / 2,
      y: width / 2,
      width: props.widthMm - width,
      height: props.heightMm - width,
      stroke: props.border.color ?? defaults?.color,
      strokeWidth: width,
      visible: width > 0,
    });
  }

  /** Drop shadow of the effective shadow (own or collage default), cast by a rect of frame size. */
  private drawShadow(props: PhotoProps): void {
    const shadow = this.defaultShadow
      ? effectiveShadow(props, this.defaultShadow)
      : (props.shadow ?? null);
    if (!shadow?.enabled) {
      this.shadowCaster.visible(false);
      return;
    }
    this.shadowCaster.setAttrs({
      width: props.widthMm,
      height: props.heightMm,
      visible: true,
      shadowEnabled: true,
      shadowColor: shadow.color,
      shadowBlur: shadow.blurMm,
      shadowOffsetX: shadow.offsetXMm,
      shadowOffsetY: shadow.offsetYMm,
      shadowOpacity: shadow.opacity,
    });
  }

  /** Shows the source with the current crop (in source pixels), or the placeholder until it is loaded. */
  private applySource(): void {
    const image = this.loadedImage();
    // Remove the placeholder colour instead of `fillEnabled(false)`: a disabled fill also removes the
    // shape from Konva's hit graph, and the photo could no longer be clicked.
    this.image.fill(image ? '' : PLACEHOLDER_FILL);
    this.image.image(image ?? undefined);
    if (image) {
      this.image.crop({
        x: this.crop.x * image.naturalWidth,
        y: this.crop.y * image.naturalHeight,
        width: this.crop.width * image.naturalWidth,
        height: this.crop.height * image.naturalHeight,
      });
    }
  }
}
