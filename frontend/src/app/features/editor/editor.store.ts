import { HttpErrorResponse } from '@angular/common/http';
import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { CollageApi } from '../../core/api/collage.api';
import { PhotoApi } from '../../core/api/photo.api';
import { CollageSettings, normalizeSettings } from '../../core/models/collage';
import { SaveLayoutRequest } from '../../core/models/layout';
import { ImportResult, isPlaced, Photo } from '../../core/models/photo';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { errorMessage } from '../../shared/error-message';
import { NotificationService } from '../../shared/notification.service';
import { arrangePhotos, FrameMap, placeBesidePage } from './arrange/arrange';
import { AutoSaver } from './auto-saver';

/** Identity of the edited collage. */
export interface EditorCollage {
  id: number;
  name: string;
}

/** Result of `EditorStore.load`. */
export type EditorLoadResult = 'loaded' | 'notFound' | 'failed';

/** Width of new photos placed beside the page, as a part of the page width. */
const BESIDE_PAGE_WIDTH_RATIO = 0.25;

/**
 * State of the editor of one collage (provided by the editor page, lives as long as the page).
 * Holds settings and photos in signals; every committed change is saved by the auto-save (full
 * layout). Arrangements overwrite all frames; they ask first if the current layout may contain
 * work of the user (see `layoutIsArrangement`).
 */
@Injectable()
export class EditorStore {
  private readonly collageApi = inject(CollageApi);
  private readonly photoApi = inject(PhotoApi);
  private readonly confirm = inject(ConfirmService);
  private readonly notification = inject(NotificationService);

  private readonly collageSignal = signal<EditorCollage | null>(null);
  private readonly settingsSignal = signal<CollageSettings | null>(null);
  private readonly photosSignal = signal<readonly Photo[]>([]);
  private readonly selectedPhotoIdSignal = signal<number | null>(null);
  private readonly loadErrorSignal = signal<string | null>(null);

  /** `null` until loaded. */
  readonly collage = this.collageSignal.asReadonly();
  /** `null` until loaded. */
  readonly settings = this.settingsSignal.asReadonly();
  /** Photos in import order (id ascending). */
  readonly photos = this.photosSignal.asReadonly();
  readonly selectedPhotoId = this.selectedPhotoIdSignal.asReadonly();
  /** Error text if loading failed for another reason than "not found". */
  readonly loadError = this.loadErrorSignal.asReadonly();

  private readonly autoSaver = new AutoSaver(
    () => this.saveLayout(),
    (err) =>
      this.notification.error(
        errorMessage(err, $localize`:@@editor.save.error:The changes could not be saved.`),
      ),
  );
  readonly saveStatus = this.autoSaver.status;
  /** True while changes are not saved yet (pending, saving or failed). */
  readonly hasUnsavedChanges = computed(() => this.saveStatus() !== 'saved');

  /**
   * True if the frames are the result of an arrangement in this editor session, so a new
   * arrangement loses no work of the user. False after loading (the stored layout may contain
   * manual changes) and after a manual change.
   */
  private layoutIsArrangement = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => void this.autoSaver.flush());
  }

  /** Loads the collage. Must be called once, before any other method. */
  async load(id: number): Promise<EditorLoadResult> {
    if (!Number.isInteger(id) || id <= 0) {
      return 'notFound';
    }
    try {
      const detail = await firstValueFrom(this.collageApi.get(id));
      this.collageSignal.set({ id: detail.id, name: detail.name });
      this.settingsSignal.set(normalizeSettings(detail.settings));
      this.photosSignal.set(detail.photos);
      return 'loaded';
    } catch (err) {
      if (err instanceof HttpErrorResponse && err.status === 404) {
        return 'notFound';
      }
      this.loadErrorSignal.set(
        errorMessage(err, $localize`:@@editor.loadError:Could not load the collage.`),
      );
      return 'failed';
    }
  }

  /** Replaces the collage settings (does not re-arrange). */
  updateSettings(settings: CollageSettings): void {
    this.settingsSignal.set(settings);
    this.commit();
  }

  selectPhoto(id: number | null): void {
    this.selectedPhotoIdSignal.set(id);
  }

  /**
   * Hook for manual edits of frames (step 8): after it, the next arrangement asks before it
   * overwrites the layout.
   */
  markManualChange(): void {
    this.layoutIsArrangement = false;
  }

  /** Arranges all photos with the current settings; asks first if work could be lost. */
  async rearrange(): Promise<void> {
    if (this.photosSignal().length === 0 || !(await this.confirmRearrange())) {
      return;
    }
    this.arrangeAll();
  }

  /**
   * Adds imported photos and arranges all photos. If the current layout may contain work of the
   * user and the user does not want to re-arrange, only the new photos are placed beside the page.
   */
  async applyImport(result: ImportResult): Promise<void> {
    if (result.photos.length === 0) {
      return;
    }
    const mustAsk = this.mustConfirmRearrange();
    this.photosSignal.update((photos) => [...photos, ...result.photos]);
    if (!mustAsk || (await this.confirmRearrangeAfterImport())) {
      this.arrangeAll();
      return;
    }
    this.placeBesidePage(result.photos);
  }

  /** Makes the photo the centre photo of the `center` mode and re-arranges (with the confirm rule). */
  async setCenterPhoto(id: number): Promise<void> {
    const settings = this.requireSettings();
    this.updateSettings({ ...settings, center: { ...settings.center, centerPhotoId: id } });
    await this.rearrange();
  }

  /** Deletes the photo and its file after a confirm dialog. The layout of the others stays. */
  async deletePhoto(id: number): Promise<void> {
    const confirmed = await this.confirm.confirm({
      title: $localize`:@@editor.deletePhoto.title:Delete photo?`,
      message: $localize`:@@editor.deletePhoto.message:The photo will be removed from the collage and its file deleted. This cannot be undone.`,
      confirmLabel: $localize`:@@editor.deletePhoto.confirm:Delete`,
      destructive: true,
    });
    if (!confirmed) {
      return;
    }
    // A running or pending save still lists the photo; the server rejects it after the delete.
    await this.autoSaver.flush();
    try {
      await firstValueFrom(this.photoApi.deletePhoto(this.requireCollage().id, id));
    } catch (err) {
      this.notification.error(errorMessage(err));
      return;
    }
    this.photosSignal.update((photos) => photos.filter((p) => p.id !== id));
    if (this.selectedPhotoIdSignal() === id) {
      this.selectedPhotoIdSignal.set(null);
    }
    const settings = this.requireSettings();
    if (settings.center.centerPhotoId === id) {
      this.updateSettings({ ...settings, center: { ...settings.center, centerPhotoId: null } });
    }
    this.notification.success($localize`:@@editor.deletePhoto.done:Photo deleted`);
  }

  private arrangeAll(): void {
    this.applyFrames(arrangePhotos(this.photosSignal(), this.requireSettings()));
    this.layoutIsArrangement = true;
  }

  private placeBesidePage(photos: readonly Photo[]): void {
    const page = this.requireSettings().page;
    const zStart = this.maxZ() + 1;
    this.applyFrames(placeBesidePage(photos, page, page.widthMm * BESIDE_PAGE_WIDTH_RATIO, zStart));
    this.layoutIsArrangement = false;
  }

  private applyFrames(frames: FrameMap): void {
    this.photosSignal.update((photos) =>
      photos.map((photo) => {
        const props = frames.get(photo.id);
        return props ? { ...photo, props } : photo;
      }),
    );
    this.commit();
  }

  /** Highest `z` of the placed photos; -1 if none is placed. */
  private maxZ(): number {
    return this.photosSignal().reduce(
      (max, photo) => (isPlaced(photo.props) ? Math.max(max, photo.props.z) : max),
      -1,
    );
  }

  private mustConfirmRearrange(): boolean {
    return !this.layoutIsArrangement && this.photosSignal().some((p) => isPlaced(p.props));
  }

  private async confirmRearrange(): Promise<boolean> {
    return (
      !this.mustConfirmRearrange() ||
      this.confirm.confirm({
        title: $localize`:@@editor.rearrange.title:Re-arrange photos?`,
        message: $localize`:@@editor.rearrange.message:All photos get new positions and sizes. Changes to the current layout are lost.`,
        confirmLabel: $localize`:@@editor.rearrange.confirm:Re-arrange`,
      })
    );
  }

  private confirmRearrangeAfterImport(): Promise<boolean> {
    return this.confirm.confirm({
      title: $localize`:@@editor.rearrangeAfterImport.title:Re-arrange all photos?`,
      message: $localize`:@@editor.rearrangeAfterImport.message:Re-arrange gives all photos new positions and sizes. Changes to the current layout are lost. Keep layout puts the new photos beside the page.`,
      confirmLabel: $localize`:@@editor.rearrange.confirm:Re-arrange`,
      cancelLabel: $localize`:@@editor.rearrangeAfterImport.keep:Keep layout`,
    });
  }

  /** Marks a committed change (saved by the auto-save). */
  private commit(): void {
    this.autoSaver.schedule();
  }

  private async saveLayout(): Promise<void> {
    const request: SaveLayoutRequest = {
      settings: this.requireSettings(),
      photos: this.photosSignal().map(({ id, props }) => ({ id, props })),
    };
    await firstValueFrom(this.collageApi.saveLayout(this.requireCollage().id, request));
  }

  private requireCollage(): EditorCollage {
    const collage = this.collageSignal();
    if (!collage) {
      throw new Error('EditorStore: collage not loaded');
    }
    return collage;
  }

  private requireSettings(): CollageSettings {
    const settings = this.settingsSignal();
    if (!settings) {
      throw new Error('EditorStore: collage not loaded');
    }
    return settings;
  }
}
