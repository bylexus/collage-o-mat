import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTabsModule } from '@angular/material/tabs';
import { firstValueFrom, forkJoin, Observable } from 'rxjs';
import { SynologyApi } from '../../../core/api/synology.api';
import { ConnectorSummary } from '../../../core/models/connector';
import { ImportResult, ImportSize } from '../../../core/models/photo';
import {
  SYNOLOGY_ROOT_FOLDER,
  SynologyAlbum,
  SynologyAsset,
  SynologyAssetPage,
  SynologyFolder,
  SynologyFolderRef,
  synologyThumbnailUrl,
} from '../../../core/models/synology';
import { errorMessage } from '../../../shared/error-message';
import { AlbumList } from './album-list';
import { AssetGrid } from './asset-grid';
import { ImportDialogData } from './import-dialog';
import { readStoredSize, storeSize } from './import-size';
import { withinOriginalPixelLimit } from './original-size';

/** Tab of the Synology import dialog. */
type SynologyTab = 'albums' | 'shared' | 'folders' | 'sharedSpace';

/** Folder tree of Synology Photos: Personal Space (tab "Folders") or Shared Space. */
type FolderSpace = 'personal' | 'sharedSpace';

/** Folder tree that a tab shows; tabs without folder navigation are missing. */
const FOLDER_SPACE_OF_TAB: Readonly<Partial<Record<SynologyTab, FolderSpace>>> = {
  folders: 'personal',
  sharedSpace: 'sharedSpace',
};

/** One step of the folder path from the root folder to the current folder. */
interface FolderTrailEntry {
  /** Folder id in the folder routes (`SYNOLOGY_ROOT_FOLDER` for the root folder). */
  key: string;
  /** Shown name; `""` for the root folder. */
  name: string;
}

/** Folder path that contains only the root folder. */
const ROOT_TRAIL: readonly FolderTrailEntry[] = [{ key: SYNOLOGY_ROOT_FOLDER, name: '' }];

/**
 * Import from Synology Photos of the connector `ImportDialogData.connector`: in the tab "Albums"
 * choose an own album, in the tab "Shared with me" an album that another user shared with the
 * account, or in the tabs "Folders" (Personal Space) and "Shared Space" navigate the folder tree
 * (subfolders and the photos of the current folder), and select photos. The tab "Shared Space" is
 * shown only if the account has access to it (checked when the dialog opens). Loads albums, folders and photos itself; the
 * import is done by the caller (`ImportDialogData.importPhotos`). Closes with the `ImportResult`,
 * or `undefined`.
 */
@Component({
  selector: 'app-synology-import-dialog',
  imports: [
    MatButtonModule,
    MatButtonToggleModule,
    MatDialogModule,
    MatIconModule,
    MatListModule,
    MatProgressSpinnerModule,
    MatTabsModule,
    AlbumList,
    AssetGrid,
  ],
  templateUrl: './synology-import-dialog.html',
  styleUrls: ['./import-dialog.scss', './synology-import-dialog.scss'],
})
export class SynologyImportDialog {
  private readonly data = inject<ImportDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<SynologyImportDialog, ImportResult>>(MatDialogRef);
  private readonly synologyApi = inject(SynologyApi);

  protected readonly connector: ConnectorSummary = this.data.connector;
  protected readonly tab = signal<SynologyTab>('albums');
  /** Albums of the connector; `null` while loading or not loaded yet. */
  protected readonly albums = signal<readonly SynologyAlbum[] | null>(null);
  /** Albums shared with the account; `null` while loading or not loaded yet. */
  protected readonly sharedAlbums = signal<readonly SynologyAlbum[] | null>(null);
  /** Open album; it is from the list of the current tab ("Albums" or "Shared with me"). */
  protected readonly album = signal<SynologyAlbum | null>(null);
  /** Whether the account has access to the Shared Space; `null` while the check is pending. */
  protected readonly sharedSpaceAvailable = signal<boolean | null>(null);
  /** Folder tree of the current tab; `null` for a tab without folder navigation. */
  protected readonly space = computed<FolderSpace | null>(
    () => FOLDER_SPACE_OF_TAB[this.tab()] ?? null,
  );
  /** Path from the root folder to the last opened folder, per folder tree. */
  private readonly trails = signal<Readonly<Record<FolderSpace, readonly FolderTrailEntry[]>>>({
    personal: ROOT_TRAIL,
    sharedSpace: ROOT_TRAIL,
  });
  /** Path from the root folder to the current folder of the current tab's folder tree. */
  protected readonly trail = computed<readonly FolderTrailEntry[]>(() => {
    const space = this.space();
    return space ? this.trails()[space] : ROOT_TRAIL;
  });
  /** Current folder with its subfolders; `null` while loading. */
  protected readonly folder = signal<SynologyFolder | null>(null);
  /** Photos of the open album or of the current folder. */
  protected readonly assets = signal<readonly SynologyAsset[]>([]);
  protected readonly nextPage = signal<number | null>(null);
  protected readonly selectedIds = signal<ReadonlySet<string>>(new Set());
  /** Image size of the import; the last choice is remembered (same key as the Immich dialog). */
  protected readonly size = signal<ImportSize>(readStoredSize());

  protected readonly loading = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly importing = signal(false);
  protected readonly importError = signal<string | null>(null);

  /** True if photos are shown: an open album, or the current folder in a folder tab. */
  protected readonly showPhotos = computed(
    () => this.album() !== null || (this.space() !== null && this.folder() !== null),
  );
  /** Back from the album to the albums, or to the parent folder. */
  protected readonly canGoBack = computed(
    () => this.album() !== null || (this.space() !== null && this.trail().length > 1),
  );
  /** Source asset ids of the photos in the collage that came from the connector. */
  protected readonly importedIds: ReadonlySet<string> = new Set(
    this.data.photos.filter((p) => p.connectorId === this.connector.id).map((p) => p.sourceAssetId),
  );
  /**
   * Loaded photos that cannot be imported in the chosen size (only in original mode). The backend
   * falls back to the preview for formats it cannot decode, so only the pixel limit applies.
   */
  protected readonly unavailableIds = computed<ReadonlySet<string>>(() =>
    this.size() === 'original'
      ? new Set(this.assets().flatMap((a) => (withinOriginalPixelLimit(a) ? [] : [a.id])))
      : new Set(),
  );
  protected readonly selectedCount = computed(() => this.selectedIds().size);
  /** Thumbnail URL function of the asset grid (for the connector). */
  protected readonly assetThumbnailUrl = (asset: SynologyAsset): string =>
    synologyThumbnailUrl(this.connector.id, asset);
  /** Cover URL function of the album list: Synology albums have no cover (album icon). */
  protected readonly albumCoverUrl = (_album: SynologyAlbum): string | null => null;
  protected readonly unavailableReason = $localize`:@@import.synology.originalUnavailableReason:Not available in original size: images over 60 megapixels are not supported. Use the preview size.`;
  private readonly personalRootName = $localize`:@@import.synology.folders.root:Personal Space`;
  private readonly sharedSpaceRootName = $localize`:@@import.synology.sharedSpace.root:Shared Space`;
  /** Breadcrumb label of the root folder of the current tab's folder tree. */
  protected readonly rootFolderName = computed(() =>
    this.space() === 'sharedSpace' ? this.sharedSpaceRootName : this.personalRootName,
  );

  /** Increased by each new request and by navigation; older responses are ignored. */
  private requestId = 0;
  private retryLastLoad: (() => void) | null = null;

  constructor() {
    this.showTab(this.tab());
    this.checkSharedSpace();
  }

  /** Switches the tab; the photos and the selection of the other tab are cleared. */
  protected chooseTab(tab: SynologyTab): void {
    if (tab !== this.tab()) {
      this.showTab(tab);
    }
  }

  protected chooseAlbum(album: SynologyAlbum): void {
    this.album.set(album);
    this.clearPhotos();
    this.loadAssetPage(1);
  }

  protected openSubfolder(ref: SynologyFolderRef): void {
    const space = this.space();
    if (space) {
      this.openFolder(space, [...this.trail(), { key: ref.id, name: ref.name }]);
    }
  }

  /** Opens the folder at `index` of the folder path (breadcrumb). */
  protected openTrailFolder(index: number): void {
    const space = this.space();
    if (space) {
      this.openFolder(space, this.trail().slice(0, index + 1));
    }
  }

  protected loadMore(): void {
    const page = this.nextPage();
    if (page !== null) {
      this.loadAssetPage(page);
    }
  }

  protected back(): void {
    this.cancelLoad();
    const space = this.space();
    if (this.album()) {
      this.album.set(null);
      this.clearPhotos();
    } else if (space && this.trail().length > 1) {
      this.openFolder(space, this.trail().slice(0, -1));
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

  /** Selects all loaded photos that are not imported yet and are available in the chosen size. */
  protected selectAll(): void {
    const imported = this.importedIds;
    const unavailable = this.unavailableIds();
    this.selectedIds.set(
      new Set(
        this.assets().flatMap((a) => (imported.has(a.id) || unavailable.has(a.id) ? [] : [a.id])),
      ),
    );
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

  protected selectNone(): void {
    this.selectedIds.set(new Set());
  }

  protected async import(): Promise<void> {
    const connector = this.connector;
    const selected = this.selectedIds();
    if (selected.size === 0 || this.importing()) {
      return;
    }
    // Album or folder order, so that the photos keep the order of the NAS.
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

  /** Shows a tab of the connector and loads its content. */
  private showTab(tab: SynologyTab): void {
    const connector = this.connector;
    this.cancelLoad();
    this.tab.set(tab);
    this.album.set(null);
    this.clearPhotos();
    const space = this.space();
    if (space) {
      this.openFolder(space, this.trail());
    } else if (tab === 'shared') {
      if (this.sharedAlbums() === null) {
        void this.load(this.synologyApi.sharedAlbums(connector.id), (albums) =>
          this.sharedAlbums.set(albums),
        );
      }
    } else if (this.albums() === null) {
      void this.load(this.synologyApi.albums(connector.id), (albums) => this.albums.set(albums));
    }
  }

  /**
   * Checks once whether the account has access to the Shared Space. Independent of the shared
   * loading/error state of the tabs; the result is ignored after the dialog is closed. On an error
   * the tab is shown, so that the error appears when the tab is opened.
   */
  private checkSharedSpace(): void {
    this.synologyApi
      .sharedSpace(this.connector.id)
      .pipe(takeUntilDestroyed())
      .subscribe({
        next: ({ available }) => this.sharedSpaceAvailable.set(available),
        error: () => this.sharedSpaceAvailable.set(true),
      });
  }

  /**
   * Opens the last folder of `trail` in the folder tree `space` (folder with subfolders and the
   * first page of photos).
   */
  private openFolder(space: FolderSpace, trail: readonly FolderTrailEntry[]): void {
    const key = trail.at(-1)?.key;
    if (key === undefined) {
      return;
    }
    this.trails.update((current) => ({ ...current, [space]: trail }));
    this.folder.set(null);
    this.clearPhotos();
    const request = forkJoin({
      folder: this.folderRequest(space, key),
      page: this.folderAssetsRequest(space, key, 1),
    });
    void this.load(request, ({ folder, page }) => {
      this.folder.set(folder);
      this.assets.set(page.items);
      this.nextPage.set(page.nextPage);
    });
  }

  private loadAssetPage(page: number): void {
    const connector = this.connector;
    const album = this.album();
    const space = this.space();
    const folderKey = this.trail().at(-1)?.key ?? SYNOLOGY_ROOT_FOLDER;
    let request: Observable<SynologyAssetPage>;
    if (album) {
      request =
        this.tab() === 'shared'
          ? this.synologyApi.sharedAlbumAssets(connector.id, album.id, page)
          : this.synologyApi.albumAssets(connector.id, album.id, page);
    } else if (space) {
      request = this.folderAssetsRequest(space, folderKey, page);
    } else {
      return;
    }
    void this.load(request, (result) => {
      this.assets.update((current) => [...current, ...result.items]);
      this.nextPage.set(result.nextPage);
    });
  }

  private folderRequest(space: FolderSpace, folderKey: string): Observable<SynologyFolder> {
    const connectorId = this.connector.id;
    return space === 'sharedSpace'
      ? this.synologyApi.sharedSpaceFolder(connectorId, folderKey)
      : this.synologyApi.folder(connectorId, folderKey);
  }

  private folderAssetsRequest(
    space: FolderSpace,
    folderKey: string,
    page: number,
  ): Observable<SynologyAssetPage> {
    const connectorId = this.connector.id;
    return space === 'sharedSpace'
      ? this.synologyApi.sharedSpaceFolderAssets(connectorId, folderKey, page)
      : this.synologyApi.folderAssets(connectorId, folderKey, page);
  }

  private clearPhotos(): void {
    this.assets.set([]);
    this.nextPage.set(null);
    this.selectedIds.set(new Set());
  }

  /**
   * Runs a load request with the shared loading/error state and remembers it for "Retry".
   * The result is applied only if no newer request or navigation happened meanwhile.
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
