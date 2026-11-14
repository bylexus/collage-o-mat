// Offscreen rendering of the collage page into an image file (export). Plain module without Angular.
import Konva from 'konva/lib/Core';
import type { PageSize } from '../../../core/models/collage';
import {
  ExportContent,
  ExportError,
  ExportOptions,
  exportMimeType,
  exportPixelSize,
  fitsSideLimit,
  PixelSize,
} from '../export/page-export';
import { loadFonts } from './font-loader';
import { loadImage } from './image-cache';
import { PageBackgroundView } from './page-background-view';
import { PhotoView } from './photo-view';
import {
  elementsByZ,
  Scene,
  SceneBackground,
  sceneBackground,
  ScenePhoto,
  scenePhotos,
  SceneText,
} from './scene';
import { textFontFace, TextView } from './text-view';
import { frameBounds, rectsOverlap } from './viewport';

/** Photo id → loaded source image. */
type LoadedImages = ReadonlyMap<number, HTMLImageElement>;

/** The loaded source images of the scene: the photos and the bg photo (`null`: none). */
interface SceneImages {
  photos: LoadedImages;
  background: HTMLImageElement | null;
}

/**
 * Renders the page (only the page area, no selection, no workspace) at `options.dpi` and encodes it
 * as PNG or JPG. Rejects with `ExportError` (`tooLarge`, `browserLimit`, `imageLoad`).
 *
 * Steps: size check → load the photo images, the bg photo image and the text fonts → draw the scene with the editor's
 * views (`PhotoView`, `TextView`) on an offscreen Konva stage of exactly the image size → encode.
 * Elements beside the page are outside the canvas and so not in the image; photos that do not
 * touch the page are not even loaded.
 */
export async function renderPageImage(
  content: ExportContent,
  options: ExportOptions,
): Promise<Blob> {
  const size = exportPixelSize(content.settings.page, options.dpi);
  if (!fitsSideLimit(size)) {
    throw new ExportError('tooLarge', `${size.widthPx} × ${size.heightPx} px is too large`);
  }
  const scene = exportScene(content);
  // Load first, then allocate the (large) canvas: it is not held while the loads run.
  const [photos, background] = await Promise.all([
    loadPhotoImages(scene.photos),
    loadBackgroundImage(scene.background),
  ]);
  const images: SceneImages = { photos, background };
  await loadFonts(
    scene.texts.map((text) => ({ face: textFontFace(text.props), text: text.props.text })),
  );
  const stage = createStage(size);
  try {
    const layer = stage.getLayers()[0];
    drawScene(layer, scene, images, size);
    const quality = options.format === 'jpg' ? options.jpgQuality : undefined;
    return await encodeCanvas(layer.getCanvas()._canvas, exportMimeType(options.format), quality);
  } finally {
    stage.destroy();
  }
}

/** The scene of the export: no selection, only photos that touch the page. */
function exportScene(content: ExportContent): Scene {
  const { settings } = content;
  const page = { x: 0, y: 0, width: settings.page.widthMm, height: settings.page.heightMm };
  return {
    page: settings.page,
    background: sceneBackground(settings.background, content.photos, content.collageId),
    defaultBorder: settings.defaultBorder,
    defaultShadow: settings.defaultShadow,
    photos: scenePhotos(content.photos, content.collageId).filter((photo) =>
      rectsOverlap(frameBounds(photo.props), page),
    ),
    texts: content.texts,
    selection: null,
    snapGrid: null,
  };
}

/** Loads the source images of all photos; rejects with `ExportError('imageLoad')` on the first failure. */
async function loadPhotoImages(photos: readonly ScenePhoto[]): Promise<LoadedImages> {
  const entries = await Promise.all(
    photos.map((photo) =>
      loadImage(photo.url).then(
        (image) => [photo.id, image] as const,
        (error: unknown) => {
          const reason = error instanceof Error ? `: ${error.message}` : '';
          throw new ExportError('imageLoad', `photo ${photo.id} could not be loaded${reason}`);
        },
      ),
    ),
  );
  return new Map(entries);
}

/**
 * Loads the image of the bg photo (`null` without `imageFile`); rejects with
 * `ExportError('imageLoad')` if it fails.
 */
async function loadBackgroundImage(background: SceneBackground): Promise<HTMLImageElement | null> {
  const file = background.imageFile;
  if (!file) {
    return null;
  }
  try {
    return await loadImage(file.url);
  } catch (error) {
    const reason = error instanceof Error ? `: ${error.message}` : '';
    throw new ExportError(
      'imageLoad',
      `background photo ${background.image.photoId} could not be loaded${reason}`,
    );
  }
}

/**
 * An offscreen stage (detached container, never in the DOM) of exactly `size` px with one layer
 * whose canvas is the output image.
 *
 * The layer canvas gets pixel ratio 1 before the layer is added: a new `SceneCanvas` uses
 * `Konva.pixelRatio` (= `window.devicePixelRatio`) and `Stage.add` sizes it to the stage size ×
 * that ratio, so on a HiDPI screen the canvas would be 2× (4× the area) larger than the image.
 * The layer does not listen (its hit canvas stays 0 × 0). Throws `ExportError('browserLimit')` if
 * the browser cannot create a canvas of that size.
 */
function createStage(size: PixelSize): Konva.Stage {
  let stage: Konva.Stage | null = null;
  try {
    stage = new Konva.Stage({
      container: document.createElement('div'),
      width: size.widthPx,
      height: size.heightPx,
      listening: false,
    });
    const layer = new Konva.Layer({ listening: false });
    layer.getCanvas().setPixelRatio(1);
    stage.add(layer);
    const canvas = layer.getCanvas()._canvas;
    if (canvas.width !== size.widthPx || canvas.height !== size.heightPx) {
      throw new Error(`canvas is ${canvas.width} × ${canvas.height} px`);
    }
    return stage;
  } catch (error) {
    stage?.destroy();
    const reason = error instanceof Error ? `: ${error.message}` : '';
    throw new ExportError('browserLimit', `canvas could not be created${reason}`);
  }
}

/**
 * Draws page background, photos and texts (stacked by `props.z`) into the layer. The stage scale
 * is px per mm per axis, so the page fills the image exactly (both scales are `dpi / 25.4` up to
 * the rounding of the pixel size).
 */
function drawScene(layer: Konva.Layer, scene: Scene, images: SceneImages, size: PixelSize): void {
  const stage = layer.getStage();
  stage.scale(pxPerMm(scene.page, size));
  // Large photos are drawn scaled down; the default ('low') quality would alias them.
  layer.getContext()._context.imageSmoothingQuality = 'high';
  const background = new PageBackgroundView();
  background.setImage(images.background);
  background.update(scene.page, scene.background);
  layer.add(background.group);
  for (const element of elementsByZ(scene)) {
    layer.add(
      element.kind === 'photo'
        ? photoGroup(element.photo, scene, images.photos)
        : textGroup(element.text),
    );
  }
  layer.draw();
}

/** Stage scale (px per mm) that maps the page onto exactly `size`. */
function pxPerMm(page: PageSize, size: PixelSize): { x: number; y: number } {
  return { x: size.widthPx / page.widthMm, y: size.heightPx / page.heightMm };
}

/**
 * A static photo view (frame, crop, border and shadow incl. the collage defaults) with its loaded
 * image.
 */
function photoGroup(photo: ScenePhoto, scene: Scene, images: LoadedImages): Konva.Group {
  const view = new PhotoView(photo.id);
  view.update(photo.props, scene.defaultBorder, scene.defaultShadow);
  const image = images.get(photo.id);
  if (image) {
    view.setImage(image);
  }
  return view.group;
}

/**
 * A static text view. The fonts are loaded before the views are created, so Konva measures and
 * wraps the text with the real font metrics; `relayout` makes sure of it anyway.
 */
function textGroup(text: SceneText): Konva.Group {
  const view = new TextView(text.id);
  view.update(text.props);
  view.relayout();
  return view.group;
}

/** Encodes the canvas; `null` from `toBlob` (e.g. a canvas area limit) gives `ExportError('browserLimit')`. */
function encodeCanvas(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const failed = (reason: string) =>
      reject(new ExportError('browserLimit', `image could not be encoded: ${reason}`));
    try {
      canvas.toBlob((blob) => (blob ? resolve(blob) : failed('no data')), type, quality);
    } catch (error) {
      failed(error instanceof Error ? error.message : String(error));
    }
  });
}
