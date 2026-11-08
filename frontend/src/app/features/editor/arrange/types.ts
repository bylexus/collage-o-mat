// Types shared by the arrangement strategies. Re-exported by `arrange.ts` (the public entry point).
import type { PhotoProps } from '../../../core/models/photo';

/** What the algorithms need to know about a photo. */
export interface ArrangePhoto {
  id: number;
  widthPx: number;
  heightPx: number;
}

/** Result of an arrangement: new props per photo id (every input photo gets an entry). */
export type FrameMap = Map<number, PhotoProps>;
