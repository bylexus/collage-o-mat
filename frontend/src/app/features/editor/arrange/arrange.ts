// Public entry point of the arrangement algorithms (steps 6/7).
// Pure functions: no Angular, no DOM, only `import type` from models.
import type { ArrangementMode, CollageSettings } from '../../../core/models/collage';
import { arrangeCenter } from './center';
import { arrangeGrid } from './grid';
import { arrangeHeap } from './heap';
import type { ArrangePhoto, FrameMap } from './types';

export type { ArrangePhoto, FrameMap } from './types';
export { placeBesidePage } from './beside-page';
export { resolveCentrePhotoId } from './center';

/**
 * An arrangement mode: photos (sorted by id) + collage settings + a random source (values in
 * [0, 1); only random modes use it) → frames.
 */
type ArrangeStrategy = (
  photos: readonly ArrangePhoto[],
  settings: CollageSettings,
  random: () => number,
) => FrameMap;

/** One strategy per mode. A new mode is a new entry here (and in `ArrangementMode`). */
const STRATEGIES: Readonly<Record<ArrangementMode, ArrangeStrategy>> = {
  grid: (photos, settings) => arrangeGrid(photos, settings.page, settings.grid),
  center: (photos, settings) => arrangeCenter(photos, settings.page, settings.center),
  heap: (photos, settings, random) => arrangeHeap(photos, settings.page, settings.heap, random),
};

/**
 * Arranges all photos with the mode in `settings.mode` (`grid`, `center` or `heap`) on
 * `settings.page`. Photos are processed in id-ascending order (the input array is not changed).
 * Borders are `{widthMm: null, color: null}` (collage default).
 * @param random random source with values in [0, 1) for random modes (`heap`); injectable for tests
 * @throws Error if `settings.mode` is not a known mode
 */
export function arrangePhotos(
  photos: readonly ArrangePhoto[],
  settings: CollageSettings,
  random: () => number = Math.random,
): FrameMap {
  if (!Object.hasOwn(STRATEGIES, settings.mode)) {
    throw new Error(`Unknown arrangement mode: ${String(settings.mode)}`);
  }
  return STRATEGIES[settings.mode](sortedById(photos), settings, random);
}

/** A copy of the photos sorted by id ascending. */
function sortedById(photos: readonly ArrangePhoto[]): ArrangePhoto[] {
  return [...photos].sort((a, b) => a.id - b.id);
}
