// Export of the collage page as an image file: types and pure size math. No Angular, no Konva.
import type { CollageSettings, PageSize } from '../../../core/models/collage';
import type { Photo } from '../../../core/models/photo';
import type { CollageText } from '../../../core/models/text';

export type ExportFormat = 'png' | 'jpg';

/** Largest side (px) of an exported image. */
export const EXPORT_MAX_SIDE_PX = 16384;

/** JPG quality range of the export dialog (`HTMLCanvasElement.toBlob` quality). */
export const JPG_QUALITY_LIMITS = { min: 0.6, max: 1, step: 0.05 } as const;

/** Options chosen in the export dialog. */
export interface ExportOptions {
  format: ExportFormat;
  /** Export resolution; may differ from the page DPI (for this export only). */
  dpi: number;
  /** 0.6..1, used for JPG only. */
  jpgQuality: number;
}

/** What is exported: the committed layout of the editor (no selection, no live preview). */
export interface ExportContent {
  collageId: number;
  settings: CollageSettings;
  /** Not placed photos are skipped. */
  photos: readonly Photo[];
  texts: readonly CollageText[];
}

export interface PixelSize {
  widthPx: number;
  heightPx: number;
}

/** Why an export failed (the dialog shows a message for each reason). */
export type ExportErrorReason =
  /** A side is larger than `EXPORT_MAX_SIDE_PX` (checked before rendering). */
  | 'tooLarge'
  /** The browser could not create the canvas or encode the image (e.g. Safari canvas area limit). */
  | 'browserLimit'
  /** A photo image could not be loaded. */
  | 'imageLoad';

export class ExportError extends Error {
  constructor(
    readonly reason: ExportErrorReason,
    message?: string,
  ) {
    super(message ?? reason);
    this.name = 'ExportError';
  }
}

/** Pixel size of the exported image: `round(mm / 25.4 × dpi)` per side. */
export function exportPixelSize(page: PageSize, dpi: number): PixelSize {
  return {
    widthPx: Math.round((page.widthMm / 25.4) * dpi),
    heightPx: Math.round((page.heightMm / 25.4) * dpi),
  };
}

/** True if no side is larger than `EXPORT_MAX_SIDE_PX`. */
export function fitsSideLimit(size: PixelSize): boolean {
  return size.widthPx <= EXPORT_MAX_SIDE_PX && size.heightPx <= EXPORT_MAX_SIDE_PX;
}

/** MIME type of a format (for `toBlob`). */
export function exportMimeType(format: ExportFormat): string {
  return format === 'png' ? 'image/png' : 'image/jpeg';
}
