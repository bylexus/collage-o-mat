// Undo/redo snapshots of the editable layout of a collage. Pure functions: no Angular, no DOM.
import type { CollageSettings } from '../../core/models/collage';
import type { Photo } from '../../core/models/photo';

/** Props of one photo (placed or not placed yet). */
type PhotoPropsValue = Photo['props'];

/**
 * The editable layout at one point in time: collage settings and the props of each photo by id.
 * Shares the settings and props objects with the editor state, so these objects must never be
 * changed in place (the editor always replaces them with new objects).
 */
export interface LayoutSnapshot {
  readonly settings: CollageSettings;
  readonly props: ReadonlyMap<number, PhotoPropsValue>;
}

/** Layout to show after an undo/redo (see `restoreSnapshot`). */
export interface RestoredLayout {
  readonly settings: CollageSettings;
  readonly photos: readonly Photo[];
}

/** Snapshot of the current settings and photo props. */
export function takeSnapshot(settings: CollageSettings, photos: readonly Photo[]): LayoutSnapshot {
  return { settings, props: new Map(photos.map((photo) => [photo.id, photo.props])) };
}

/**
 * Applies a snapshot to the current photos:
 * - the settings of the snapshot; a centre photo that was deleted since becomes `null`;
 * - the props of the snapshot for each current photo that is in it; photos deleted since are
 *   skipped (not restored), photos not in the snapshot (imported later) keep their props.
 *
 * Photos whose props do not change keep their object; the photo order stays.
 */
export function restoreSnapshot(
  snapshot: LayoutSnapshot,
  photos: readonly Photo[],
): RestoredLayout {
  return {
    settings: withoutDeletedCentrePhoto(snapshot.settings, photos),
    photos: photos.map((photo) => {
      const props = snapshot.props.get(photo.id);
      return props === undefined || props === photo.props ? photo : { ...photo, props };
    }),
  };
}

function withoutDeletedCentrePhoto(
  settings: CollageSettings,
  photos: readonly Photo[],
): CollageSettings {
  const centerPhotoId = settings.center.centerPhotoId;
  if (centerPhotoId === null || photos.some((photo) => photo.id === centerPhotoId)) {
    return settings;
  }
  return { ...settings, center: { ...settings.center, centerPhotoId: null } };
}
