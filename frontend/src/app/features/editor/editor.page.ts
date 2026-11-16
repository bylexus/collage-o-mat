import { CdkTrapFocus } from '@angular/cdk/a11y';
import {
  CdkConnectedOverlay,
  CdkOverlayOrigin,
  ComponentType,
  ConnectedPosition,
} from '@angular/cdk/overlay';
import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom, Subscription } from 'rxjs';
import { ConnectorApi } from '../../core/api/connector.api';
import { PhotoApi } from '../../core/api/photo.api';
import {
  ArrangementMode,
  DEFAULT_DPI,
  pageLabel,
  SnapGridSettings,
} from '../../core/models/collage';
import { ConnectorSummary } from '../../core/models/connector';
import { ImportResult, isPlaced, photoFileUrl } from '../../core/models/photo';
import { errorMessage } from '../../shared/error-message';
import { NotificationService } from '../../shared/notification.service';
import { connectorTypeLabel } from '../connectors/connector-types';
import { resolveCentrePhotoId } from './arrange/arrange';
import { EditorCanvas } from './canvas/editor-canvas';
import type { Point } from './canvas/viewport';
import { renderPageImage } from './canvas/page-image-renderer';
import { EditorStore } from './editor.store';
import { LengthUnit } from './geometry/length-unit';
import { downloadBlob, exportFileName } from './export/download';
import { ExportDialog, ExportDialogData } from './export/export-dialog';
import { ImportDialog, ImportDialogData } from './import/import-dialog';
import { SynologyImportDialog } from './import/synology-import-dialog';
import { importResultMessage } from './import/import-result-message';
import { SaveStatusIndicator } from './save-status-indicator';
import { ArrangementSettingsDialogService } from './settings-panel/arrangement-settings-dialog.service';
import { CollageSettingsPanel } from './settings-panel/collage-settings-panel';
import { SnapGridPopover } from './snap-grid/snap-grid-popover';
import { SelectionToolbar } from './toolbar/selection-toolbar';
import { undoRedoCommand, undoRedoShortcutLabels } from './undo-shortcut';
import { UPLOAD_MIME_TYPES, uploadBatch, UploadBatchState } from './upload/upload-batch';
import { uploadFailureMessage } from './upload/upload-failure-message';

/**
 * Editor of one collage (container): toolbar, Konva canvas with the selection toolbar below the
 * selected element (photo and text properties in its popovers), and side panel (collage
 * settings). The state lives in the page-scoped `EditorStore`.
 */
@Component({
  selector: 'app-editor-page',
  imports: [
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    CdkOverlayOrigin,
    CdkConnectedOverlay,
    CdkTrapFocus,
    EditorCanvas,
    CollageSettingsPanel,
    SaveStatusIndicator,
    SnapGridPopover,
    SelectionToolbar,
  ],
  providers: [EditorStore],
  templateUrl: './editor.page.html',
  styleUrl: './editor.page.scss',
  host: {
    '(window:beforeunload)': 'warnIfUnsaved($event)',
    '(window:keydown)': 'handleUndoRedoKey($event)',
    '(window:keydown.escape)': 'endSwapOnEscape($event)',
  },
})
export class EditorPage {
  protected readonly store = inject(EditorStore);
  private readonly photoApi = inject(PhotoApi);
  private readonly connectorApi = inject(ConnectorApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly arrangementDialog = inject(ArrangementSettingsDialogService);
  private readonly notification = inject(NotificationService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly canvas = viewChild(EditorCanvas);

  /** Position of the selection toolbar in canvas area px; `null`: hidden (see `EditorCanvas`). */
  protected readonly toolbarAnchor = signal<Point | null>(null);

  /**
   * Id of the text whose "Edit text" popover the selection toolbar opens as soon as it shows the
   * text ("Add text", double-click); `null` if none. Cleared when the popover is open or another
   * element is selected.
   */
  protected readonly pendingTextEdit = signal<string | null>(null);

  protected readonly pageLabel = computed(() => {
    const settings = this.store.settings();
    return settings ? pageLabel(settings.page, settings.displayUnit) : '';
  });

  /** Display unit of the editor lengths with the collage DPI (input of the panels and dialogs). */
  protected readonly lengthUnit = computed<LengthUnit>(
    () => {
      const settings = this.store.settings();
      return { unit: settings?.displayUnit ?? 'mm', dpi: settings?.page.dpi ?? DEFAULT_DPI };
    },
    { equal: (a, b) => a.unit === b.unit && a.dpi === b.dpi },
  );

  /**
   * File URL of the bg photo for the Appearance thumbnail; `null` if no photo is set or the photo
   * is not in the collage (any more).
   */
  protected readonly backgroundImageUrl = computed(() => {
    const collage = this.store.collage();
    const photoId = this.store.settings()?.background.image.photoId ?? null;
    const exists = photoId !== null && this.store.photos().some((photo) => photo.id === photoId);
    return collage && exists ? photoFileUrl(collage.id, photoId) : null;
  });

  private readonly shortcuts = undoRedoShortcutLabels();
  protected readonly undoLabel = $localize`:@@editor.undo:Undo (${this.shortcuts.undo}:shortcut:)`;
  protected readonly redoLabel = $localize`:@@editor.redo:Redo (${this.shortcuts.redo}:shortcut:)`;
  protected readonly exportLabel = $localize`:@@editor.export.button:Export`;
  protected readonly addTextLabel = $localize`:@@editor.text.addButton:Add text`;
  protected readonly importLabel = $localize`:@@editor.importMenu.button:Import`;
  protected readonly snapGridLabel = $localize`:@@editor.snapGrid.button:Snap grid`;
  protected readonly uploadLabel = $localize`:@@editor.uploadButton:Upload from computer`;
  /** `accept` of the hidden file input. */
  protected readonly uploadAccept = UPLOAD_MIME_TYPES.join(',');

  /** Connectors of the user in the "Import" menu (reloaded on each open); `null` while loading. */
  protected readonly importConnectors = signal<readonly ConnectorSummary[] | null>(null);
  /** Error of the last connector load of the "Import" menu; `null` if none. */
  protected readonly importConnectorsError = signal<string | null>(null);
  protected readonly connectorTypeLabel = connectorTypeLabel;
  private importConnectorsLoad: Subscription | null = null;

  /** Progress of the running upload batch; `null` when no upload runs. */
  protected readonly uploadProgress = signal<Pick<UploadBatchState, 'done' | 'total'> | null>(null);
  protected readonly uploadProgressLabel = computed(() => {
    const progress = this.uploadProgress();
    if (!progress) {
      return '';
    }
    const { done, total } = progress;
    return $localize`:@@editor.upload.progress:Uploading ${done}:done: / ${total}:total:`;
  });

  /** The snap grid popover is open. */
  protected readonly snapGridOpen = signal(false);
  /** The committed snap grid is on (the toolbar button is highlighted). */
  protected readonly snapGridEnabled = computed(
    () => this.store.settings()?.snapGrid.enabled ?? false,
  );
  /** Below the button, right-aligned to it; left-aligned or above it if there is no space. */
  protected readonly snapGridPositions: ConnectedPosition[] = [
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top' },
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top' },
    { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom' },
  ];

  protected readonly isCenterMode = computed(() => this.store.settings()?.mode === 'center');

  /**
   * Photo the center arrangement puts in the middle (same rule as the arrangement): the configured
   * photo if it is still in the collage, else the first photo; `null` without photos.
   */
  private readonly centrePhotoId = computed(() =>
    resolveCentrePhotoId(this.store.photos(), this.store.settings()?.center.centerPhotoId ?? null),
  );

  protected readonly selectedIsCentrePhoto = computed(() => {
    const id = this.store.selectedPhotoId();
    return id !== null && id === this.centrePhotoId();
  });

  /** Tooltip of the "Set as centre" button: explains the disabled states. */
  protected readonly setCentreHint = computed(() => {
    if (this.store.selectedPhotoId() === null) {
      return $localize`:@@editor.setCentreSelectFirst:Select a photo on the page first`;
    }
    return this.selectedIsCentrePhoto()
      ? $localize`:@@editor.setCentreCurrent:This is the centre photo`
      : $localize`:@@editor.setCentreHint:Swap the selected photo with the centre photo`;
  });

  /**
   * Id of the source photo A of the swap mode (the selected photo when the mode started), or
   * `null`. Reset by the auto-end effect (see constructor), so the mode cannot come back.
   */
  private readonly swapSourceId = signal<number | null>(null);

  /** Swap mode is on: the source photo is still the selected, placed photo. */
  protected readonly swapping = computed(() => {
    const sourceId = this.swapSourceId();
    const photo = this.store.selectedPhoto();
    return sourceId !== null && photo?.id === sourceId && isPlaced(photo.props);
  });

  /** Number of photos on the page. */
  private readonly placedPhotoCount = computed(
    () => this.store.photos().filter((photo) => isPlaced(photo.props)).length,
  );

  private readonly selectedPhotoPlaced = computed(() => {
    const photo = this.store.selectedPhoto();
    return photo !== null && isPlaced(photo.props);
  });

  /** The Swap button can start the mode: a placed photo is selected and a second one exists. */
  protected readonly canSwap = computed(
    () => this.selectedPhotoPlaced() && this.placedPhotoCount() >= 2,
  );

  /** Tooltip of the Swap button: explains the disabled states and the active mode. */
  protected readonly swapHint = computed(() => {
    if (this.swapping()) {
      return $localize`:@@editor.swapActiveHint:Click the photo to swap with (Esc to cancel)`;
    }
    if (!this.selectedPhotoPlaced()) {
      return $localize`:@@editor.swapSelectFirst:Select a photo on the page first`;
    }
    if (this.placedPhotoCount() < 2) {
      return $localize`:@@editor.swapTooFewPhotos:At least two photos are needed`;
    }
    return $localize`:@@editor.swapHint:Swap the selected photo with another photo`;
  });

  constructor() {
    // A pending "Edit text" request ends when its text is no longer selected.
    effect(() => {
      const pending = this.pendingTextEdit();
      if (pending !== null && this.store.selectedText()?.id !== pending) {
        this.pendingTextEdit.set(null);
      }
    });
    // Auto-end of the swap mode: the selection is no longer the placed source photo (e.g. "Add
    // text", delete, undo/redo).
    effect(() => {
      if (this.swapSourceId() !== null && !this.swapping()) {
        this.swapSourceId.set(null);
      }
    });
    // The route has no child routes or links to other collages, so the id does not change while
    // the page is shown.
    void this.load(Number(this.route.snapshot.paramMap.get('id')));
  }

  /**
   * Loads the connectors of the "Import" menu each time it opens, so that changes in the connector
   * settings show without reload. A load that still runs is cancelled.
   */
  protected loadImportConnectors(): void {
    this.importConnectorsLoad?.unsubscribe();
    this.importConnectors.set(null);
    this.importConnectorsError.set(null);
    const subscription = this.connectorApi.list().subscribe({
      next: (connectors) => this.importConnectors.set(connectors),
      error: (err: unknown) => {
        const message = errorMessage(err);
        this.importConnectorsError.set(
          $localize`:@@editor.importMenu.loadError:Connectors could not be loaded: ${message}:error:`,
        );
      },
    });
    const removeDestroyHook = this.destroyRef.onDestroy(() => subscription.unsubscribe());
    subscription.add(removeDestroyHook);
    this.importConnectorsLoad = subscription;
  }

  /** Opens the import dialog of the connector's type for this connector. */
  protected openImport(connector: ConnectorSummary): void {
    switch (connector.type) {
      case 'immich':
        this.openImportDialog(ImportDialog, connector);
        break;
      case 'synology':
        this.openImportDialog(SynologyImportDialog, connector);
        break;
    }
  }

  protected openConnectorSettings(): void {
    void this.router.navigate(['/settings/connectors']);
  }

  /**
   * Opens an import dialog for `connector` (all take `ImportDialogData` and close with the
   * `ImportResult`); on success shows the result message and applies the new photos.
   */
  private openImportDialog(
    component: ComponentType<ImportDialog | SynologyImportDialog>,
    connector: ConnectorSummary,
  ): void {
    const collage = this.store.collage();
    if (!collage) {
      return;
    }
    const data: ImportDialogData = {
      connector,
      photos: this.store.photos(),
      importPhotos: (request) => firstValueFrom(this.photoApi.import(collage.id, request)),
    };
    const ref = this.dialog.open<
      ImportDialog | SynologyImportDialog,
      ImportDialogData,
      ImportResult
    >(component, {
      data,
      width: '960px',
      maxWidth: 'calc(100vw - 32px)',
    });
    ref.afterClosed().subscribe((result) => {
      if (result) {
        this.notification.success(importResultMessage(result));
        void this.store.applyImport(result);
      }
    });
  }

  /**
   * Uploads the files chosen in the file input (at most 3 at the same time). At the end: one
   * success snackbar and one `applyImport` for all new photos, one error snackbar for the failed
   * files. Leaving the page cancels open requests; then nothing is applied or shown.
   */
  protected uploadFiles(input: HTMLInputElement): void {
    const files = Array.from(input.files ?? []);
    // Reset, so that the same files can be chosen again.
    input.value = '';
    const collage = this.store.collage();
    if (!collage || files.length === 0 || this.uploadProgress() !== null) {
      return;
    }
    let last: UploadBatchState | null = null;
    // Unsubscribe (not complete) on destroy: cancels the requests, `complete` does not run.
    const subscription = new Subscription();
    const removeDestroyHook = this.destroyRef.onDestroy(() => subscription.unsubscribe());
    subscription.add(
      uploadBatch(files, (file) => this.photoApi.upload(collage.id, file)).subscribe({
        next: (state) => {
          last = state;
          this.uploadProgress.set({ done: state.done, total: state.total });
        },
        complete: () => {
          removeDestroyHook();
          this.uploadProgress.set(null);
          if (last) {
            this.finishUpload(last);
          }
        },
      }),
    );
  }

  /**
   * Shows the result and arranges the new photos. Only one snackbar is visible at a time, so with
   * failed files the error snackbar also holds the success text.
   */
  private finishUpload({ result, failures }: UploadBatchState): void {
    const hasResult = result.photos.length > 0 || result.skipped > 0;
    if (failures.length > 0) {
      const failed = uploadFailureMessage(failures);
      const imported = importResultMessage(result);
      this.notification.error(
        hasResult
          ? $localize`:@@editor.upload.partial:${imported}:imported:. ${failed}:failed:`
          : failed,
      );
    } else if (hasResult) {
      this.notification.success(importResultMessage(result));
    }
    // Does nothing for an empty photo list (e.g. only skipped files).
    void this.store.applyImport(result);
  }

  /** Opens the export dialog; it renders the committed layout and downloads the image. */
  protected openExport(): void {
    const collage = this.store.collage();
    const content = this.store.exportContent();
    if (!collage || !content) {
      return;
    }
    const data: ExportDialogData = {
      page: content.settings.page,
      runExport: async (options) => {
        const blob = await renderPageImage(content, options);
        downloadBlob(blob, exportFileName(collage.name, options.format));
      },
    };
    this.dialog.open<ExportDialog, ExportDialogData, boolean>(ExportDialog, {
      data,
      width: '400px',
      maxWidth: 'calc(100vw - 32px)',
    });
  }

  /**
   * Opens the arrangement settings dialog for `mode`; on "Re-arrange" saves the settings and
   * arranges all photos (one undo step).
   */
  protected async openArrangement(mode: ArrangementMode): Promise<void> {
    const settings = this.store.settings();
    if (!settings) {
      return;
    }
    const result = await this.arrangementDialog.open({
      mode,
      grid: settings.grid,
      center: settings.center,
      heap: settings.heap,
      masonry: settings.masonry,
      lengthUnit: this.lengthUnit(),
    });
    const current = this.store.settings();
    if (result && current) {
      this.store.rearrangeWith({ ...current, ...result });
    }
  }

  protected toggleSnapGrid(): void {
    this.snapGridOpen.update((open) => !open);
  }

  protected closeSnapGrid(): void {
    this.snapGridOpen.set(false);
  }

  /** Saves a snap grid change of the popover (one undo step). */
  protected updateSnapGrid(snapGrid: SnapGridSettings): void {
    const settings = this.store.settings();
    if (settings) {
      this.store.updateSettings({ ...settings, snapGrid });
    }
  }

  protected setSelectedAsCentre(): void {
    const id = this.store.selectedPhotoId();
    if (id !== null && !this.selectedIsCentrePhoto()) {
      this.store.setCenterPhoto(id);
    }
  }

  /** Starts the swap mode for the selected photo, or ends it. */
  protected toggleSwap(): void {
    if (this.swapping()) {
      this.swapSourceId.set(null);
    } else if (this.canSwap()) {
      this.swapSourceId.set(this.store.selectedPhotoId());
    }
  }

  /** Swap mode: the target photo was clicked; swaps it with the source photo and ends the mode. */
  protected swapWith(targetId: number): void {
    const sourceId = this.swapSourceId();
    if (sourceId !== null && this.swapping()) {
      this.store.swapPhotos(sourceId, targetId);
    }
    this.swapSourceId.set(null);
  }

  /**
   * Esc ends the swap mode; not while a dialog is open or when another element has already used
   * the key (e.g. the snap grid popover closes).
   */
  protected endSwapOnEscape(event: Event): void {
    if (!this.swapping() || event.defaultPrevented || this.dialog.openDialogs.length > 0) {
      return;
    }
    event.preventDefault();
    this.swapSourceId.set(null);
  }

  /** Crop button of the selection toolbar: same as a double-click on the photo. */
  protected startCropMode(photoId: number): void {
    this.canvas()?.startCropMode(photoId);
  }

  /** Adds a text and opens its "Edit text" popover with the focus in the text area. */
  protected addText(): void {
    this.pendingTextEdit.set(this.store.addText());
  }

  /** Double-click on a text: selects it and opens its "Edit text" popover (focus in the text). */
  protected editText(id: string): void {
    this.store.select({ kind: 'text', id });
    this.pendingTextEdit.set(id);
  }

  /** Undo/redo shortcuts; not while a dialog is open or a form field has the focus. */
  protected handleUndoRedoKey(event: KeyboardEvent): void {
    const command = undoRedoCommand(event);
    if (command === null || this.dialog.openDialogs.length > 0) {
      return;
    }
    event.preventDefault();
    if (command === 'undo') {
      this.store.undo();
    } else {
      this.store.redo();
    }
  }

  protected warnIfUnsaved(event: BeforeUnloadEvent): void {
    if (this.store.hasUnsavedChanges()) {
      event.preventDefault();
    }
  }

  private async load(id: number): Promise<void> {
    if ((await this.store.load(id)) === 'notFound') {
      this.notification.error($localize`:@@editor.notFound:Collage not found`);
      await this.router.navigate(['/collages']);
    }
  }
}
