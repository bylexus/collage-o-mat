import { HttpErrorResponse } from '@angular/common/http';
import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { CollageApi } from '../../core/api/collage.api';
import { PhotoApi } from '../../core/api/photo.api';
import { CollageSettings, normalizeSettings } from '../../core/models/collage';
import { SaveLayoutRequest } from '../../core/models/layout';
import { ImportResult, isPlaced, Photo, PhotoBorder, PhotoProps } from '../../core/models/photo';
import { CollageText, TextProps } from '../../core/models/text';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { errorMessage } from '../../shared/error-message';
import { NotificationService } from '../../shared/notification.service';
import { arrangePhotos, FrameMap, placeBesidePage, resolveCentrePhotoId } from './arrange/arrange';
import { AutoSaver } from './auto-saver';
import { ExportContent } from './export/page-export';
import { LayoutSnapshot, restoreSnapshot, takeSnapshot } from './layout-snapshot';
import { hasBorderOverride, inheritedBorder, sameBorder } from './photo-border';
import { EditorSelection, sameSelection, selectedPhotoIdOf, selectedTextIdOf } from './selection';
import { swapFrames } from './swap-frames';
import { isBlankText, newTextProps, sameTextProps } from './text-props';
import { UndoHistory } from './undo-history';
import { backZ, frontZ, nextFrontZ } from './z-order';

/** Identity of the edited collage. */
export interface EditorCollage {
  id: number;
  name: string;
}

/** Result of `EditorStore.load`. */
export type EditorLoadResult = 'loaded' | 'notFound' | 'failed';

/** A border shown on the canvas before it is committed (colour picker open). */
interface BorderPreview {
  photoId: number;
  border: PhotoBorder;
}

/** Default text of a new overlay text. */
const NEW_TEXT = $localize`:@@editor.text.defaultText:Text`;

/** New z of an element from its z and the z of all other elements; `null` = no change. */
type RestackRule = (z: number, others: readonly number[]) => number | null;

/**
 * State of the editor of one collage (provided by the editor page, lives as long as the page).
 * Holds settings, photos, overlay texts and the selection in signals. Every committed change goes
 * through `commit()`: it is recorded for undo/redo and saved by the auto-save (full layout).
 * Arrangements overwrite all photo frames (texts stay); they ask first if the current layout may
 * contain work of the user (see `layoutIsArrangement`). Deleting a photo is not undoable (the file
 * is deleted at once); adding and deleting texts is.
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
  private readonly textsSignal = signal<readonly CollageText[]>([]);
  private readonly selectionSignal = signal<EditorSelection>(null);
  private readonly loadErrorSignal = signal<string | null>(null);
  private readonly borderPreviewSignal = signal<BorderPreview | null>(null);
  /** Text shown on the canvas before it is committed (panel edit in progress). */
  private readonly textPreviewSignal = signal<CollageText | null>(null);
  /** Settings shown on the canvas before they are committed (colour picker open). */
  private readonly settingsPreviewSignal = signal<CollageSettings | null>(null);

  /** `null` until loaded. */
  readonly collage = this.collageSignal.asReadonly();
  /** `null` until loaded. */
  readonly settings = this.settingsSignal.asReadonly();
  /**
   * Settings as the canvas draws them: the settings preview if there is one, else `settings`. Not
   * saved and not part of the undo history.
   */
  readonly displayedSettings = computed(
    () => this.settingsPreviewSignal() ?? this.settingsSignal(),
  );
  /** Photos in import order (id ascending). */
  readonly photos = this.photosSignal.asReadonly();
  /** Overlay texts (any order; drawn by `props.z`). */
  readonly texts = this.textsSignal.asReadonly();
  /** The selected element (photo, text or nothing). */
  readonly selection = this.selectionSignal.asReadonly();
  /** Id of the selected photo; `null` if no photo is selected. */
  readonly selectedPhotoId = computed(() => selectedPhotoIdOf(this.selectionSignal()));
  /**
   * Photos as the canvas draws them: `photos` with the border preview applied. Not saved and not
   * part of the undo history.
   */
  readonly displayedPhotos = computed(() =>
    withBorderPreview(this.photosSignal(), this.borderPreviewSignal()),
  );
  /**
   * Texts as the canvas draws them: `texts` with the text preview applied. Not saved and not
   * part of the undo history.
   */
  readonly displayedTexts = computed(() =>
    withTextPreview(this.textsSignal(), this.textPreviewSignal()),
  );
  /** The selected photo; `null` if no photo is selected. */
  readonly selectedPhoto = computed(
    () => this.photosSignal().find((photo) => photo.id === this.selectedPhotoId()) ?? null,
  );
  /** The selected text with its committed props; `null` if no text is selected. */
  readonly selectedText = computed(() => {
    const id = selectedTextIdOf(this.selectionSignal());
    return id === null ? null : (this.textsSignal().find((text) => text.id === id) ?? null);
  });
  /** True if at least one placed photo has an own border (not the collage default). */
  readonly hasBorderOverrides = computed(() =>
    this.photosSignal().some(
      (photo) => isPlaced(photo.props) && hasBorderOverride(photo.props.border),
    ),
  );
  /** Error text if loading failed for another reason than "not found". */
  readonly loadError = this.loadErrorSignal.asReadonly();
  /**
   * What an export renders: the committed layout (no previews, no selection); `null` until the
   * collage is loaded.
   */
  readonly exportContent = computed<ExportContent | null>(() => {
    const collage = this.collageSignal();
    const settings = this.settingsSignal();
    if (!collage || !settings) {
      return null;
    }
    return {
      collageId: collage.id,
      settings,
      photos: this.photosSignal(),
      texts: this.textsSignal(),
    };
  });

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

  private readonly history = new UndoHistory<LayoutSnapshot>();
  readonly canUndo = this.history.canUndo;
  readonly canRedo = this.history.canRedo;

  /**
   * True if the frames are the result of an arrangement in this editor session, so a new
   * arrangement loses no work of the user. False after loading (the stored layout may contain
   * manual changes), after a manual change and after undo/redo.
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
      this.textsSignal.set(detail.texts ?? []);
      this.history.reset(this.snapshot());
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

  /**
   * Shows settings on the canvas without committing them (colour picker open). The next commit,
   * undo/redo or selection change removes the preview.
   */
  previewSettings(settings: CollageSettings): void {
    this.settingsPreviewSignal.set(settings);
  }

  /** Replaces the collage settings (does not re-arrange). */
  updateSettings(settings: CollageSettings): void {
    this.settingsSignal.set(settings);
    this.commit();
  }

  /** Selects an element (or nothing); a changed selection removes the previews. */
  select(selection: EditorSelection): void {
    if (sameSelection(selection, this.selectionSignal())) {
      return;
    }
    this.clearPreviews();
    this.selectionSignal.set(selection);
  }

  /**
   * Marks a manual edit of the frames: after it, the next arrangement asks before it overwrites
   * the layout.
   */
  markManualChange(): void {
    this.layoutIsArrangement = false;
  }

  /** Replaces the props of a placed photo (a committed move, rotation, resize or crop). */
  updatePhotoProps(id: number, props: PhotoProps): void {
    this.editPlacedPhoto(id, () => props);
  }

  /**
   * Shows a border on the canvas without committing it (colour picker open). The next commit,
   * undo/redo or selection change removes the preview.
   */
  previewPhotoBorder(id: number, border: PhotoBorder): void {
    this.borderPreviewSignal.set({ photoId: id, border });
  }

  /** Sets the border of a placed photo; `null` values use the collage default border. */
  setPhotoBorder(id: number, border: PhotoBorder): void {
    this.borderPreviewSignal.set(null);
    this.editPlacedPhoto(id, (props) =>
      sameBorder(props.border, border) ? null : { ...props, border },
    );
  }

  /** "Apply to all photos": all placed photos use the collage default border again. */
  applyDefaultBorderToAll(): void {
    if (!this.hasBorderOverrides()) {
      return;
    }
    this.photosSignal.update((photos) =>
      photos.map((photo) =>
        isPlaced(photo.props) && hasBorderOverride(photo.props.border)
          ? { ...photo, props: { ...photo.props, border: inheritedBorder() } }
          : photo,
      ),
    );
    this.commit();
  }

  /** Puts a placed photo in front of all other elements. */
  bringToFront(id: number): void {
    this.restackPhoto(id, frontZ);
  }

  /** Puts a placed photo behind all other elements. */
  sendToBack(id: number): void {
    this.restackPhoto(id, backZ);
  }

  /**
   * Adds a text with the default props (see `newTextProps`) in front of all elements and selects
   * it. One undo step. Returns the id of the new text.
   */
  addText(): string {
    const id = crypto.randomUUID();
    const props = newTextProps(NEW_TEXT, this.requireSettings().page, nextFrontZ(this.zValues()));
    this.textsSignal.update((texts) => [...texts, { id, props }]);
    this.select({ kind: 'text', id });
    this.commit();
    return id;
  }

  /**
   * Shows text props on the canvas without committing them (panel edit in progress). The next
   * commit, undo/redo or selection change removes the preview.
   */
  previewText(id: string, props: TextProps): void {
    this.textPreviewSignal.set({ id, props });
  }

  /**
   * Replaces the props of a text (committed panel edit, move, rotation or width change). A text
   * without visible characters is deleted instead. Not a manual change of the frames (an
   * arrangement does not touch texts).
   */
  updateTextProps(id: string, props: TextProps): void {
    this.textPreviewSignal.set(null);
    if (isBlankText(props)) {
      this.deleteText(id);
      return;
    }
    this.editText(id, (current) => (sameTextProps(current, props) ? null : props));
  }

  /** Deletes a text (no confirm; one undo step). */
  deleteText(id: string): void {
    if (!this.textsSignal().some((text) => text.id === id)) {
      return;
    }
    this.textsSignal.update((texts) => texts.filter((text) => text.id !== id));
    if (selectedTextIdOf(this.selectionSignal()) === id) {
      this.selectionSignal.set(null);
    }
    this.commit();
  }

  /** Puts a text in front of all other elements. */
  bringTextToFront(id: string): void {
    this.restackText(id, frontZ);
  }

  /** Puts a text behind all other elements. */
  sendTextToBack(id: string): void {
    this.restackText(id, backZ);
  }

  /** Shows the layout before the last committed change (deleted photos stay deleted). */
  undo(): void {
    if (this.canUndo()) {
      this.restore(this.history.undo());
    }
  }

  /** Shows the layout again that the last undo removed. */
  redo(): void {
    if (this.canRedo()) {
      this.restore(this.history.redo());
    }
  }

  /** Arranges all photos with the current settings; asks first if work could be lost. */
  async rearrange(): Promise<void> {
    if (this.photosSignal().length === 0 || !(await this.confirmRearrange())) {
      return;
    }
    this.arrangeAll();
    this.commit();
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
    } else {
      this.placeBesidePage(result.photos);
    }
    this.commit();
  }

  /**
   * Makes the photo the centre photo of the `center` mode: it swaps its frame with the current
   * centre photo (see `swapFrames`); all other photos stay. If one of the two photos is not placed,
   * only the setting changes. No re-arrange, no confirm. One undo step.
   */
  setCenterPhoto(id: number): void {
    const settings = this.requireSettings();
    const photos = this.photosSignal();
    const currentId = resolveCentrePhotoId(photos, settings.center.centerPhotoId);
    if (currentId === id) {
      return;
    }
    if (currentId !== null) {
      this.swapPlacedFrames(id, currentId);
    }
    this.settingsSignal.set({ ...settings, center: { ...settings.center, centerPhotoId: id } });
    this.commit();
  }

  /**
   * Makes the photo the bg photo: background type `image` with this photo (the photo stays on the
   * page). No change if it already is. One undo step.
   */
  useAsBackground(photoId: number): void {
    const settings = this.requireSettings();
    const { background } = settings;
    if (background.type === 'image' && background.image.photoId === photoId) {
      return;
    }
    this.updateSettings({
      ...settings,
      background: { ...background, type: 'image', image: { ...background.image, photoId } },
    });
  }

  /**
   * Swaps the places of two placed photos (see `swapFrames`); all other photos stay. If one of
   * them is the centre photo, the other one becomes the centre photo. Unknown, not placed and
   * equal photos change nothing. The selection stays. One undo step.
   */
  swapPhotos(aId: number, bId: number): void {
    const settings = this.requireSettings();
    const photos = this.photosSignal();
    const centreId = resolveCentrePhotoId(photos, settings.center.centerPhotoId);
    if (aId === bId || !this.swapPlacedFrames(aId, bId)) {
      return;
    }
    if (centreId === aId || centreId === bId) {
      const centerPhotoId = centreId === aId ? bId : aId;
      this.settingsSignal.set({ ...settings, center: { ...settings.center, centerPhotoId } });
    }
    this.markManualChange();
    this.commit();
  }

  /**
   * Deletes the photo and its file after a confirm dialog. The layout of the others stays. Not
   * undoable, and the undo history stays (undo/redo skip deleted photos).
   */
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
    if (this.selectedPhotoId() === id) {
      this.selectionSignal.set(null);
    }
    const settings = this.requireSettings();
    const resetSettings = withoutDeletedPhoto(settings, id);
    if (resetSettings !== settings) {
      // Part of the delete, so no undo step: only saved.
      this.settingsSignal.set(resetSettings);
      this.autoSaver.schedule();
    }
    this.notification.success($localize`:@@editor.deletePhoto.done:Photo deleted`);
  }

  /**
   * Replaces the props of a placed photo with `edit(props)` and commits it as a manual change
   * (an arrangement would overwrite it). Unknown and not placed photos, and `edit` returning
   * `null`, change nothing.
   */
  private editPlacedPhoto(id: number, edit: (props: PhotoProps) => PhotoProps | null): void {
    const photo = this.photosSignal().find((p) => p.id === id);
    const props = photo && isPlaced(photo.props) ? edit(photo.props) : null;
    if (!props) {
      return;
    }
    this.photosSignal.update((photos) => photos.map((p) => (p.id === id ? { ...p, props } : p)));
    this.markManualChange();
    this.commit();
  }

  /**
   * Replaces the props of a text with `edit(props)` and commits it. Unknown texts and `edit`
   * returning `null` change nothing.
   */
  private editText(id: string, edit: (props: TextProps) => TextProps | null): void {
    const text = this.textsSignal().find((t) => t.id === id);
    const props = text ? edit(text.props) : null;
    if (!props) {
      return;
    }
    this.textsSignal.update((texts) => texts.map((t) => (t.id === id ? { ...t, props } : t)));
    this.commit();
  }

  /** Gives a placed photo the z computed by `rule` from its z and the z of all other elements. */
  private restackPhoto(id: number, rule: RestackRule): void {
    this.editPlacedPhoto(id, (props) => {
      const z = rule(props.z, this.zValues({ kind: 'photo', id }));
      return z === null ? null : { ...props, z };
    });
  }

  /** Gives a text the z computed by `rule` from its z and the z of all other elements. */
  private restackText(id: string, rule: RestackRule): void {
    this.editText(id, (props) => {
      const z = rule(props.z, this.zValues({ kind: 'text', id }));
      return z === null ? null : { ...props, z };
    });
  }

  /**
   * z values of all elements on the page (placed photos and texts share one z scale), optionally
   * without one element. The one place that collects z values.
   */
  private zValues(except: EditorSelection = null): number[] {
    const photoZs = this.photosSignal().flatMap((photo) =>
      isPlaced(photo.props) && !sameSelection(except, { kind: 'photo', id: photo.id })
        ? [photo.props.z]
        : [],
    );
    const textZs = this.textsSignal().flatMap((text) =>
      sameSelection(except, { kind: 'text', id: text.id }) ? [] : [text.props.z],
    );
    return [...photoZs, ...textZs];
  }

  private arrangeAll(): void {
    this.applyFrames(arrangePhotos(this.photosSignal(), this.requireSettings()));
    this.layoutIsArrangement = true;
  }

  private placeBesidePage(photos: readonly Photo[]): void {
    const page = this.requireSettings().page;
    this.applyFrames(placeBesidePage(photos, page, nextFrontZ(this.zValues())));
    this.layoutIsArrangement = false;
  }

  /**
   * Swaps the frames of two placed photos (see `swapFrames`, not committed). Returns `false` and
   * changes nothing if one of them is unknown or not placed.
   */
  private swapPlacedFrames(aId: number, bId: number): boolean {
    const photos = this.photosSignal();
    const a = photos.find((p) => p.id === aId);
    const b = photos.find((p) => p.id === bId);
    if (!a || !b || !isPlaced(a.props) || !isPlaced(b.props)) {
      return false;
    }
    const [aProps, bProps] = swapFrames({ props: a.props, image: a }, { props: b.props, image: b });
    this.applyFrames(
      new Map([
        [a.id, aProps],
        [b.id, bProps],
      ]),
    );
    return true;
  }

  /** Sets the props of the photos in `frames` (not committed). */
  private applyFrames(frames: FrameMap): void {
    this.photosSignal.update((photos) =>
      photos.map((photo) => {
        const props = frames.get(photo.id);
        return props ? { ...photo, props } : photo;
      }),
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

  /**
   * The single path of a committed change: records the new layout for undo/redo and saves it
   * with the auto-save.
   */
  private commit(): void {
    this.clearPreviews();
    this.history.push(this.snapshot());
    this.autoSaver.schedule();
  }

  /** Shows a layout from the history and saves it (no new undo step). */
  private restore(snapshot: LayoutSnapshot | null): void {
    if (!snapshot) {
      return;
    }
    this.clearPreviews();
    const { settings, photos, texts } = restoreSnapshot(snapshot, this.photosSignal());
    this.settingsSignal.set(settings);
    this.photosSignal.set(photos);
    this.textsSignal.set(texts);
    const selectedTextId = selectedTextIdOf(this.selectionSignal());
    if (selectedTextId !== null && !texts.some((text) => text.id === selectedTextId)) {
      this.selectionSignal.set(null);
    }
    // The restored layout can contain manual changes.
    this.layoutIsArrangement = false;
    this.autoSaver.schedule();
  }

  private snapshot(): LayoutSnapshot {
    return takeSnapshot(this.requireSettings(), this.photosSignal(), this.textsSignal());
  }

  /** Removes the settings, border and text previews (the canvas shows the committed state again). */
  private clearPreviews(): void {
    this.settingsPreviewSignal.set(null);
    this.borderPreviewSignal.set(null);
    this.textPreviewSignal.set(null);
  }

  private async saveLayout(): Promise<void> {
    const request: SaveLayoutRequest = {
      settings: this.requireSettings(),
      photos: this.photosSignal().map(({ id, props }) => ({ id, props })),
      texts: this.textsSignal().map(({ id, props }) => ({ id, props })),
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

/** The photos with the border of the preview photo replaced (same array without a preview). */
function withBorderPreview(
  photos: readonly Photo[],
  preview: BorderPreview | null,
): readonly Photo[] {
  if (!preview) {
    return photos;
  }
  return photos.map((photo) =>
    photo.id === preview.photoId && isPlaced(photo.props)
      ? { ...photo, props: { ...photo.props, border: preview.border } }
      : photo,
  );
}

/** The texts with the props of the preview text replaced (same array without a preview). */
function withTextPreview(
  texts: readonly CollageText[],
  preview: CollageText | null,
): readonly CollageText[] {
  if (!preview) {
    return texts;
  }
  return texts.map((text) => (text.id === preview.id ? { ...text, props: preview.props } : text));
}

/**
 * The settings without references to a deleted photo: the centre photo and the bg photo become
 * `null` if they are that photo. Returns `settings` itself if nothing refers to it.
 */
function withoutDeletedPhoto(settings: CollageSettings, photoId: number): CollageSettings {
  const { center, background } = settings;
  const isCentre = center.centerPhotoId === photoId;
  const isBackground = background.image.photoId === photoId;
  if (!isCentre && !isBackground) {
    return settings;
  }
  return {
    ...settings,
    center: isCentre ? { ...center, centerPhotoId: null } : center,
    background: isBackground
      ? { ...background, image: { ...background.image, photoId: null } }
      : background,
  };
}
