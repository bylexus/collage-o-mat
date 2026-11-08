import { ImportResult } from '../../../core/models/photo';

/** Success text after an import: "3 photos imported", plus "2 skipped (...)" when some were skipped. */
export function importResultMessage(result: ImportResult): string {
  const count = result.photos.length;
  const imported =
    count === 1
      ? $localize`:@@editor.import.importedOne:1 photo imported`
      : $localize`:@@editor.import.importedMany:${count}:count: photos imported`;
  if (result.skipped === 0) {
    return imported;
  }
  const skipped = result.skipped;
  return $localize`:@@editor.import.importedWithSkipped:${imported}:imported:, ${skipped}:skipped: skipped (already in the collage)`;
}
