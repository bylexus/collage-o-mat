// Konva rendering of a collage. Plain class without Angular; owned by `EditorCanvas`.
// Core + the used shapes only (smaller bundle than the full 'konva' entry).
import Konva from 'konva/lib/Core';
import { Image as KonvaImage } from 'konva/lib/shapes/Image';
import { Rect as KonvaRect } from 'konva/lib/shapes/Rect';
import type { BorderSettings, PageSize } from '../../../core/models/collage';
import type { NormalizedRect, PhotoProps } from '../../../core/models/photo';
import { StageNavigator } from './stage-navigator';
import { frameBounds, Rect, unionRects } from './viewport';

/** A placed photo as the renderer needs it. */
export interface ScenePhoto {
  id: number;
  /** URL of the image file. */
  url: string;
  props: PhotoProps;
}

/** Everything the renderer draws. World units are mm, page origin top-left. */
export interface Scene {
  page: PageSize;
  backgroundColor: string;
  defaultBorder: BorderSettings;
  /** Only placed photos; drawn in `props.z` order. */
  photos: readonly ScenePhoto[];
  selectedPhotoId: number | null;
}

/** Callbacks of the renderer to its owner. */
export interface RendererCallbacks {
  /** Click/tap with the photo id, or `null` for the empty area (not after a pan). */
  onSelect: (photoId: number | null) => void;
  /** The zoom (1 = real size) changed. */
  onZoomChange: (zoom: number) => void;
}

/** Konva nodes of one photo. */
interface PhotoNode {
  /** At the frame centre, rotated, clipped to the frame. */
  group: Konva.Group;
  image: KonvaImage;
  border: KonvaRect;
  crop: NormalizedRect;
}

const PHOTO_NAME = 'photo';
const PLACEHOLDER_FILL = '#c8c8c8';
const SELECTION_COLOR = '#005cbb';
const SELECTION_STROKE_PX = 2;

/**
 * Owns a Konva stage in a container element and draws a `Scene`: page rectangle, photos (image with
 * crop, border inside the frame) and the selection outline. `render` updates the existing nodes
 * (matched by photo id); images are loaded once per photo id. The stage scale is px per mm.
 * Pan and zoom are delegated to a `StageNavigator`; this class is the only entry point for the
 * owning component.
 */
export class CollageRenderer {
  private readonly stage: Konva.Stage;
  private readonly layer = new Konva.Layer();
  private readonly pageRect = new KonvaRect({ x: 0, y: 0, listening: false });
  private readonly selection = new KonvaRect({
    stroke: SELECTION_COLOR,
    strokeWidth: SELECTION_STROKE_PX,
    strokeScaleEnabled: false,
    listening: false,
    visible: false,
  });
  private readonly nodes = new Map<number, PhotoNode>();
  private readonly photoIds = new WeakMap<Konva.Node, number>();
  private readonly images = new Map<number, HTMLImageElement>();
  private readonly navigator: StageNavigator;
  private scene: Scene | null = null;

  constructor(container: HTMLDivElement, callbacks: RendererCallbacks) {
    this.stage = new Konva.Stage({
      container,
      width: container.clientWidth,
      height: container.clientHeight,
    });
    this.layer.add(this.pageRect, this.selection);
    this.stage.add(this.layer);
    this.navigator = new StageNavigator(this.stage, {
      contentBounds: () => this.contentBounds(),
      onZoomChange: callbacks.onZoomChange,
    });
    this.stage.on('click tap', (event) => {
      if (!this.navigator.wasPanGesture()) {
        callbacks.onSelect(this.photoIdOf(event.target));
      }
    });
  }

  /** Draws the scene. The first scene is also zoomed to fit. */
  render(scene: Scene): void {
    this.scene = scene;
    this.pageRect.setAttrs({
      width: scene.page.widthMm,
      height: scene.page.heightMm,
      fill: scene.backgroundColor,
    });
    this.syncPhotos(scene);
    this.updateSelection(scene.selectedPhotoId);
    this.navigator.fitOnce();
    this.layer.batchDraw();
  }

  /** Sets the stage size in px (call when the container size changes). */
  setSize(width: number, height: number): void {
    this.navigator.resize({ width, height });
  }

  /** Shows the page and all photos as large as possible. Returns false if there is nothing to fit. */
  zoomToFit(): boolean {
    return this.navigator.zoomToFit();
  }

  /** Zooms in by one step around the view centre. */
  zoomIn(): void {
    this.navigator.zoomIn();
  }

  /** Zooms out by one step around the view centre. */
  zoomOut(): void {
    this.navigator.zoomOut();
  }

  /** Destroys the stage and stops pending image loads. */
  destroy(): void {
    for (const image of this.images.values()) {
      image.onload = null;
    }
    this.images.clear();
    this.nodes.clear();
    this.navigator.destroy();
    this.stage.destroy();
  }

  /** Page and all placed photos (world mm); `null` before the first scene. */
  private contentBounds(): Rect | null {
    const scene = this.scene;
    if (!scene) {
      return null;
    }
    return unionRects(
      { x: 0, y: 0, width: scene.page.widthMm, height: scene.page.heightMm },
      ...scene.photos.map((photo) => frameBounds(photo.props)),
    );
  }

  private photoIdOf(target: Konva.Node): number | null {
    const group = target.findAncestor(`.${PHOTO_NAME}`, true);
    return (group && this.photoIds.get(group)) ?? null;
  }

  /** Removes nodes of photos that are gone, updates or creates the others and sorts them by z. */
  private syncPhotos(scene: Scene): void {
    const ids = new Set(scene.photos.map((photo) => photo.id));
    for (const id of this.nodes.keys()) {
      if (!ids.has(id)) {
        this.removePhoto(id);
      }
    }
    const byZ = [...scene.photos].sort((a, b) => a.props.z - b.props.z);
    for (const photo of byZ) {
      const node = this.nodes.get(photo.id) ?? this.createPhoto(photo.id);
      this.updatePhoto(node, photo, scene.defaultBorder);
      node.group.moveToTop();
    }
    this.selection.moveToTop();
  }

  private createPhoto(id: number): PhotoNode {
    const group = new Konva.Group({ name: PHOTO_NAME });
    const image = new KonvaImage({
      image: undefined,
      fill: PLACEHOLDER_FILL,
      perfectDrawEnabled: false,
    });
    const border = new KonvaRect({ listening: false, perfectDrawEnabled: false });
    group.add(image, border);
    this.layer.add(group);
    this.photoIds.set(group, id);
    const node: PhotoNode = { group, image, border, crop: { x: 0, y: 0, width: 1, height: 1 } };
    this.nodes.set(id, node);
    return node;
  }

  private removePhoto(id: number): void {
    this.nodes.get(id)?.group.destroy();
    this.nodes.delete(id);
    const image = this.images.get(id);
    if (image) {
      image.onload = null;
      this.images.delete(id);
    }
  }

  private updatePhoto(node: PhotoNode, photo: ScenePhoto, defaultBorder: BorderSettings): void {
    const { cxMm, cyMm, widthMm, heightMm, rotationDeg, crop, border } = photo.props;
    node.group.setAttrs({
      x: cxMm,
      y: cyMm,
      offsetX: widthMm / 2,
      offsetY: heightMm / 2,
      rotation: rotationDeg,
      clip: { x: 0, y: 0, width: widthMm, height: heightMm },
    });
    node.image.size({ width: widthMm, height: heightMm });
    node.crop = crop;
    this.applyImage(node, this.imageOf(photo));

    // The stroke is centred on its path: inset by half the width to keep it inside the frame.
    const borderWidth = Math.min(
      border.widthMm ?? defaultBorder.widthMm,
      widthMm / 2,
      heightMm / 2,
    );
    node.border.setAttrs({
      x: borderWidth / 2,
      y: borderWidth / 2,
      width: widthMm - borderWidth,
      height: heightMm - borderWidth,
      stroke: border.color ?? defaultBorder.color,
      strokeWidth: borderWidth,
      visible: borderWidth > 0,
    });
  }

  /** The cached image of a photo; starts loading it on first use. */
  private imageOf(photo: ScenePhoto): HTMLImageElement {
    let image = this.images.get(photo.id);
    if (!image) {
      const loading = new Image();
      loading.onload = () => {
        const node = this.nodes.get(photo.id);
        if (node) {
          this.applyImage(node, loading);
          this.layer.batchDraw();
        }
      };
      loading.src = photo.url;
      this.images.set(photo.id, loading);
      image = loading;
    }
    return image;
  }

  /** Shows the image with the node's crop (in source pixels), or the placeholder until it is loaded. */
  private applyImage(node: PhotoNode, image: HTMLImageElement): void {
    const loaded = image.complete && image.naturalWidth > 0;
    // Remove the placeholder colour instead of `fillEnabled(false)`: a disabled fill also removes the
    // shape from Konva's hit graph, and the photo could no longer be clicked.
    node.image.fill(loaded ? '' : PLACEHOLDER_FILL);
    if (!loaded) {
      node.image.image(undefined);
      return;
    }
    node.image.image(image);
    node.image.crop({
      x: node.crop.x * image.naturalWidth,
      y: node.crop.y * image.naturalHeight,
      width: node.crop.width * image.naturalWidth,
      height: node.crop.height * image.naturalHeight,
    });
  }

  private updateSelection(selectedPhotoId: number | null): void {
    const node = selectedPhotoId === null ? undefined : this.nodes.get(selectedPhotoId);
    if (!node) {
      this.selection.visible(false);
      return;
    }
    const group = node.group;
    this.selection.setAttrs({
      visible: true,
      x: group.x(),
      y: group.y(),
      offsetX: group.offsetX(),
      offsetY: group.offsetY(),
      rotation: group.rotation(),
      width: node.image.width(),
      height: node.image.height(),
    });
  }
}
