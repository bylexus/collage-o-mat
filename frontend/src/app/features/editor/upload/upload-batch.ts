import { catchError, from, map, mergeMap, Observable, of, scan, startWith } from 'rxjs';
import { ImportResult } from '../../../core/models/photo';
import { errorMessage } from '../../../shared/error-message';

/** MIME types the upload endpoint accepts (same list as the `accept` of the file input). */
export const UPLOAD_MIME_TYPES: readonly string[] = ['image/jpeg', 'image/png', 'image/webp'];

/** Maximum number of upload requests at the same time. */
const MAX_PARALLEL_UPLOADS = 3;

/** A file that could not be uploaded. */
export interface UploadFailure {
  fileName: string;
  reason: string;
}

/** State of a running upload batch. */
export interface UploadBatchState {
  /** Number of finished files (uploaded, skipped or failed). */
  done: number;
  total: number;
  /** Merged result of the uploaded files: photos sorted by id ascending, skipped summed. */
  result: ImportResult;
  failures: UploadFailure[];
}

type FileOutcome = { result: ImportResult } | { failure: UploadFailure };

/**
 * Uploads the files with at most 3 requests at the same time. Emits the start state (`done` 0)
 * and one state after each finished file; the last state is the final result. A failed file does
 * not stop the others. Files with a type that is not in `UPLOAD_MIME_TYPES` fail without a
 * request. Unsubscribing cancels the open requests.
 */
export function uploadBatch(
  files: readonly File[],
  upload: (file: File) => Observable<ImportResult>,
): Observable<UploadBatchState> {
  const start: UploadBatchState = {
    done: 0,
    total: files.length,
    result: { photos: [], skipped: 0 },
    failures: [],
  };
  return from(files).pipe(
    mergeMap((file) => uploadOne(file, upload), MAX_PARALLEL_UPLOADS),
    scan(addOutcome, start),
    startWith(start),
  );
}

function uploadOne(
  file: File,
  upload: (file: File) => Observable<ImportResult>,
): Observable<FileOutcome> {
  if (!UPLOAD_MIME_TYPES.includes(file.type)) {
    const reason = $localize`:@@editor.upload.unsupportedFormat:unsupported format, only JPEG, PNG and WebP`;
    return of({ failure: { fileName: file.name, reason } });
  }
  return upload(file).pipe(
    map((result): FileOutcome => ({ result })),
    catchError((err: unknown) =>
      of({ failure: { fileName: file.name, reason: errorMessage(err) } }),
    ),
  );
}

function addOutcome(state: UploadBatchState, outcome: FileOutcome): UploadBatchState {
  const done = state.done + 1;
  if ('failure' in outcome) {
    return { ...state, done, failures: [...state.failures, outcome.failure] };
  }
  const photos = [...state.result.photos, ...outcome.result.photos].sort((a, b) => a.id - b.id);
  const skipped = state.result.skipped + outcome.result.skipped;
  return { ...state, done, result: { photos, skipped } };
}
