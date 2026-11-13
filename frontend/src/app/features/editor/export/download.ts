// Browser download of a generated file. No Angular.
import type { ExportFormat } from './page-export';

/** File name used when the collage name gives no usable name. */
const FALLBACK_FILE_NAME = 'collage';

/** Characters that are not allowed in file names on common systems, plus control characters. */
const INVALID_FILE_NAME_CHARS = /[/\\:*?"<>|\u0000-\u001f\u007f]/g;

/**
 * File name of an exported image: `<collage name>.<png|jpg>`. Invalid characters are replaced by
 * `_`, spaces at the start and end are removed; an empty name gives `collage`.
 */
export function exportFileName(collageName: string, format: ExportFormat): string {
  const base = collageName.replace(INVALID_FILE_NAME_CHARS, '_').trim();
  return `${base === '' ? FALLBACK_FILE_NAME : base}.${format}`;
}

/** Starts the download of `blob` as `fileName` (temporary object URL and `<a download>` click). */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.style.display = 'none';
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    // Revoke after the click was handled; some browsers read the URL asynchronously.
    setTimeout(() => URL.revokeObjectURL(url));
  }
}
