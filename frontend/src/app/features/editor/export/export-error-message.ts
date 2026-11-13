import { errorMessage } from '../../../shared/error-message';
import { EXPORT_MAX_SIDE_PX, ExportError } from './page-export';

/** Error text if a side of the image is larger than `EXPORT_MAX_SIDE_PX`. */
export const SIDE_LIMIT_MESSAGE = $localize`:@@editor.export.sideLimitError:The image would be larger than ${EXPORT_MAX_SIDE_PX}:maxSide: px on one side. Lower the DPI.`;

/** Turns an error of the export (rendering or download) into a text for the export dialog. */
export function exportErrorMessage(err: unknown): string {
  const failed = $localize`:@@editor.export.failed:The export failed.`;
  if (!(err instanceof ExportError)) {
    return errorMessage(err, failed);
  }
  switch (err.reason) {
    case 'tooLarge':
      return SIDE_LIMIT_MESSAGE;
    case 'browserLimit':
      return $localize`:@@editor.export.browserLimitError:The image is too large for this browser. Lower the DPI.`;
    case 'imageLoad':
      return $localize`:@@editor.export.imageLoadError:The export failed. A photo could not be loaded.`;
  }
}
