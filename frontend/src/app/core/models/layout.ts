import type { CollageSettings } from './collage';
import type { PhotoProps, UnplacedProps } from './photo';

/** Body of `PUT /api/collages/{id}/layout`: the full editor layout, saved in one transaction. */
export interface SaveLayoutRequest {
  settings: CollageSettings;
  /** Props of the listed photos are replaced; photos not listed keep their props. */
  photos: { id: number; props: PhotoProps | UnplacedProps }[];
}
