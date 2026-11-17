import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { firstValueFrom } from 'rxjs';
import { GooglePhotosApi } from '../../../core/api/google-photos.api';
import { ConnectorSummary } from '../../../core/models/connector';
import {
  GooglePhotosItem,
  GooglePhotosPick,
  googlePhotosThumbnailUrl,
} from '../../../core/models/google-photos';
import { ImportResult, ImportSize } from '../../../core/models/photo';
import { errorMessage } from '../../../shared/error-message';
import { AssetGrid } from './asset-grid';
import { ImportDialogData } from './import-dialog';
import { readStoredSize, storeSize } from './import-size';
import { withinOriginalPixelLimit } from './original-size';

/**
 * Phase of the dialog: `start` = nothing picked yet, `waiting` = a pick runs in the popup window,
 * `grid` = picked photos are shown, `error` = the last pick failed.
 */
type Phase = 'start' | 'waiting' | 'grid' | 'error';

/** Picked photo with the pick it came from (needed for the thumbnail route). */
interface PickedAsset extends GooglePhotosItem {
  pickId: string;
}

/** Name of the popup window (one popup per browser window, reused by later picks). */
const POPUP_NAME = 'collageomat-google-photos';
const POPUP_FEATURES = 'popup,width=1000,height=800';
/** Delay of the first poll after the popup got its URL. */
const FIRST_POLL_DELAY_MS = 1000;
/** Poll interval if the backend sends none. */
const DEFAULT_POLL_INTERVAL_MS = 3000;

/** The pick that runs now (phase `waiting`). */
interface ActivePick {
  /** Pick id; `null` until `createPick` answered. */
  pickId: string | null;
  /** Phase to go back to when the pick is cancelled. */
  previous: 'start' | 'grid';
}

/**
 * Import from the Google Photos connector of `ImportDialogData.connector`. The photos are picked in
 * Google's own picker page in a popup window (Picker API); the dialog polls the pick until the user
 * clicks "Done" and then shows the picked photos in the grid (all pre-selected). "Pick more photos"
 * appends to the grid. All picks of the dialog are deleted when it closes. The import is done by
 * the caller (`ImportDialogData.importPhotos`). Closes with the `ImportResult`, or `undefined`.
 */
@Component({
  selector: 'app-google-photos-import-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatButtonToggleModule,
    MatDialogModule,
    MatIconModule,
    MatProgressSpinnerModule,
    AssetGrid,
  ],
  templateUrl: './google-photos-import-dialog.html',
  styleUrls: ['./import-dialog.scss', './google-photos-import-dialog.scss'],
})
export class GooglePhotosImportDialog {
  private readonly data = inject<ImportDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<GooglePhotosImportDialog, ImportResult>>(MatDialogRef);
  private readonly api = inject(GooglePhotosApi);

  protected readonly connector: ConnectorSummary = this.data.connector;
  protected readonly phase = signal<Phase>('start');
  /** Message of phase `error`. */
  protected readonly pickError = signal<string | null>(null);
  /** Picked photos of all picks of this dialog, in pick order, without duplicates. */
  protected readonly assets = signal<readonly PickedAsset[]>([]);
  /** Sum of the skipped videos of all finished picks. */
  protected readonly skippedVideos = signal(0);
  protected readonly selectedIds = signal<ReadonlySet<string>>(new Set());
  /** Image size of the import; the last choice is remembered (same key as the other dialogs). */
  protected readonly size = signal<ImportSize>(readStoredSize());

  protected readonly importing = signal(false);
  protected readonly importError = signal<string | null>(null);

  /** Source asset ids of the photos in the collage that came from the connector. */
  protected readonly importedIds: ReadonlySet<string> = new Set(
    this.data.photos.filter((p) => p.connectorId === this.connector.id).map((p) => p.sourceAssetId),
  );
  /**
   * Picked photos that cannot be imported in the chosen size (only in original mode). The backend
   * falls back to the preview for formats it cannot decode, so only the pixel limit applies.
   */
  protected readonly unavailableIds = computed<ReadonlySet<string>>(() =>
    this.size() === 'original'
      ? new Set(this.assets().flatMap((a) => (withinOriginalPixelLimit(a) ? [] : [a.id])))
      : new Set(),
  );
  protected readonly selectedCount = computed(() => this.selectedIds().size);
  /** Thumbnail URL function of the asset grid. */
  protected readonly assetThumbnailUrl = (asset: PickedAsset): string =>
    googlePhotosThumbnailUrl(this.connector.id, asset.pickId, asset.id);
  protected readonly unavailableReason = $localize`:@@editor.googlePhotosImport.originalUnavailableReason:Not available in original size: images over 60 megapixels are not supported. Use the preview size.`;

  /** Ids of all picks that this dialog created; deleted when the dialog closes. */
  private readonly pickIds = new Set<string>();
  private active: ActivePick | null = null;
  /** Increased when a pick ends (done, error, cancel, destroy); older callbacks are ignored. */
  private generation = 0;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.cleanUp());
  }

  /**
   * Starts a new pick ("Open Google Photos", "Pick more photos", "Try again"). The popup is opened
   * synchronously in the click handler (popup blockers), before the HTTP call. After the popup got
   * the Google URL, it is not touched again: Google's page sends
   * `Cross-Origin-Opener-Policy: same-origin-allow-popups`, which severs the opener link
   * (`popup.closed` reads `true` while the window is still open). So the pick ends only by its
   * status (`done`, `error`), the Cancel button or the dialog close.
   */
  protected async startPick(): Promise<void> {
    if (this.phase() === 'waiting' || this.importing()) {
      return;
    }
    const previous = this.assets().length > 0 ? 'grid' : 'start';
    const popup = window.open('', POPUP_NAME, POPUP_FEATURES);
    if (!popup) {
      this.showError(
        $localize`:@@editor.googlePhotosImport.popupBlocked:The popup was blocked. Allow popups for Collageomat and try again.`,
      );
      return;
    }
    const generation = ++this.generation;
    const active: ActivePick = { pickId: null, previous };
    this.active = active;
    this.importError.set(null);
    this.pickError.set(null);
    this.phase.set('waiting');
    try {
      const { pickId, openUrl } = await firstValueFrom(this.api.createPick(this.connector.id));
      this.pickIds.add(pickId);
      if (generation !== this.generation) {
        // Cancelled or closed while the pick was created; the popup still shows our about:blank.
        this.deletePick(pickId);
        popup.close();
        return;
      }
      active.pickId = pickId;
      popup.location.href = openUrl;
      this.schedulePoll(generation, FIRST_POLL_DELAY_MS);
    } catch (err) {
      if (generation !== this.generation) {
        return;
      }
      // The popup still shows our about:blank (same origin), so it can be closed.
      popup.close();
      this.endActive();
      this.showError(errorMessage(err));
    }
  }

  /** Cancels the running pick: stops polling and deletes the pick. */
  protected cancelPick(): void {
    const active = this.active;
    if (!active) {
      return;
    }
    this.endActive();
    if (active.pickId) {
      this.deletePick(active.pickId);
    }
    this.phase.set(active.previous);
  }

  /** Back from the error to the picked photos. */
  protected showPicked(): void {
    this.pickError.set(null);
    this.phase.set('grid');
  }

  protected toggle(assetId: string): void {
    this.selectedIds.update((current) => {
      const next = new Set(current);
      if (!next.delete(assetId)) {
        next.add(assetId);
      }
      return next;
    });
  }

  /** Selects all picked photos that are not imported yet and are available in the chosen size. */
  protected selectAll(): void {
    this.selectedIds.set(new Set(this.selectableIds(this.assets())));
  }

  protected selectNone(): void {
    this.selectedIds.set(new Set());
  }

  /** Sets and remembers the import size; removes photos that are not available from the selection. */
  protected setSize(size: ImportSize): void {
    this.size.set(size);
    storeSize(size);
    const unavailable = this.unavailableIds();
    if (unavailable.size > 0) {
      this.selectedIds.update(
        (current) => new Set([...current].filter((id) => !unavailable.has(id))),
      );
    }
  }

  protected async import(): Promise<void> {
    const selected = this.selectedIds();
    if (selected.size === 0 || this.importing() || this.phase() !== 'grid') {
      return;
    }
    // Pick order, so that the photos keep the order of the grid.
    const assetIds = this.assets()
      .filter((a) => selected.has(a.id))
      .map((a) => a.id);
    this.setImporting(true);
    this.importError.set(null);
    try {
      this.ref.close(
        await this.data.importPhotos({
          connectorId: this.connector.id,
          assetIds,
          size: this.size(),
        }),
      );
    } catch (err) {
      this.importError.set(errorMessage(err));
      this.setImporting(false);
    }
  }

  private schedulePoll(generation: number, delayMs: number): void {
    this.clearPollTimer();
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      void this.poll(generation);
    }, delayMs);
  }

  /** Asks the backend for the state of the running pick; polls again until `done` or `error`. */
  private async poll(generation: number): Promise<void> {
    const active = this.active;
    if (generation !== this.generation || !active?.pickId) {
      return;
    }
    const pickId = active.pickId;
    let pick: GooglePhotosPick;
    try {
      pick = await firstValueFrom(this.api.getPick(this.connector.id, pickId));
    } catch (err) {
      if (generation !== this.generation) {
        return;
      }
      this.endActive();
      this.deletePick(pickId);
      this.showError(errorMessage(err));
      return;
    }
    if (generation !== this.generation) {
      return;
    }
    switch (pick.status) {
      case 'done':
        this.endActive();
        this.addPicked(pickId, pick);
        break;
      case 'error':
        this.endActive();
        this.deletePick(pickId);
        this.showError(pick.error || errorMessage(null));
        break;
      default:
        this.schedulePoll(generation, pick.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS);
    }
  }

  /** Appends the photos of a finished pick (without duplicates) and selects the new ones. */
  private addPicked(pickId: string, pick: GooglePhotosPick): void {
    const known = new Set(this.assets().map((a) => a.id));
    const added: PickedAsset[] = [];
    for (const item of pick.items) {
      if (!known.has(item.id)) {
        known.add(item.id);
        added.push({ ...item, pickId });
      }
    }
    this.assets.update((current) => [...current, ...added]);
    this.skippedVideos.update((count) => count + pick.skippedVideos);
    const selectable = this.selectableIds(added);
    if (selectable.length > 0) {
      this.selectedIds.update((current) => new Set([...current, ...selectable]));
    }
    this.phase.set('grid');
  }

  /** Ids of the given photos that are not imported yet and are available in the chosen size. */
  private selectableIds(assets: readonly PickedAsset[]): string[] {
    const imported = this.importedIds;
    const unavailable = this.unavailableIds();
    return assets.flatMap((a) => (imported.has(a.id) || unavailable.has(a.id) ? [] : [a.id]));
  }

  private showError(message: string): void {
    this.pickError.set(message);
    this.phase.set('error');
  }

  /** Ends the running pick: stops polling and ignores its pending callbacks. */
  private endActive(): void {
    this.generation++;
    this.clearPollTimer();
    this.active = null;
  }

  /** Deletes a pick (fire and forget; errors are ignored). */
  private deletePick(pickId: string): void {
    this.pickIds.delete(pickId);
    this.api.deletePick(this.connector.id, pickId).subscribe({ error: () => undefined });
  }

  /** On dialog close: stops the running pick and deletes all picks. */
  private cleanUp(): void {
    this.endActive();
    for (const pickId of [...this.pickIds]) {
      this.deletePick(pickId);
    }
  }

  private clearPollTimer(): void {
    if (this.pollTimer !== null) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private setImporting(importing: boolean): void {
    this.importing.set(importing);
    this.ref.disableClose = importing;
  }
}
