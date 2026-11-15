import { ImportResult } from '../../../core/models/photo';

/**
 * Success text after an import or upload: "3 photos imported", plus "2 skipped (...)" when some
 * were skipped, plus "1 only available in preview size" when Immich could not deliver originals.
 */
export function importResultMessage(result: ImportResult): string {
  const count = result.photos.length;
  let message =
    count === 1
      ? $localize`:@@editor.import.importedOne:1 photo imported`
      : $localize`:@@editor.import.importedMany:${count}:count: photos imported`;
  if (result.skipped > 0) {
    const skipped = result.skipped;
    message = $localize`:@@editor.import.importedWithSkipped:${message}:imported:, ${skipped}:skipped: skipped (already in the collage)`;
  }
  if (result.previewFallbacks > 0) {
    const fallbacks = result.previewFallbacks;
    message = $localize`:@@editor.import.importedWithPreviewFallbacks:${message}:imported:, ${fallbacks}:fallbacks: only available in preview size`;
  }
  return message;
}
