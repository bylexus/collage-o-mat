import { UploadFailure } from './upload-batch';

/** Number of failed files named in the message; the rest is counted ("and 2 more"). */
const MAX_LISTED_FAILURES = 3;

/**
 * Error text after an upload batch (one line, for a snackbar):
 * "2 files not uploaded: a.heic (unsupported format); b.jpg (image too large)", plus
 * "; and 4 more" when more than 3 files failed.
 */
export function uploadFailureMessage(failures: readonly UploadFailure[]): string {
  const count = failures.length;
  const listed = failures
    .slice(0, MAX_LISTED_FAILURES)
    .map((failure) => `${failure.fileName} (${failure.reason})`)
    .join('; ');
  const heading =
    count === 1
      ? $localize`:@@editor.upload.failedOne:1 file not uploaded`
      : $localize`:@@editor.upload.failedMany:${count}:count: files not uploaded`;
  const rest = count - MAX_LISTED_FAILURES;
  if (rest <= 0) {
    return $localize`:@@editor.upload.failedList:${heading}:heading:: ${listed}:files:`;
  }
  return $localize`:@@editor.upload.failedWithMore:${heading}:heading:: ${listed}:files:; and ${rest}:rest: more`;
}
