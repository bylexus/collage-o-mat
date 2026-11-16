import { ImportSize } from '../../../core/models/photo';

/** localStorage key of the last chosen import size (per browser, shared by all import dialogs). */
const IMPORT_SIZE_STORAGE_KEY = 'collageomat.importSize';

/** Last chosen import size from localStorage; `preview` if none, invalid or not readable. */
export function readStoredSize(): ImportSize {
  try {
    const value = localStorage.getItem(IMPORT_SIZE_STORAGE_KEY);
    return value === 'original' ? 'original' : 'preview';
  } catch {
    return 'preview';
  }
}

/** Remembers the import size; ignores storage errors (e.g. blocked site data). */
export function storeSize(size: ImportSize): void {
  try {
    localStorage.setItem(IMPORT_SIZE_STORAGE_KEY, size);
  } catch {
    // Not remembered; the choice still applies to this dialog.
  }
}
