import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { firstValueFrom, Observable } from 'rxjs';
import { ImmichApi } from '../../../core/api/immich.api';
import { ConnectorSummary } from '../../../core/models/connector';
import { ImmichAlbum, ImmichAsset, immichThumbnailUrl } from '../../../core/models/immich';
import { ImportRequest, ImportResult, ImportSize, Photo } from '../../../core/models/photo';
import { errorMessage } from '../../../shared/error-message';
import { AlbumList } from './album-list';
import { AssetGrid } from './asset-grid';
import { readStoredSize, storeSize } from './import-size';
import { supportsOriginalSize } from './original-size';

/** Input of the import dialog. */
export interface ImportDialogData {
  /** Connector to import from (chosen in the editor's "Import" menu); its type fits the dialog. */
  connector: ConnectorSummary;
  /** Photos already in the collage; their assets are marked "Imported" and cannot be selected. */
  photos: readonly Photo[];
  /**
   * Runs the import (done by the editor page). A rejected promise keeps the dialog open and shows
   * the error; on success the dialog closes with the result.
   */
  importPhotos: (request: ImportRequest) => Promise<ImportResult>;
}

/**
 * Import from the Immich connector of `ImportDialogData.connector` in two steps: choose an album,
 * select photos. The step follows from what is chosen. Loads albums and assets itself; the import
 * is done by the caller (`ImportDialogData.importPhotos`). Closes with the `ImportResult`, or
 * `undefined`.
 */
@Component({
  selector: 'app-import-dialog',
  imports: [
    MatButtonModule,
    MatButtonToggleModule,
    MatDialogModule,
    MatIconModule,
    MatProgressSpinnerModule,
    AlbumList,
    AssetGrid,
  ],
  templateUrl: './import-dialog.html',
  styleUrl: './import-dialog.scss',
})
export class ImportDialog {
  private readonly data = inject<ImportDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<ImportDialog, ImportResult>>(MatDialogRef);
  private readonly immichApi = inject(ImmichApi);

  protected readonly connector: ConnectorSummary = this.data.connector;
  /** Albums of the connector; `null` while loading. */
  protected readonly albums = signal<readonly ImmichAlbum[] | null>(null);
  protected readonly album = signal<ImmichAlbum | null>(null);
  protected readonly assets = signal<readonly ImmichAsset[]>([]);
  protected readonly nextPage = signal<number | null>(null);
  protected readonly selectedIds = signal<ReadonlySet<string>>(new Set());
  /** Image size of the import; the last choice is remembered in localStorage. */
  protected readonly size = signal<ImportSize>(readStoredSize());

  protected readonly loading = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly importing = signal(false);
  protected readonly importError = signal<string | null>(null);

  /** Back from the photos to the albums. */
  protected readonly canGoBack = computed(() => this.album() !== null);
  /** Source asset ids of the photos in the collage that came from the connector. */
  protected readonly importedIds: ReadonlySet<string> = new Set(
    this.data.photos.filter((p) => p.connectorId === this.connector.id).map((p) => p.sourceAssetId),
  );
  /** Loaded assets that cannot be imported in the chosen size (only in original mode). */
  protected readonly unavailableIds = computed<ReadonlySet<string>>(() =>
    this.size() === 'original'
      ? new Set(this.assets().flatMap((a) => (supportsOriginalSize(a) ? [] : [a.id])))
      : new Set(),
  );
  protected readonly selectedCount = computed(() => this.selectedIds().size);
  /** Thumbnail URL function of the asset grid (for the connector). */
  protected readonly assetThumbnailUrl = (asset: ImmichAsset): string =>
    immichThumbnailUrl(this.connector.id, asset.id);
  /** Cover URL function of the album list (for the connector); `null` if no cover. */
  protected readonly albumCoverUrl = (album: ImmichAlbum): string | null =>
    album.thumbnailAssetId ? immichThumbnailUrl(this.connector.id, album.thumbnailAssetId) : null;

  /** Increased by each new request and by back navigation; older responses are ignored. */
  private requestId = 0;
  private retryLastLoad: (() => void) | null = null;

  constructor() {
    void this.load(this.immichApi.albums(this.connector.id), (albums) => this.albums.set(albums));
  }

  protected chooseAlbum(album: ImmichAlbum): void {
    this.album.set(album);
    this.assets.set([]);
    this.nextPage.set(null);
    this.selectedIds.set(new Set());
    this.loadAssetPage(1);
  }

  protected loadMore(): void {
    const page = this.nextPage();
    if (page !== null) {
      this.loadAssetPage(page);
    }
  }

  protected back(): void {
    this.cancelLoad();
    if (this.album()) {
      this.album.set(null);
      this.assets.set([]);
      this.selectedIds.set(new Set());
    }
  }

  protected retry(): void {
    this.retryLastLoad?.();
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

  /** Selects all loaded assets that are not imported yet and are available in the chosen size. */
  protected selectAll(): void {
    const imported = this.importedIds;
    const unavailable = this.unavailableIds();
    this.selectedIds.set(
      new Set(
        this.assets().flatMap((a) => (imported.has(a.id) || unavailable.has(a.id) ? [] : [a.id])),
      ),
    );
  }

  /** Sets and remembers the import size; removes assets that are not available from the selection. */
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

  protected selectNone(): void {
    this.selectedIds.set(new Set());
  }

  protected async import(): Promise<void> {
    const connector = this.connector;
    const selected = this.selectedIds();
    if (selected.size === 0 || this.importing()) {
      return;
    }
    // Album order, so that the photos keep the order of the album.
    const assetIds = this.assets()
      .filter((a) => selected.has(a.id))
      .map((a) => a.id);
    this.setImporting(true);
    this.importError.set(null);
    try {
      this.ref.close(
        await this.data.importPhotos({ connectorId: connector.id, assetIds, size: this.size() }),
      );
    } catch (err) {
      this.importError.set(errorMessage(err));
      this.setImporting(false);
    }
  }

  private loadAssetPage(page: number): void {
    const album = this.album();
    if (!album) {
      return;
    }
    void this.load(this.immichApi.assets(this.connector.id, album.id, page), (result) => {
      this.assets.update((current) => [...current, ...result.items]);
      this.nextPage.set(result.nextPage);
    });
  }

  /**
   * Runs a load request with the shared loading/error state and remembers it for "Retry".
   * The result is applied only if no newer request or back navigation happened meanwhile.
   */
  private async load<T>(request: Observable<T>, apply: (value: T) => void): Promise<void> {
    const id = ++this.requestId;
    this.retryLastLoad = () => void this.load(request, apply);
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const value = await firstValueFrom(request);
      if (id === this.requestId) {
        apply(value);
      }
    } catch (err) {
      if (id === this.requestId) {
        this.loadError.set(errorMessage(err));
      }
    } finally {
      if (id === this.requestId) {
        this.loading.set(false);
      }
    }
  }

  private cancelLoad(): void {
    this.requestId++;
    this.retryLastLoad = null;
    this.loading.set(false);
    this.loadError.set(null);
  }

  private setImporting(importing: boolean): void {
    this.importing.set(importing);
    this.ref.disableClose = importing;
  }
}
