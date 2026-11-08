import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { CollageApi } from '../../core/api/collage.api';
import { PhotoApi } from '../../core/api/photo.api';
import { CollageDetail, pageLabel } from '../../core/models/collage';
import { ImportResult, Photo } from '../../core/models/photo';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { errorMessage } from '../../shared/error-message';
import { NotificationService } from '../../shared/notification.service';
import { ImportDialog, ImportDialogData } from './import/import-dialog';
import { importResultMessage } from './import/import-result-message';
import { PhotoGrid } from './photo-grid';

/**
 * Editor of one collage. Until the canvas comes (step 6): name, page, import from Immich and a grid
 * of the photos with delete.
 */
@Component({
  selector: 'app-editor-page',
  imports: [RouterLink, MatButtonModule, MatIconModule, MatProgressSpinnerModule, PhotoGrid],
  templateUrl: './editor.page.html',
  styleUrl: './editor.page.scss',
})
export class EditorPage {
  private readonly api = inject(CollageApi);
  private readonly photoApi = inject(PhotoApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly confirm = inject(ConfirmService);
  private readonly notification = inject(NotificationService);

  protected readonly collage = signal<CollageDetail | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly pageLabel = computed(() => {
    const collage = this.collage();
    return collage ? pageLabel(collage.settings.page) : '';
  });

  constructor() {
    // The route has no child routes or links to other collages, so the id does not change while
    // the page is shown.
    void this.load(Number(this.route.snapshot.paramMap.get('id')));
  }

  protected openImport(): void {
    const collage = this.collage();
    if (!collage) {
      return;
    }
    const data: ImportDialogData = {
      photos: collage.photos,
      importPhotos: (request) => firstValueFrom(this.photoApi.import(collage.id, request)),
    };
    const ref = this.dialog.open<ImportDialog, ImportDialogData, ImportResult>(ImportDialog, {
      data,
      width: '960px',
      maxWidth: 'calc(100vw - 32px)',
    });
    ref.afterClosed().subscribe((result) => {
      if (result) {
        this.updatePhotos((photos) => [...photos, ...result.photos]);
        this.notification.success(importResultMessage(result));
      }
    });
  }

  protected async deletePhoto(photo: Photo): Promise<void> {
    const collage = this.collage();
    if (!collage) {
      return;
    }
    const confirmed = await this.confirm.confirm({
      title: $localize`:@@editor.deletePhoto.title:Delete photo?`,
      message: $localize`:@@editor.deletePhoto.message:The photo will be removed from the collage and its file deleted. This cannot be undone.`,
      confirmLabel: $localize`:@@editor.deletePhoto.confirm:Delete`,
      destructive: true,
    });
    if (!confirmed) {
      return;
    }
    try {
      await firstValueFrom(this.photoApi.deletePhoto(collage.id, photo.id));
      this.updatePhotos((photos) => photos.filter((p) => p.id !== photo.id));
      this.notification.success($localize`:@@editor.deletePhoto.done:Photo deleted`);
    } catch (err) {
      this.notification.error(errorMessage(err));
    }
  }

  private updatePhotos(change: (photos: Photo[]) => Photo[]): void {
    this.collage.update((collage) => collage && { ...collage, photos: change(collage.photos) });
  }

  private async load(id: number): Promise<void> {
    if (!Number.isInteger(id) || id <= 0) {
      await this.leaveNotFound();
      return;
    }
    try {
      this.collage.set(await firstValueFrom(this.api.get(id)));
    } catch (err) {
      if (err instanceof HttpErrorResponse && err.status === 404) {
        await this.leaveNotFound();
        return;
      }
      this.loadError.set(
        errorMessage(err, $localize`:@@editor.loadError:Could not load the collage.`),
      );
    }
  }

  private async leaveNotFound(): Promise<void> {
    this.notification.error($localize`:@@editor.notFound:Collage not found`);
    await this.router.navigate(['/collages']);
  }
}
