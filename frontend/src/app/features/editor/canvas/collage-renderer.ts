// Konva rendering of a collage. Plain class without Angular; owned by `EditorCanvas`.
// Core + the used shapes only (smaller bundle than the full 'konva' entry).
import Konva from 'konva/lib/Core';
import { Rect as KonvaRect } from 'konva/lib/shapes/Rect';
import type { PhotoProps } from '../../../core/models/photo';
import { applyFrameBox, FrameBox } from '../geometry/transform';
import { CropMode, CropModeState } from './crop-mode';
import { ImageCache } from './image-cache';
import { PhotoTransformer } from './photo-transformer';
import { photoGroupOf, PhotoView } from './photo-view';
import { PressGestureTracker } from './press-gesture';
import { sameGeometry, Scene, ScenePhoto } from './scene';
import { StageNavigator } from './stage-navigator';
import { frameBounds, Rect, unionRects } from './viewport';

export type { Scene, ScenePhoto } from './scene';
export type { CropModeState } from './crop-mode';

/** Callbacks of the renderer to its owner. */
export interface RendererCallbacks {
  /** Click/tap with the photo id, or `null` for the empty area (not after a gesture). */
  onSelect: (photoId: number | null) => void;
  /** The zoom (1 = real size) changed. */
  onZoomChange: (zoom: number) => void;
  /** A committed move, rotation, resize or crop change: the complete new props of the photo. */
  onPhotoChange: (photoId: number, props: PhotoProps) => void;
  /** Crop mode started, its zoom changed, or it ended (`null`). */
  onCropModeChange: (state: CropModeState | null) => void;
}

/**
 * Owns a Konva stage in a container element and draws a `Scene`: page rectangle and photos
 * (`PhotoView`, matched by photo id, images loaded once). The stage scale is px per mm. This class
 * is the only entry point for the owning component; the interactions are delegated:
 *
 * - `StageNavigator`: pan and zoom of the view.
 * - `PhotoTransformer`: handles on the selected photo (rotate, resize).
 * - `PhotoView` drag events: move (an unselected photo is selected first).
 * - `CropMode`: double-click a photo to pan/zoom the image inside its frame.
 *
 * Each interaction reports one `onPhotoChange` when it is committed, never during the gesture.
 */
export class CollageRenderer {
  private readonly stage: Konva.Stage;
  private readonly layer = new Konva.Layer();
  private readonly pageRect = new KonvaRect({ x: 0, y: 0, listening: false });
  private readonly views = new Map<number, PhotoView>();
  private readonly viewsByGroup = new WeakMap<Konva.Node, PhotoView>();
  private readonly images = new ImageCache((photoId, image) => this.onImageLoaded(photoId, image));
  private readonly gestures: PressGestureTracker;
  private readonly navigator: StageNavigator;
  private readonly transformer: PhotoTransformer;
  private readonly cropMode: CropMode;
  private scene: Scene | null = null;

  constructor(
    container: HTMLDivElement,
    private readonly callbacks: RendererCallbacks,
  ) {
    this.stage = new Konva.Stage({
      container,
      width: container.clientWidth,
      height: container.clientHeight,
    });
    this.layer.add(this.pageRect);
    this.stage.add(this.layer);
    // First stage listener: clears the gesture flag before the others can set it.
    this.gestures = new PressGestureTracker(this.stage);
    this.navigator = new StageNavigator(this.stage, {
      gestures: this.gestures,
      contentBounds: () => this.contentBounds(),
      onZoomChange: (zoom) => {
        callbacks.onZoomChange(zoom);
        // Called on every pan/zoom; the crop mode controls follow the frame on screen.
        this.cropMode?.viewChanged();
      },
      interceptWheel: (pointer, deltaYPx) => this.cropMode.handleWheel(pointer, deltaYPx),
    });
    this.transformer = new PhotoTransformer(this.layer, this.gestures, {
      onTransform: (view, box, keepAspect) => this.previewFrame(view, box, keepAspect),
      onTransformEnd: (view, box, keepAspect) => this.commitFrame(view, box, keepAspect),
    });
    this.cropMode = new CropMode(this.layer, this.gestures, {
      onCommit: callbacks.onPhotoChange,
      onStateChange: (state) => this.onCropModeChange(state),
    });
    this.stage.on('click tap', (event) => this.onClick(event.target));
    this.stage.on('dblclick dbltap', (event) => this.onDoubleClick(event.target));
  }

  /** Draws the scene. The first scene is also zoomed to fit. */
  render(scene: Scene): void {
    const previousSelection = this.scene?.selectedPhotoId ?? null;
    this.scene = scene;
    this.pageRect.setAttrs({
      width: scene.page.widthMm,
      height: scene.page.heightMm,
      fill: scene.backgroundColor,
    });
    this.syncPhotos(scene);
    this.syncCropMode(scene, previousSelection);
    this.applyInteractionState();
    this.navigator.fitOnce();
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

  /** Sets the crop zoom of the photo in crop mode while the slider moves (see `CropModeState`). */
  setCropZoom(zoom: number): void {
    this.cropMode.setZoom(zoom);
  }

  /** Commits the crop zoom of the slider (slider released). */
  commitCropZoom(): void {
    this.cropMode.commitZoom();
  }

  /** Destroys the stage and stops pending image loads, timers and listeners. */
  destroy(): void {
    this.cropMode.destroy();
    this.transformer.destroy();
    this.images.clear();
    this.views.clear();
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

  private scenePhoto(photoId: number): ScenePhoto | undefined {
    return this.scene?.photos.find((photo) => photo.id === photoId);
  }

  private viewOf(target: Konva.Node): PhotoView | undefined {
    const group = photoGroupOf(target);
    return group ? this.viewsByGroup.get(group) : undefined;
  }

  /** Removes views of photos that are gone, updates or creates the others and sorts them by z. */
  private syncPhotos(scene: Scene): void {
    const ids = new Set(scene.photos.map((photo) => photo.id));
    for (const id of this.views.keys()) {
      if (!ids.has(id)) {
        this.removePhoto(id);
      }
    }
    for (const photo of scene.photos) {
      const view = this.views.get(photo.id) ?? this.createPhoto(photo);
      view.update(photo.props, scene.defaultBorder);
    }
    this.orderByZ();
  }

  /** Stacks the photo views in `props.z` order (crop mode raises its photo above them). */
  private orderByZ(): void {
    const byZ = [...(this.scene?.photos ?? [])].sort((a, b) => a.props.z - b.props.z);
    for (const photo of byZ) {
      this.views.get(photo.id)?.group.moveToTop();
    }
  }

  /**
   * Keeps crop mode in line with the scene: another selected photo ends it (pending change
   * committed); a removed or externally changed photo ends it inside `CropMode.sync`.
   */
  private syncCropMode(scene: Scene, previousSelection: number | null): void {
    const photoId = this.cropMode.photoId;
    if (photoId === null) {
      return;
    }
    const selectionMovedAway =
      scene.selectedPhotoId !== previousSelection && scene.selectedPhotoId !== photoId;
    if (selectionMovedAway) {
      this.cropMode.end(true);
    } else {
      this.cropMode.sync(this.views.get(photoId), this.scenePhoto(photoId));
    }
  }

  /**
   * Handles and dragging follow the mode: in crop mode no photo can be moved and the handles are
   * hidden; otherwise the selected photo has the handles. Also restores the overlay order.
   */
  private applyInteractionState(): void {
    const cropping = this.cropMode.photoId !== null;
    for (const view of this.views.values()) {
      view.setDraggable(!cropping);
    }
    const selectedId = this.scene?.selectedPhotoId ?? null;
    const selected = selectedId === null ? undefined : this.views.get(selectedId);
    this.transformer.attach(cropping ? null : (selected ?? null));
    this.cropMode.raise();
    this.transformer.refresh();
    this.layer.batchDraw();
  }

  private createPhoto(photo: ScenePhoto): PhotoView {
    const view = new PhotoView(photo.id, {
      onDragStart: (dragged) => this.onDragStart(dragged),
      onDragEnd: (dragged) => this.onDragEnd(dragged),
    });
    view.setImage(this.images.get(photo.id, photo.url));
    this.layer.add(view.group);
    this.views.set(photo.id, view);
    this.viewsByGroup.set(view.group, view);
    return view;
  }

  private removePhoto(id: number): void {
    this.views.get(id)?.destroy();
    this.views.delete(id);
    this.images.delete(id);
  }

  private onImageLoaded(photoId: number, image: HTMLImageElement): void {
    const view = this.views.get(photoId);
    if (view) {
      view.setImage(image);
      // The crop mode overlay shows the source image too.
      this.cropMode.redraw();
      this.layer.batchDraw();
    }
  }

  private onClick(target: Konva.Node): void {
    if (this.gestures.wasGesture() || this.transformer.owns(target)) {
      return;
    }
    if (this.cropMode.photoId !== null) {
      // In crop mode a click outside the frame only ends crop mode.
      if (!this.cropMode.contains(target)) {
        this.cropMode.end(true);
      }
      return;
    }
    this.callbacks.onSelect(this.viewOf(target)?.id ?? null);
  }

  /** Double-click on a photo starts crop mode for it (and selects it). */
  private onDoubleClick(target: Konva.Node): void {
    const view = this.viewOf(target);
    const photo = view && this.scenePhoto(view.id);
    if (!view || !photo || this.cropMode.photoId === view.id) {
      return;
    }
    this.cropMode.start(view, photo);
    if (this.scene?.selectedPhotoId !== view.id) {
      this.callbacks.onSelect(view.id);
    }
    this.applyInteractionState();
  }

  private onCropModeChange(state: CropModeState | null): void {
    if (state === null) {
      this.orderByZ();
      this.applyInteractionState();
    }
    this.callbacks.onCropModeChange(state);
  }

  /** A move starts: an unselected photo is selected first; scene updates keep the drag position. */
  private onDragStart(view: PhotoView): void {
    view.beginGesture();
    if (this.scene?.selectedPhotoId !== view.id) {
      this.callbacks.onSelect(view.id);
    }
  }

  private onDragEnd(view: PhotoView): void {
    view.endGesture();
    this.commitFrame(view, view.frameBox(), true);
  }

  /** Live preview of a transform: the photo is redrawn with the props it would get (no scale). */
  private previewFrame(view: PhotoView, box: FrameBox, keepAspect: boolean): void {
    const photo = this.scenePhoto(view.id);
    if (photo) {
      view.showProps(applyFrameBox(photo.props, box, photo.image, keepAspect));
    }
  }

  /**
   * Commits a moved/transformed frame (new props from the scene props, i.e. the state before the
   * gesture): draws the new props at once (no flicker until the owner sends
   * the next scene) and reports them if they differ from the scene.
   */
  private commitFrame(view: PhotoView, box: FrameBox, keepAspect: boolean): void {
    const photo = this.scenePhoto(view.id);
    if (!photo) {
      return;
    }
    const props = applyFrameBox(photo.props, box, photo.image, keepAspect);
    view.showProps(props);
    this.layer.batchDraw();
    if (!sameGeometry(props, photo.props)) {
      this.callbacks.onPhotoChange(view.id, props);
    }
  }
}
