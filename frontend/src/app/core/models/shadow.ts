/**
 * Drop shadow DTO, shared by overlay texts and photos. Part of the JSON `props` and of the collage
 * settings (`defaultShadow`).
 */
export interface Shadow {
  /** False: no shadow is drawn (the other values are kept for when it is switched on again). */
  enabled: boolean;
  /** CSS colour, e.g. `#000000`. */
  color: string;
  /** Blur radius in mm. */
  blurMm: number;
  /** Horizontal offset in mm (positive = to the right, not rotated with the node). */
  offsetXMm: number;
  /** Vertical offset in mm (positive = down, not rotated with the node). */
  offsetYMm: number;
  /** 0..1 */
  opacity: number;
}
