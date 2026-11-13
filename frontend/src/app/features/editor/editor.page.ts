import { CdkTrapFocus } from '@angular/cdk/a11y';
import { CdkConnectedOverlay, CdkOverlayOrigin, ConnectedPosition } from '@angular/cdk/overlay';
import {
  afterNextRender,
  Component,
  computed,
  effect,
  inject,
  Injector,
  signal,
  viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { PhotoApi } from '../../core/api/photo.api';
import { pageLabel, SnapGridSettings } from '../../core/models/collage';
import { ImportResult, isPlaced } from '../../core/models/photo';
import { NotificationService } from '../../shared/notification.service';
import { resolveCentrePhotoId } from './arrange/arrange';
import { EditorCanvas } from './canvas/editor-canvas';
import { renderPageImage } from './canvas/page-image-renderer';
import { EditorStore } from './editor.store';
import { downloadBlob, exportFileName } from './export/download';
import { ExportDialog, ExportDialogData } from './export/export-dialog';
import { ImportDialog, ImportDialogData } from './import/import-dialog';
import { importResultMessage } from './import/import-result-message';
import { PhotoPropertiesPanel } from './photo-panel/photo-properties-panel';
import { SaveStatusIndicator } from './save-status-indicator';
import { CollageSettingsPanel } from './settings-panel/collage-settings-panel';
import { SnapGridPopover } from './snap-grid/snap-grid-popover';
import { TextPropertiesPanel } from './text-panel/text-properties-panel';
import { undoRedoCommand, undoRedoShortcutLabels } from './undo-shortcut';

/**
 * Editor of one collage (container): toolbar, Konva canvas and side panel (selected photo or
 * text, collage settings). The state lives in the page-scoped `EditorStore`.
 */
@Component({
  selector: 'app-editor-page',
  imports: [
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    CdkOverlayOrigin,
    CdkConnectedOverlay,
    CdkTrapFocus,
    EditorCanvas,
    CollageSettingsPanel,
    PhotoPropertiesPanel,
    TextPropertiesPanel,
    SaveStatusIndicator,
    SnapGridPopover,
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
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly notification = inject(NotificationService);
  private readonly injector = inject(Injector);

  private readonly textPanel = viewChild(TextPropertiesPanel);

  protected readonly pageLabel = computed(() => {
    const settings = this.store.settings();
    return settings ? pageLabel(settings.page) : '';
  });

  private readonly shortcuts = undoRedoShortcutLabels();
  protected readonly undoLabel = $localize`:@@editor.undo:Undo (${this.shortcuts.undo}:shortcut:)`;
  protected readonly redoLabel = $localize`:@@editor.redo:Redo (${this.shortcuts.redo}:shortcut:)`;
  protected readonly setCentreLabel = $localize`:@@editor.setCentre:Set as centre`;
  protected readonly swapLabel = $localize`:@@editor.swap:Swap photos`;
  protected readonly exportLabel = $localize`:@@editor.export.button:Export`;
  protected readonly addTextLabel = $localize`:@@editor.text.addButton:Add text`;
  protected readonly importLabel = $localize`:@@editor.importButton:Import from Immich`;
  protected readonly snapGridLabel = $localize`:@@editor.snapGrid.button:Snap grid`;

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

  /** Label of the toolbar Delete button for the selected element. */
  protected readonly deleteLabel = computed(() =>
    this.store.selection()?.kind === 'text'
      ? $localize`:@@editor.text.delete:Delete text`
      : $localize`:@@editor.photo.delete:Delete photo`,
  );

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

  protected openImport(): void {
    const collage = this.store.collage();
    if (!collage) {
      return;
    }
    const data: ImportDialogData = {
      photos: this.store.photos(),
      importPhotos: (request) => firstValueFrom(this.photoApi.import(collage.id, request)),
    };
    const ref = this.dialog.open<ImportDialog, ImportDialogData, ImportResult>(ImportDialog, {
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

  /** Deletes the selected photo (after a confirm) or the selected text (no confirm). */
  protected deleteSelection(): void {
    const selection = this.store.selection();
    if (selection?.kind === 'photo') {
      void this.store.deletePhoto(selection.id);
    } else if (selection?.kind === 'text') {
      this.store.deleteText(selection.id);
    }
  }

  /** Adds a text and focuses its text in the panel. */
  protected addText(): void {
    this.store.addText();
    this.focusTextPanel();
  }

  /** Double-click on a text: selects it and focuses its text in the panel. */
  protected editText(id: string): void {
    this.store.select({ kind: 'text', id });
    this.focusTextPanel();
  }

  /** Focuses the text area of the text panel once it shows the selected text. */
  private focusTextPanel(): void {
    afterNextRender(() => this.textPanel()?.focusText(), { injector: this.injector });
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
