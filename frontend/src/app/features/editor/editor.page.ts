import { Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { PhotoApi } from '../../core/api/photo.api';
import { pageLabel } from '../../core/models/collage';
import { ImportResult } from '../../core/models/photo';
import { NotificationService } from '../../shared/notification.service';
import { resolveCentrePhotoId } from './arrange/arrange';
import { EditorCanvas } from './canvas/editor-canvas';
import { EditorStore } from './editor.store';
import { ImportDialog, ImportDialogData } from './import/import-dialog';
import { importResultMessage } from './import/import-result-message';
import { SaveStatusIndicator } from './save-status-indicator';
import { CollageSettingsPanel } from './settings-panel/collage-settings-panel';

/**
 * Editor of one collage (container): toolbar, Konva canvas and settings panel. The state lives in
 * the page-scoped `EditorStore`.
 */
@Component({
  selector: 'app-editor-page',
  imports: [
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    EditorCanvas,
    CollageSettingsPanel,
    SaveStatusIndicator,
  ],
  providers: [EditorStore],
  templateUrl: './editor.page.html',
  styleUrl: './editor.page.scss',
  host: { '(window:beforeunload)': 'warnIfUnsaved($event)' },
})
export class EditorPage {
  protected readonly store = inject(EditorStore);
  private readonly photoApi = inject(PhotoApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly notification = inject(NotificationService);

  protected readonly pageLabel = computed(() => {
    const settings = this.store.settings();
    return settings ? pageLabel(settings.page) : '';
  });

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
      : $localize`:@@editor.setCentreHint:Put the selected photo in the centre and re-arrange the others`;
  });

  constructor() {
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

  protected setSelectedAsCentre(): void {
    const id = this.store.selectedPhotoId();
    if (id !== null && !this.selectedIsCentrePhoto()) {
      void this.store.setCenterPhoto(id);
    }
  }

  protected deleteSelectedPhoto(): void {
    const id = this.store.selectedPhotoId();
    if (id !== null) {
      void this.store.deletePhoto(id);
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
