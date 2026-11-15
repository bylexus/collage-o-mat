// Konva rendering of a collage. Plain class without Angular; owned by `EditorCanvas`.
// Core + the used shapes only (smaller bundle than the full 'konva' entry).
import Konva from 'konva/lib/Core';
import type { PhotoProps } from '../../../core/models/photo';
import type { TextProps } from '../../../core/models/text';
import { snapRectDelta } from '../geometry/snap-grid';
import { applyFrameBox, FrameBox } from '../geometry/transform';
import { EditorSelection, sameSelection, selectedPhotoIdOf } from '../selection';
import { CropMode, CropModeState } from './crop-mode';
import { bottomCentreOf, sameAnchor } from './element-anchor';
import { FontLoader } from './font-loader';
import { ImageCache } from './image-cache';
import { PageBackgroundView } from './page-background-view';
import { PhotoTransformer } from './photo-transformer';
import { photoGroupOf, PhotoView } from './photo-view';
import { PressGestureTracker } from './press-gesture';
import {
  applyTextBox,
  elementsByZ,
  sameGeometry,
  sameTextBox,
  Scene,
  ScenePhoto,
  SceneText,
  TextBox,
} from './scene';
import { StageNavigator } from './stage-navigator';
import { TextTransformer } from './text-transformer';
import { textGroupOf, TextView } from './text-view';
import { frameBounds, Point, Rect, unionRects } from './viewport';

export type { Scene, ScenePhoto, SceneText } from './scene';
export type { CropModeState } from './crop-mode';

/** Callbacks of the renderer to its owner. */
export interface RendererCallbacks {
  /** Click/tap on a photo or text, or `null` for the empty area (not after a gesture). */
  onSelect: (selection: EditorSelection) => void;
  /** The zoom (1 = real size) changed. */
  onZoomChange: (zoom: number) => void;
  /** A committed move, rotation, resize or crop change: the complete new props of the photo. */
  onPhotoChange: (photoId: number, props: PhotoProps) => void;
  /** A committed move, rotation or box width change: the complete new props of the text. */
  onTextChange: (textId: string, props: TextProps) => void;
  /** Double-click on a text: the owner shows its text for editing. */
  onTextEditRequest: (textId: string) => void;
  /** Crop mode started, its zoom changed, or it ended (`null`). */
  onCropModeChange: (state: CropModeState | null) => void;
  /** Swap mode: click on a photo other than the selected one (its id). */
  onSwapTarget: (photoId: number) => void;
  /**
   * New position of the selection toolbar (container px, bottom centre of the selected element's
   * bounding box), or `null` when it must be hidden: no selection, a drag/rotate/resize gesture
   * runs or crop mode is on. In swap mode it is the anchor of the selected (source) photo. Only
   * reported when the value changes.
   */
  onToolbarAnchorChange: (anchor: Point | null) => void;
}

/**
 * Owns a Konva stage in a container element and draws a `Scene`: page background
 * (`PageBackgroundView`, at the bottom), photos (`PhotoView`, matched by photo id, images loaded
 * once) and texts (`TextView`, matched by text id, web fonts loaded by `FontLoader`), stacked
 * together by `props.z`. The stage scale is px per mm.
 * This class is the only entry point for the owning component; the interactions are delegated:
 *
 * - `StageNavigator`: pan and zoom of the view.
 * - `PhotoTransformer`: handles on the selected photo (rotate, resize; a resize snaps to the
 *   scene's snap grid).
 * - `TextTransformer`: handles on the selected text (rotate, box width).
 * - `PhotoView` / `TextView` drag events: move (an unselected element is selected first); with the
 *   scene's snap grid the bounding box snaps to the grid at each step (Alt/Option held: free move).
 * - `CropMode`: double-click a photo to pan/zoom the image inside its frame.
 * - Double-click a text: `onTextEditRequest`.
 * - Swap mode (`setSwapMode`): no edits; the selected photo shows its frame without handles and a
 *   click on another photo reports `onSwapTarget`. Pan and zoom stay.
 * - Selection toolbar anchor: reported with `onToolbarAnchorChange` on render, pan/zoom, gesture
 *   start/end and mode changes.
 *
 * Each interaction reports one `onPhotoChange` / `onTextChange` when it is committed, never during
 * the gesture.
 */
export class CollageRenderer {
  private readonly stage: Konva.Stage;
  private readonly layer = new Konva.Layer();
  private readonly background = new PageBackgroundView();
  private readonly views = new Map<number, PhotoView>();
  private readonly viewsByGroup = new WeakMap<Konva.Node, PhotoView>();
  private readonly textViews = new Map<string, TextView>();
  private readonly textViewsByGroup = new WeakMap<Konva.Node, TextView>();
  private readonly images = new ImageCache((photoId, image) => this.onImageLoaded(photoId, image));
  private readonly fonts = new FontLoader((face) => this.onFontLoaded(face));
  private readonly gestures: PressGestureTracker;
  private readonly navigator: StageNavigator;
  private readonly transformer: PhotoTransformer;
  private readonly textTransformer: TextTransformer;
  private readonly cropMode: CropMode;
  private scene: Scene | null = null;
  /**
   * Photo id of the bg photo drawn by the background view (`null`: none). Its image shares the
   * `images` entry of the photo view (same file, same key); the entry is kept while either uses it.
   */
  private backgroundPhotoId: number | null = null;
  /** Swap mode is on (see `setSwapMode`). */
  private swapMode = false;
  /** A drag, rotate or resize of the selected element runs (the toolbar is hidden). */
  private elementGesture = false;
  /** Last reported toolbar anchor. */
  private toolbarAnchor: Point | null = null;

  constructor(
    container: HTMLDivElement,
    private readonly callbacks: RendererCallbacks,
  ) {
    this.stage = new Konva.Stage({
      container,
      width: container.clientWidth,
      height: container.clientHeight,
    });
    this.layer.add(this.background.group);
    this.stage.add(this.layer);
    // First stage listener: clears the gesture flag before the others can set it.
    this.gestures = new PressGestureTracker(this.stage);
    this.navigator = new StageNavigator(this.stage, {
      gestures: this.gestures,
      contentBounds: () => this.contentBounds(),
      onZoomChange: (zoom) => {
        callbacks.onZoomChange(zoom);
        // Called on every pan/zoom; the crop mode controls and the toolbar follow on screen.
        this.cropMode?.viewChanged();
        this.updateToolbarAnchor();
      },
      interceptWheel: (pointer, deltaYPx) => this.cropMode.handleWheel(pointer, deltaYPx),
    });
    this.transformer = new PhotoTransformer(this.layer, this.gestures, {
      onTransform: (view, box, keepAspect) => {
        this.startElementGesture();
        this.previewFrame(view, box, keepAspect);
      },
      onTransformEnd: (view, box, keepAspect) => {
        this.commitFrame(view, box, keepAspect);
        this.endElementGesture();
      },
    });
    this.textTransformer = new TextTransformer(this.layer, this.gestures, {
      onTransform: (view, box) => {
        this.startElementGesture();
        this.previewTextBox(view, box);
      },
      onTransformEnd: (view, box) => {
        this.commitTextBox(view, box);
        this.endElementGesture();
      },
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
    const previousPhotoId = selectedPhotoIdOf(this.scene?.selection ?? null);
    this.scene = scene;
    this.syncBackground(scene);
    this.transformer.setSnapGrid(scene.snapGrid);
    this.syncPhotos(scene);
    this.syncTexts(scene);
    this.orderByZ();
    this.syncCropMode(scene, previousPhotoId);
    this.applyInteractionState();
    this.navigator.fitOnce();
    this.updateToolbarAnchor();
  }

  /** Sets the stage size in px (call when the container size changes). */
  setSize(width: number, height: number): void {
    this.navigator.resize({ width, height });
    this.updateToolbarAnchor();
  }

  /** Shows the page and all elements as large as possible. Returns false if there is nothing to fit. */
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

  /**
   * Swap mode on/off: no element can be moved, the selected photo keeps its selection frame
   * without handles, double-click does nothing and only a click on another photo reports
   * `onSwapTarget` (all other clicks are ignored). Starting it ends a running crop mode (pending
   * change committed).
   */
  setSwapMode(on: boolean): void {
    if (this.swapMode === on) {
      return;
    }
    this.swapMode = on;
    if (on) {
      this.cropMode.end(true);
    }
    this.applyInteractionState();
    this.updateToolbarAnchor();
  }

  /**
   * Starts crop mode for a placed photo and selects it (same as a double-click on it). Nothing in
   * swap mode or when the photo is already in crop mode.
   */
  startCropMode(photoId: number): void {
    const view = this.views.get(photoId);
    const photo = this.scenePhoto(photoId);
    if (this.swapMode || !view || !photo || this.cropMode.photoId === photoId) {
      return;
    }
    this.cropMode.start(view, photo);
    this.select({ kind: 'photo', id: photoId });
    this.applyInteractionState();
  }

  /** Sets the crop zoom of the photo in crop mode while the slider moves (see `CropModeState`). */
  setCropZoom(zoom: number): void {
    this.cropMode.setZoom(zoom);
  }

  /** Commits the crop zoom of the slider (slider released). */
  commitCropZoom(): void {
    this.cropMode.commitZoom();
  }

  /** Destroys the stage and stops pending image/font loads, timers and listeners. */
  destroy(): void {
    this.cropMode.destroy();
    this.transformer.destroy();
    this.textTransformer.destroy();
    this.fonts.destroy();
    this.images.clear();
    this.views.clear();
    this.textViews.clear();
    this.navigator.destroy();
    this.stage.destroy();
  }

  /** Page, all placed photos and all texts (world mm); `null` before the first scene. */
  private contentBounds(): Rect | null {
    const scene = this.scene;
    if (!scene) {
      return null;
    }
    return unionRects(
      { x: 0, y: 0, width: scene.page.widthMm, height: scene.page.heightMm },
      ...scene.photos.map((photo) => frameBounds(photo.props)),
      ...[...this.textViews.values()].map((view) => frameBounds(view.frameBox())),
    );
  }

  private scenePhoto(photoId: number): ScenePhoto | undefined {
    return this.scene?.photos.find((photo) => photo.id === photoId);
  }

  private sceneText(textId: string): SceneText | undefined {
    return this.scene?.texts.find((text) => text.id === textId);
  }

  private viewOf(target: Konva.Node): PhotoView | undefined {
    const group = photoGroupOf(target);
    return group ? this.viewsByGroup.get(group) : undefined;
  }

  private textViewOf(target: Konva.Node): TextView | undefined {
    const group = textGroupOf(target);
    return group ? this.textViewsByGroup.get(group) : undefined;
  }

  /** The element under a click target: a photo, a text or nothing (`null`). */
  private selectionOf(target: Konva.Node): EditorSelection {
    const photo = this.viewOf(target);
    if (photo) {
      return { kind: 'photo', id: photo.id };
    }
    const text = this.textViewOf(target);
    return text ? { kind: 'text', id: text.id } : null;
  }

  /** Reports a selection unless it is the current one. */
  private select(selection: EditorSelection): void {
    if (!sameSelection(this.scene?.selection ?? null, selection)) {
      this.callbacks.onSelect(selection);
    }
  }

  /**
   * Updates the background view and requests the image of the bg photo from the cache (the bg photo
   * may be not placed, so it has no photo view that would load it). The image of a former bg photo
   * is forgotten unless its photo view still uses it.
   */
  private syncBackground(scene: Scene): void {
    const file = scene.background.imageFile;
    const photoId = file ? scene.background.image.photoId : null;
    const previousId = this.backgroundPhotoId;
    if (previousId !== null && previousId !== photoId && !this.views.has(previousId)) {
      this.images.delete(previousId);
    }
    this.backgroundPhotoId = photoId;
    this.background.setImage(file && photoId !== null ? this.images.get(photoId, file.url) : null);
    this.background.update(scene.page, scene.background);
  }

  /** Removes views of photos that are gone and updates or creates the others. */
  private syncPhotos(scene: Scene): void {
    const ids = new Set(scene.photos.map((photo) => photo.id));
    for (const id of this.views.keys()) {
      if (!ids.has(id)) {
        this.removePhoto(id);
      }
    }
    for (const photo of scene.photos) {
      const view = this.views.get(photo.id) ?? this.createPhoto(photo);
      view.update(photo.props, scene.defaultBorder, scene.defaultShadow);
    }
  }

  /** Removes views of texts that are gone, updates or creates the others and requests their fonts. */
  private syncTexts(scene: Scene): void {
    const ids = new Set(scene.texts.map((text) => text.id));
    for (const [id, view] of this.textViews) {
      if (!ids.has(id)) {
        view.destroy();
        this.textViews.delete(id);
      }
    }
    for (const text of scene.texts) {
      const view = this.textViews.get(text.id) ?? this.createText(text);
      view.update(text.props);
      this.fonts.request(view.fontFace);
    }
  }

  /**
   * Stacks photo and text views together in `props.z` order (photos and texts share one z
   * scale; crop mode raises its photo above them).
   */
  private orderByZ(): void {
    const scene = this.scene;
    if (!scene) {
      return;
    }
    for (const element of elementsByZ(scene)) {
      const group =
        element.kind === 'photo'
          ? this.views.get(element.photo.id)?.group
          : this.textViews.get(element.text.id)?.group;
      group?.moveToTop();
    }
  }

  /**
   * Keeps crop mode in line with the scene: another selected element ends it (pending change
   * committed); a removed or externally changed photo ends it inside `CropMode.sync`.
   */
  private syncCropMode(scene: Scene, previousPhotoId: number | null): void {
    const photoId = this.cropMode.photoId;
    if (photoId === null) {
      return;
    }
    const selectedPhotoId = selectedPhotoIdOf(scene.selection);
    const selectionMovedAway = selectedPhotoId !== previousPhotoId && selectedPhotoId !== photoId;
    if (selectionMovedAway) {
      this.cropMode.end(true);
    } else {
      this.cropMode.sync(this.views.get(photoId), this.scenePhoto(photoId));
    }
  }

  /**
   * Handles and dragging follow the mode: in crop mode no element can be moved and the handles are
   * hidden; in swap mode no element can be moved and the selected photo shows only its selection
   * frame; otherwise the selected photo or text has its handles. Also restores the overlay order.
   */
  private applyInteractionState(): void {
    const cropping = this.cropMode.photoId !== null;
    for (const view of [...this.views.values(), ...this.textViews.values()]) {
      view.setDraggable(!cropping && !this.swapMode);
    }
    const selection = cropping ? null : (this.scene?.selection ?? null);
    const photo = selection?.kind === 'photo' ? this.views.get(selection.id) : undefined;
    const text = selection?.kind === 'text' ? this.textViews.get(selection.id) : undefined;
    this.transformer.setHandlesEnabled(!this.swapMode);
    this.transformer.attach(photo ?? null);
    this.textTransformer.attach(this.swapMode ? null : (text ?? null));
    this.cropMode.raise();
    this.transformer.refresh();
    this.textTransformer.refresh();
    this.layer.batchDraw();
  }

  private createPhoto(photo: ScenePhoto): PhotoView {
    const view = new PhotoView(photo.id, {
      onDragStart: (dragged) => this.onPhotoDragStart(dragged),
      onDragMove: (dragged, event) => this.snapMove(dragged, event),
      onDragEnd: (dragged) => this.onPhotoDragEnd(dragged),
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
    // The background view may still draw this image (see `backgroundPhotoId`).
    if (id !== this.backgroundPhotoId) {
      this.images.delete(id);
    }
  }

  private createText(text: SceneText): TextView {
    const view = new TextView(text.id, {
      onDragStart: (dragged) => this.onTextDragStart(dragged),
      onDragMove: (dragged, event) => this.snapMove(dragged, event),
      onDragEnd: (dragged) => this.onTextDragEnd(dragged),
    });
    this.layer.add(view.group);
    this.textViews.set(text.id, view);
    this.textViewsByGroup.set(view.group, view);
    return view;
  }

  private onImageLoaded(photoId: number, image: HTMLImageElement): void {
    const view = this.views.get(photoId);
    if (view) {
      view.setImage(image);
      // The crop mode overlay shows the source image too.
      this.cropMode.redraw();
    }
    const isBackground = photoId === this.backgroundPhotoId;
    if (isBackground) {
      this.background.setImage(image);
    }
    if (view || isBackground) {
      this.layer.batchDraw();
    }
  }

  /** A web font has loaded (`null`: any face may have changed): texts with that face wrap again. */
  private onFontLoaded(face: string | null): void {
    let changed = false;
    for (const view of this.textViews.values()) {
      if (face === null || view.fontFace === face) {
        view.relayout();
        changed = true;
      }
    }
    if (changed) {
      this.textTransformer.refresh();
      this.layer.batchDraw();
      // A new font can change the text box height.
      this.updateToolbarAnchor();
    }
  }

  private onClick(target: Konva.Node): void {
    if (
      this.gestures.wasGesture() ||
      this.transformer.owns(target) ||
      this.textTransformer.owns(target)
    ) {
      return;
    }
    if (this.swapMode) {
      this.onSwapClick(target);
      return;
    }
    if (this.cropMode.photoId !== null) {
      // In crop mode a click outside the frame only ends crop mode.
      if (!this.cropMode.contains(target)) {
        this.cropMode.end(true);
      }
      return;
    }
    this.callbacks.onSelect(this.selectionOf(target));
  }

  /** Swap mode: a click on a photo other than the selected one reports it; other clicks do nothing. */
  private onSwapClick(target: Konva.Node): void {
    const view = this.viewOf(target);
    if (view && view.id !== selectedPhotoIdOf(this.scene?.selection ?? null)) {
      this.callbacks.onSwapTarget(view.id);
    }
  }

  /**
   * Double-click on a photo starts crop mode for it; on a text it requests text editing. Nothing in
   * swap mode.
   */
  private onDoubleClick(target: Konva.Node): void {
    if (this.swapMode) {
      return;
    }
    const textView = this.textViewOf(target);
    if (textView) {
      this.select({ kind: 'text', id: textView.id });
      this.callbacks.onTextEditRequest(textView.id);
      return;
    }
    const view = this.viewOf(target);
    if (view) {
      this.startCropMode(view.id);
    }
  }

  private onCropModeChange(state: CropModeState | null): void {
    if (state === null) {
      this.orderByZ();
      this.applyInteractionState();
    }
    this.callbacks.onCropModeChange(state);
    this.updateToolbarAnchor();
  }

  /** A drag, rotate or resize of an element starts or goes on: hides the toolbar. */
  private startElementGesture(): void {
    if (!this.elementGesture) {
      this.elementGesture = true;
      this.updateToolbarAnchor();
    }
  }

  /** The drag, rotate or resize has ended (new geometry drawn): shows the toolbar again. */
  private endElementGesture(): void {
    this.elementGesture = false;
    this.updateToolbarAnchor();
  }

  /**
   * Reports the toolbar anchor if it changed: bottom centre of the selected photo or text, or
   * `null` (see `RendererCallbacks.onToolbarAnchorChange`). Also called during construction (zoom
   * change of the navigator), before the crop mode exists.
   */
  private updateToolbarAnchor(): void {
    const anchor = this.computeToolbarAnchor();
    if (!sameAnchor(anchor, this.toolbarAnchor)) {
      this.toolbarAnchor = anchor;
      this.callbacks.onToolbarAnchorChange(anchor);
    }
  }

  private computeToolbarAnchor(): Point | null {
    const selection = this.scene?.selection ?? null;
    if (
      !selection ||
      !this.cropMode ||
      this.cropMode.photoId !== null ||
      this.elementGesture
    ) {
      return null;
    }
    const view =
      selection.kind === 'photo' ? this.views.get(selection.id) : this.textViews.get(selection.id);
    return view ? bottomCentreOf(view.group) : null;
  }

  /** A photo move starts: an unselected photo is selected first; scene updates keep the drag position. */
  private onPhotoDragStart(view: PhotoView): void {
    view.beginGesture();
    this.startElementGesture();
    this.select({ kind: 'photo', id: view.id });
  }

  /**
   * One step of a photo or text move: shifts the group so that the nearer bounding-box edge per
   * axis lies on the snap grid. Free move when the grid is off or Alt/Option is held. Konva sets
   * the drag position again from the pointer at the next step, so the shift does not add up; the
   * position of the last step is the one `dragend` commits.
   */
  private snapMove(view: PhotoView | TextView, event: Event | undefined): void {
    const grid = this.scene?.snapGrid ?? null;
    if (!grid || isAltPressed(event)) {
      return;
    }
    const { dx, dy } = snapRectDelta(frameBounds(view.frameBox()), grid);
    if (dx !== 0 || dy !== 0) {
      view.group.move({ x: dx, y: dy });
    }
  }

  private onPhotoDragEnd(view: PhotoView): void {
    view.endGesture();
    this.commitFrame(view, view.frameBox(), true);
    this.endElementGesture();
  }

  /** A text move starts: an unselected text is selected first; scene updates keep the drag position. */
  private onTextDragStart(view: TextView): void {
    view.beginGesture();
    this.startElementGesture();
    this.select({ kind: 'text', id: view.id });
  }

  private onTextDragEnd(view: TextView): void {
    view.endGesture();
    this.commitTextBox(view, view.textBox());
    this.endElementGesture();
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

  /**
   * Live preview of a text transform: the text is redrawn with the box it would get. The side
   * handles' `scaleX` becomes the box width (scale reset to 1), so the text wraps again while the
   * handle moves and the font size stays.
   */
  private previewTextBox(view: TextView, box: TextBox): void {
    const text = this.sceneText(view.id);
    if (text) {
      view.showProps(applyTextBox(text.props, box));
    }
  }

  /**
   * Commits a moved/transformed text box (new props from the scene props): draws them at once and
   * reports them if the box differs from the scene.
   */
  private commitTextBox(view: TextView, box: TextBox): void {
    const text = this.sceneText(view.id);
    if (!text) {
      return;
    }
    const props = applyTextBox(text.props, box);
    view.showProps(props);
    this.textTransformer.refresh();
    this.layer.batchDraw();
    if (!sameTextBox(props, text.props)) {
      this.callbacks.onTextChange(view.id, props);
    }
  }
}

/** True if the native event of a drag step has the Alt (Option) key held. */
function isAltPressed(event: Event | undefined): boolean {
  return event !== undefined && 'altKey' in event && event.altKey === true;
}
