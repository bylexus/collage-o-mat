// Public entry point of the arrangement algorithms (steps 6/7).
// Pure functions: no Angular, no DOM, only `import type` from models.
import type { ArrangementMode, CollageSettings } from '../../../core/models/collage';
import { arrangeCenter } from './center';
import { arrangeGrid } from './grid';
import { arrangeHeap } from './heap';
import { arrangeMasonry } from './masonry';
import { shuffle } from './shuffle';
import type { ArrangePhoto, FrameMap } from './types';

export type { ArrangePhoto, FrameMap } from './types';
export { placeBesidePage } from './beside-page';
export { resolveCentrePhotoId } from './center';

/**
 * An arrangement mode: photos (sorted by id, or shuffled if the mode's random order is on) +
 * collage settings + a random source (values in [0, 1); only random modes use it) → frames.
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
  masonry: (photos, settings, random) =>
    arrangeMasonry(photos, settings.page, settings.masonry, random),
};

/**
 * Per mode: are the photos shuffled before the strategy runs? `heap` is random anyway; `masonry`
 * handles its random order itself (`masonry.randomOrder` changes the split, not only the input
 * order), so its photos always come in id order.
 */
const RANDOM_ORDER: Readonly<Record<ArrangementMode, (settings: CollageSettings) => boolean>> = {
  grid: (settings) => settings.grid.randomOrder,
  center: (settings) => settings.center.randomOrder,
  heap: () => false,
  masonry: () => false,
};

/**
 * Arranges all photos with the mode in `settings.mode` (`grid`, `center`, `heap` or `masonry`) on
 * `settings.page`. Photos are processed in id-ascending order, or in random order if the random
 * order setting of the active mode is on (`grid.randomOrder`, `center.randomOrder`; masonry handles
 * `masonry.randomOrder` itself); the input array is not changed. Borders are
 * `{widthMm: null, color: null}` and there is no `shadow` (collage defaults); the editor store puts
 * back the own border and shadow of photos that are placed already.
 * @param random random source with values in [0, 1) for random modes (`heap`, `masonry` with
 *   random order) and the random order; injectable for tests
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
  const ordered = sortedById(photos);
  if (RANDOM_ORDER[settings.mode](settings)) {
    shuffle(ordered, random);
  }
  return STRATEGIES[settings.mode](ordered, settings, random);
}

/** A copy of the photos sorted by id ascending. */
function sortedById(photos: readonly ArrangePhoto[]): ArrangePhoto[] {
  return [...photos].sort((a, b) => a.id - b.id);
}
