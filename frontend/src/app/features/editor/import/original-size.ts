import { SourceAsset } from '../../../core/models/source';

/** Original MIME types that Immich sends unchanged and that the backend cannot decode. */
const UNSUPPORTED_ORIGINAL_MIME_TYPES: ReadonlySet<string> = new Set([
  'image/avif',
  'image/gif',
  'image/bmp',
]);

/** Pixel limit of the backend decoder (`imaging.MaxPixels`, 60 MP). */
const MAX_ORIGINAL_PIXELS = 60_000_000;

/**
 * True if the asset is within the pixel limit of the backend decoder (`imaging.MaxPixels`, 60 MP).
 * Assets with an unknown size (width or height 0) count as within the limit. Usable for any source.
 */
export function withinOriginalPixelLimit(asset: SourceAsset): boolean {
  return asset.width * asset.height <= MAX_ORIGINAL_PIXELS;
}

/**
 * True if an **Immich** asset can be imported in original size. The backend cannot decode AVIF,
 * GIF and BMP originals (Immich sends them unchanged) and refuses images over 60 MP
 * (`imaging.MaxPixels`). Assets with an unknown size (width or height 0) count as supported.
 * HEIC/RAW are supported, because Immich converts them.
 */
export function supportsOriginalSize(asset: SourceAsset): boolean {
  if (UNSUPPORTED_ORIGINAL_MIME_TYPES.has(asset.mimeType.toLowerCase())) {
    return false;
  }
  return withinOriginalPixelLimit(asset);
}
