// Konva nodes of one photo. Plain class without Angular; owned by `CollageRenderer`.
import Konva from 'konva/lib/Core';
import { Image as KonvaImage } from 'konva/lib/shapes/Image';
import { Line as KonvaLine } from 'konva/lib/shapes/Line';
import { Rect as KonvaRect } from 'konva/lib/shapes/Rect';
import type { GetClientRectConfig } from 'konva/lib/Node';
import type { IRect } from 'konva/lib/types';
import { BorderSettings, defaultCollageSettings } from '../../../core/models/collage';
import type { NormalizedRect, PhotoAdjust, PhotoProps } from '../../../core/models/photo';
import type { Shadow } from '../../../core/models/shadow';
import { BorderLayout, borderLayout, CornersLayout, coverPart } from '../border-geometry';
import { fullCrop } from '../geometry/crop';
import type { FrameBox } from '../geometry/transform';
import { effectiveBorder } from '../photo-border';
import { effectiveShadow } from '../photo-shadow';
import { adjustedImage, isNeutralAdjust } from './adjusted-image';
import { DRAG_THRESHOLD_PX } from './canvas-theme';
import { isLoaded } from './image-cache';
import type { Point } from './viewport';

/** Konva name of the photo groups. */
const PHOTO_NAME = 'photo';
const PLACEHOLDER_FILL = '#c8c8c8';
/** Fill of the shadow-casting rect; any opaque colour (the photo covers it). */
const SHADOW_CASTER_FILL = '#000000';
/** Border used before the first `update` (no collage default known yet): type `none`. */
const FALLBACK_BORDER = defaultCollageSettings().defaultBorder;
/**
 * Fixed soft shadow of the photo corners (not configurable), relative to the leg length: black,
 * 35 % opacity, blur 8 % of the leg, offset 3 % of the leg to the right and down (world direction,
 * not rotated with the frame, same as the photo drop shadow).
 */
const CORNER_SHADOW = { color: '#000000', opacity: 0.35, blur: 0.08, offset: 0.03 } as const;

/**
 * Outer group of a `PhotoView`. Konva measures a group by its children and ignores clips; photo
 * corners stick out of the frame, so with corners the group reports `frameBounds` (frame-local
 * mm, without shadows) instead. The selection transformer (box, handles, resize snapping and
 * scaling) and `bottomCentreOf` then see the frame only, as for the other border types. Measuring
 * for drawing (`_forDrawing`, isolated groups) keeps Konva's own result.
 */
class PhotoGroup extends Konva.Group {
  /** Rect to report as bounds in frame-local mm; `null` = Konva's measurement of the children. */
  frameBounds: IRect | null = null;

  override getClientRect(config: GetClientRectConfig = {}): IRect {
    const bounds = this.frameBounds;
    if (!bounds || config._forDrawing) {
      return super.getClientRect(config);
    }
    return config.skipTransform ? { ...bounds } : this._transformedRect(bounds, config.relativeTo);
  }
}

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
 *    rect itself is hidden under the photo and does not listen to events),
 * 2. an inner group clipped to the frame with the border (a rect of frame size filled with the
 *    border colour or the Polaroid card colour, hidden without a border) and, on top of it, a group
 *    clipped to the area inside the border with the image. The border layout comes from
 *    `borderLayout` (`border-geometry.ts`): without a border and with a colour border the image is
 *    the source crop at frame size (the border covers its edges); with a Polaroid border it is the
 *    centred part of the crop with the aspect of the inner area, drawn at the inner area (cover-fit,
 *    the stored crop is not changed), and
 * 3. with photo corners, four closed triangle lines on top of the clipped group, directly in the
 *    outer group (not clipped): they stick out of the frame by a small gap (`CORNER_GAP_RATIO` in
 *    `border-geometry.ts`), so the frame clip must not cut them. They listen (a click on them
 *    selects the photo) and each has a small fixed soft shadow (`CORNER_SHADOW`), which is not cut
 *    by the frame either.
 *
 * The image is clipped to the inner area and not only drawn under a border stroke: with a stroke on
 * top, the anti-aliased pixels at the outer frame edge mix image and border, and a thin line of the
 * image shows around the border.
 *
 * Shadow blur and offset are world mm: Konva multiplies them by the absolute scale and the pixel
 * ratio when it draws, so they keep their mm size at every zoom and in the export. The offset is
 * not rotated with the frame (same light direction for all photos).
 *
 * With an adjustment (`props.adjust`, not neutral) the image is an adjusted copy of the source
 * (`adjustedImage`, same size as the source, so the crop in source px applies unchanged). The copy
 * is kept and only rebuilt when the source or the adjustment values change.
 *
 * Frame-local coordinates are mm with the origin at the top-left frame corner (both groups).
 * The outer group is a `PhotoGroup`: with photo corners its bounds (selection handles,
 * `bottomCentreOf`) are the frame, without the parts of the corners outside it.
 */
export class PhotoView {
  /** Outer group: position, rotation, drag (the node all other code uses). */
  readonly group: PhotoGroup;
  /** Inner group clipped to the frame. */
  private readonly content: Konva.Group;
  /** Group of the image, clipped to the area inside the border. */
  private readonly picture: Konva.Group;
  private readonly shadowCaster: KonvaRect;
  private readonly image: KonvaImage;
  private readonly border: KonvaRect;
  /** The four photo-corner triangles (in the outer group, not clipped); hidden for the other types. */
  private readonly corners: KonvaLine[];
  private source: HTMLImageElement | null = null;
  /** Frame size in mm of the last `showProps`. */
  private frameWidthMm = 0;
  private frameHeightMm = 0;
  /** Border layout of the last `showProps`; decides where and how the crop is drawn. */
  private layout: BorderLayout | null = null;
  private crop: NormalizedRect = fullCrop();
  private adjust: PhotoAdjust | null = null;
  /** Last adjusted copy of the source and the key it was made for; `null` without one. */
  private adjusted: { key: AdjustKey; canvas: HTMLCanvasElement } | null = null;
  private defaultBorder: BorderSettings | null = null;
  private defaultShadow: Shadow | null = null;
  /** True while a drag or transform changes the group; `update` then keeps the gesture's geometry. */
  private inGesture = false;

  /** @param events drag events; without them the view is static (not draggable, e.g. the export). */
  constructor(
    readonly id: number,
    events?: PhotoViewEvents,
  ) {
    this.group = new PhotoGroup({
      name: PHOTO_NAME,
      draggable: events !== undefined,
      dragDistance: DRAG_THRESHOLD_PX,
    });
    this.image = new KonvaImage({
      image: undefined,
      fill: PLACEHOLDER_FILL,
      perfectDrawEnabled: false,
    });
    // Listens: the image is clipped to the area inside the border, so the border must take the
    // clicks on its part of the frame.
    this.border = new KonvaRect({ perfectDrawEnabled: false });
    this.shadowCaster = new KonvaRect({
      fill: SHADOW_CASTER_FILL,
      listening: false,
      perfectDrawEnabled: false,
      visible: false,
    });
    this.picture = new Konva.Group();
    this.picture.add(this.image);
    this.corners = Array.from(
      { length: 4 },
      () => new KonvaLine({ closed: true, visible: false, perfectDrawEnabled: false }),
    );
    this.content = new Konva.Group();
    this.content.add(this.border, this.picture);
    // The corners stick out of the frame: in the outer group above the clipped content.
    this.group.add(this.shadowCaster, this.content, ...this.corners);
    if (events) {
      this.group.on('dragstart', () => events.onDragStart(this));
      this.group.on('dragmove', (event) => events.onDragMove(this, event.evt));
      this.group.on('dragend', () => events.onDragEnd(this));
    }
  }

  /** Frame width and height in mm (as drawn, without a pending transformer scale). */
  get widthMm(): number {
    return this.frameWidthMm;
  }

  get heightMm(): number {
    return this.frameHeightMm;
  }

  /** Shows the props of the scene; ignored while a gesture changes this photo. */
  update(props: PhotoProps, defaultBorder: BorderSettings, defaultShadow: Shadow): void {
    this.defaultBorder = defaultBorder;
    this.defaultShadow = defaultShadow;
    if (!this.inGesture) {
      this.showProps(props);
    }
  }

  /** Draws frame, crop, adjustment, border and shadow of the props (scale reset to 1). */
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
    this.frameWidthMm = widthMm;
    this.frameHeightMm = heightMm;
    this.content.clip({ x: 0, y: 0, width: widthMm, height: heightMm });
    this.adjust = props.adjust ?? null;
    this.drawBorder(props);
    this.showCrop(props.crop);
    this.drawShadow(props);
  }

  /** Shows another part of the source image in the frame (crop mode preview). */
  showCrop(crop: NormalizedRect): void {
    this.crop = crop;
    this.applySource();
  }

  /** Sets the source image; it is shown once it has loaded (placeholder colour until then). */
  setImage(image: HTMLImageElement): void {
    if (image !== this.source) {
      this.adjusted = null;
    }
    this.source = image;
    this.applySource();
  }

  /**
   * Where the image is drawn in frame-local mm and whether only the cover part of the crop is drawn
   * there (see `BorderLayout.image` / `cover`). Before the first `showProps`: the frame, no cover.
   */
  imageLayout(): Pick<BorderLayout, 'image' | 'cover'> {
    return (
      this.layout ?? {
        image: { x: 0, y: 0, width: this.frameWidthMm, height: this.frameHeightMm },
        cover: false,
      }
    );
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

  /**
   * Border of the effective border (own or collage default) inside the frame: a filled rect of
   * frame size; the image is placed at the layout's image rect and clipped to the area inside the
   * border. The crop is applied later by `applySource` (it uses the stored layout).
   */
  private drawBorder(props: PhotoProps): void {
    const border = effectiveBorder(props, this.defaultBorder ?? FALLBACK_BORDER);
    const layout = borderLayout(border, props.widthMm, props.heightMm);
    const { fill, inner } = layout;
    this.layout = layout;
    this.image.position({ x: layout.image.x, y: layout.image.y });
    this.image.size({ width: layout.image.width, height: layout.image.height });
    this.border.setAttrs({
      width: props.widthMm,
      height: props.heightMm,
      visible: fill !== null,
    });
    if (fill !== null) {
      this.border.fill(fill);
    }
    this.picture.clip(inner);
    // Konva ignores a clip of zero size and would draw the whole image: hide it instead.
    this.picture.visible(inner.width > 0 && inner.height > 0);
    this.drawCorners(layout.corners);
  }

  /**
   * The photo-corner triangles of the layout with their fixed shadow; hidden without corners. With
   * visible corners the group reports the frame as its bounds (see `PhotoGroup`).
   */
  private drawCorners(corners: CornersLayout | null): void {
    const visible = corners !== null && corners.legMm > 0;
    this.group.frameBounds = visible
      ? { x: 0, y: 0, width: this.frameWidthMm, height: this.frameHeightMm }
      : null;
    this.corners.forEach((line, index) => {
      if (!visible) {
        line.visible(false);
        return;
      }
      const leg = corners.legMm;
      line.setAttrs({
        points: corners.triangles[index],
        fill: corners.color,
        visible: true,
        shadowEnabled: true,
        shadowColor: CORNER_SHADOW.color,
        shadowOpacity: CORNER_SHADOW.opacity,
        shadowBlur: CORNER_SHADOW.blur * leg,
        shadowOffsetX: CORNER_SHADOW.offset * leg,
        shadowOffsetY: CORNER_SHADOW.offset * leg,
      });
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

  /**
   * Shows the source (or its adjusted copy) with the current crop (in source pixels), or the
   * placeholder until it is loaded. With a cover-fit layout (Polaroid) only the centred part of the
   * crop with the aspect of the image rect is drawn.
   */
  private applySource(): void {
    const image = this.loadedImage();
    // Remove the placeholder colour instead of `fillEnabled(false)`: a disabled fill also removes the
    // shape from Konva's hit graph, and the photo could no longer be clicked.
    this.image.fill(image ? '' : PLACEHOLDER_FILL);
    this.image.image(image ? this.adjustedSource(image) : undefined);
    if (image) {
      const crop = {
        x: this.crop.x * image.naturalWidth,
        y: this.crop.y * image.naturalHeight,
        width: this.crop.width * image.naturalWidth,
        height: this.crop.height * image.naturalHeight,
      };
      const layout = this.layout;
      this.image.crop(
        layout?.cover ? coverPart(crop, layout.image.width, layout.image.height) : crop,
      );
    }
  }

  /**
   * The loaded source, or its adjusted copy if the adjustment is not neutral. The copy is rebuilt
   * only when the key changes; it is dropped when the adjustment is neutral.
   */
  private adjustedSource(image: HTMLImageElement): HTMLImageElement | HTMLCanvasElement {
    const adjust = this.adjust;
    if (!adjust || isNeutralAdjust(adjust)) {
      this.adjusted = null;
      return image;
    }
    const key: AdjustKey = { image, ...adjust };
    if (!this.adjusted || !sameAdjustKey(this.adjusted.key, key)) {
      this.adjusted = { key, canvas: adjustedImage(image, adjust) };
    }
    return this.adjusted.canvas;
  }
}

/** What an adjusted copy is made from: the source element and the adjustment values. */
interface AdjustKey extends PhotoAdjust {
  image: HTMLImageElement;
}

function sameAdjustKey(a: AdjustKey, b: AdjustKey): boolean {
  return (
    a.image === b.image &&
    a.brightness === b.brightness &&
    a.contrast === b.contrast &&
    a.tintColor === b.tintColor &&
    a.tintStrength === b.tintStrength
  );
}
