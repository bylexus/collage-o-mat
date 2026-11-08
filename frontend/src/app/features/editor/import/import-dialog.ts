import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { RouterLink } from '@angular/router';
import { firstValueFrom, Observable } from 'rxjs';
import { ConnectorApi } from '../../../core/api/connector.api';
import { ImmichApi } from '../../../core/api/immich.api';
import { ConnectorSummary } from '../../../core/models/connector';
import { ImmichAlbum, ImmichAsset } from '../../../core/models/immich';
import { ImportRequest, ImportResult, Photo } from '../../../core/models/photo';
import { errorMessage } from '../../../shared/error-message';
import { AlbumList } from './album-list';
import { AssetGrid } from './asset-grid';
import { ConnectorList } from './connector-list';

/** Input of the import dialog. */
export interface ImportDialogData {
  /** Photos already in the collage; their assets are marked "Imported" and cannot be selected. */
  photos: readonly Photo[];
  /**
   * Runs the import (done by the editor page). A rejected promise keeps the dialog open and shows
   * the error; on success the dialog closes with the result.
   */
  importPhotos: (request: ImportRequest) => Promise<ImportResult>;
}

/**
 * Import from Immich in three steps: choose a connector (skipped if there is only one), choose an
 * album, select photos. The step follows from what is chosen. Loads connectors, albums and assets
 * itself; the import is done by the caller (`ImportDialogData.importPhotos`). Closes with the
 * `ImportResult`, or `undefined`.
 */
@Component({
  selector: 'app-import-dialog',
  imports: [
    RouterLink,
    MatButtonModule,
    MatDialogModule,
    MatIconModule,
    MatProgressSpinnerModule,
    AlbumList,
    AssetGrid,
    ConnectorList,
  ],
  templateUrl: './import-dialog.html',
  styleUrl: './import-dialog.scss',
})
export class ImportDialog {
  private readonly data = inject<ImportDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<ImportDialog, ImportResult>>(MatDialogRef);
  private readonly connectorApi = inject(ConnectorApi);
  private readonly immichApi = inject(ImmichApi);

  /** Immich connectors of the user; `null` while loading. */
  protected readonly connectors = signal<readonly ConnectorSummary[] | null>(null);
  protected readonly connector = signal<ConnectorSummary | null>(null);
  /** Albums of the chosen connector; `null` while loading. */
  protected readonly albums = signal<readonly ImmichAlbum[] | null>(null);
  protected readonly album = signal<ImmichAlbum | null>(null);
  protected readonly assets = signal<readonly ImmichAsset[]>([]);
  protected readonly nextPage = signal<number | null>(null);
  protected readonly selectedIds = signal<ReadonlySet<string>>(new Set());

  protected readonly loading = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly importing = signal(false);
  protected readonly importError = signal<string | null>(null);

  /** Back from the photos to the albums, or from the albums to the connectors (if more than one). */
  protected readonly canGoBack = computed(
    () =>
      this.album() !== null || (this.connector() !== null && (this.connectors()?.length ?? 0) > 1),
  );
  /** Source asset ids of the photos in the collage that came from the chosen connector. */
  protected readonly importedIds = computed<ReadonlySet<string>>(() => {
    const connectorId = this.connector()?.id;
    return new Set(
      this.data.photos.filter((p) => p.connectorId === connectorId).map((p) => p.sourceAssetId),
    );
  });
  protected readonly selectedCount = computed(() => this.selectedIds().size);

  /** Increased by each new request and by back navigation; older responses are ignored. */
  private requestId = 0;
  private retryLastLoad: (() => void) | null = null;

  constructor() {
    void this.load(this.connectorApi.list(), (list) => {
      const immich = list.filter((c) => c.type === 'immich');
      this.connectors.set(immich);
      if (immich.length === 1) {
        this.chooseConnector(immich[0]);
      }
    });
  }

  protected chooseConnector(connector: ConnectorSummary): void {
    this.connector.set(connector);
    this.albums.set(null);
    void this.load(this.immichApi.albums(connector.id), (albums) => this.albums.set(albums));
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
    } else {
      this.connector.set(null);
      this.albums.set(null);
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

  /** Selects all loaded assets that are not imported yet. */
  protected selectAll(): void {
    const imported = this.importedIds();
    this.selectedIds.set(new Set(this.assets().flatMap((a) => (imported.has(a.id) ? [] : [a.id]))));
  }

  protected selectNone(): void {
    this.selectedIds.set(new Set());
  }

  protected async import(): Promise<void> {
    const connector = this.connector();
    const selected = this.selectedIds();
    if (!connector || selected.size === 0 || this.importing()) {
      return;
    }
    // Album order, so that the photos keep the order of the album.
    const assetIds = this.assets()
      .filter((a) => selected.has(a.id))
      .map((a) => a.id);
    this.setImporting(true);
    this.importError.set(null);
    try {
      this.ref.close(await this.data.importPhotos({ connectorId: connector.id, assetIds }));
    } catch (err) {
      this.importError.set(errorMessage(err));
      this.setImporting(false);
    }
  }

  private loadAssetPage(page: number): void {
    const connector = this.connector();
    const album = this.album();
    if (!connector || !album) {
      return;
    }
    void this.load(this.immichApi.assets(connector.id, album.id, page), (result) => {
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
