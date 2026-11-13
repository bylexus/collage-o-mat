// Input model of the collage renderer. Pure types and helpers: no Angular, no Konva.
import type { BorderSettings, PageSize } from '../../../core/models/collage';
import type { NormalizedRect, PhotoProps } from '../../../core/models/photo';
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

/** Everything the renderer draws. World units are mm, page origin top-left. */
export interface Scene {
  page: PageSize;
  backgroundColor: string;
  defaultBorder: BorderSettings;
  /** Only placed photos; drawn in `props.z` order. */
  photos: readonly ScenePhoto[];
  selectedPhotoId: number | null;
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
