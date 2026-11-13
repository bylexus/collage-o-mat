// Input model of the collage renderer. Pure types and helpers: no Angular, no Konva.
import type { BorderSettings, PageSize } from '../../../core/models/collage';
import { isPlaced, photoFileUrl } from '../../../core/models/photo';
import type { NormalizedRect, Photo, PhotoProps } from '../../../core/models/photo';
import type { TextProps } from '../../../core/models/text';
import type { EditorSelection } from '../selection';
import { finiteOr } from '../geometry/numbers';
import { normalizeRotationDeg } from '../geometry/transform';
import type { ImageSize } from '../geometry/transform';

/** A placed photo as the renderer needs it. */
export interface ScenePhoto {
  id: number;
  /** URL of the image file. */
  url: string;
  /** Pixel size of the source image (for cover crops). */
  image: ImageSize;
  props: PhotoProps;
}

/** An overlay text as the renderer needs it. */
export interface SceneText {
  id: string;
  props: TextProps;
}

/** Everything the renderer draws. World units are mm, page origin top-left. */
export interface Scene {
  page: PageSize;
  backgroundColor: string;
  defaultBorder: BorderSettings;
  /** Only placed photos; drawn in `props.z` order. */
  photos: readonly ScenePhoto[];
  /** Overlay texts; photos and texts are drawn together in `props.z` order. */
  texts: readonly SceneText[];
  selection: EditorSelection;
}

/** The placed photos of a collage as scene photos (not placed photos are skipped). */
export function scenePhotos(photos: readonly Photo[], collageId: number): ScenePhoto[] {
  return photos.flatMap((photo): ScenePhoto[] =>
    isPlaced(photo.props)
      ? [
          {
            id: photo.id,
            url: photoFileUrl(collageId, photo.id),
            image: { widthPx: photo.widthPx, heightPx: photo.heightPx },
            props: photo.props,
          },
        ]
      : [],
  );
}

/** A photo or a text of the scene (photos and texts share one z scale). */
export type SceneElement = { kind: 'photo'; photo: ScenePhoto } | { kind: 'text'; text: SceneText };

/**
 * All photos and texts in drawing order: ascending `props.z` (back to front). Equal z keeps the
 * input order, photos before texts.
 */
export function elementsByZ(scene: Pick<Scene, 'photos' | 'texts'>): SceneElement[] {
  const elements: { z: number; element: SceneElement }[] = [
    ...scene.photos.map((photo) => ({
      z: photo.props.z,
      element: { kind: 'photo', photo } as const,
    })),
    ...scene.texts.map((text) => ({ z: text.props.z, element: { kind: 'text', text } as const })),
  ];
  return elements.sort((a, b) => a.z - b.z).map(({ element }) => element);
}

/** True if both props have the same frame (centre, size, rotation) and crop; z and border are ignored. */
export function sameGeometry(a: PhotoProps, b: PhotoProps): boolean {
  return (
    a.cxMm === b.cxMm &&
    a.cyMm === b.cyMm &&
    a.widthMm === b.widthMm &&
    a.heightMm === b.heightMm &&
    a.rotationDeg === b.rotationDeg &&
    sameCrop(a.crop, b.crop)
  );
}

/** True if both crops are the same rectangle. */
export function sameCrop(a: NormalizedRect, b: NormalizedRect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/** Smallest text box width (mm) the canvas allows. */
export const MIN_TEXT_WIDTH_MM = 5;

/** Centre, width and rotation of a text box as the canvas changes them; the height follows from the text. */
export interface TextBox {
  cxMm: number;
  cyMm: number;
  widthMm: number;
  rotationDeg: number;
}

/**
 * Props of a text after a move, rotation or width change on the canvas: the box values replace
 * the ones of `props` (non-finite values keep the old ones), the width is at least
 * `MIN_TEXT_WIDTH_MM` and the rotation is normalized.
 */
export function applyTextBox(props: TextProps, box: TextBox): TextProps {
  return {
    ...props,
    cxMm: finiteOr(box.cxMm, props.cxMm),
    cyMm: finiteOr(box.cyMm, props.cyMm),
    widthMm: Math.max(MIN_TEXT_WIDTH_MM, finiteOr(box.widthMm, props.widthMm)),
    rotationDeg: normalizeRotationDeg(finiteOr(box.rotationDeg, props.rotationDeg)),
  };
}

/** True if both props have the same box (centre, width, rotation); all other props are ignored. */
export function sameTextBox(a: TextProps, b: TextProps): boolean {
  return (
    a.cxMm === b.cxMm &&
    a.cyMm === b.cyMm &&
    a.widthMm === b.widthMm &&
    a.rotationDeg === b.rotationDeg
  );
}
