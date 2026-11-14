/** Overlay text DTOs of a collage (table `collage_texts`, JSON `props`). */
import type { Shadow } from './shadow';

/** Fonts bundled with the app (self-hosted `@fontsource` packages). Value = CSS font family. */
export const TEXT_FONT_FAMILIES = [
  'Abril Fatface',
  'Bebas Neue',
  'Caveat',
  'Dancing Script',
  'EB Garamond',
  'Indie Flower',
  'Inter',
  'Lobster',
  'Lora',
  'Merriweather',
  'Montserrat',
  'Open Sans',
  'Pacifico',
  'Playfair Display',
  'Poppins',
  'Righteous',
] as const;
export type TextFontFamily = (typeof TEXT_FONT_FAMILIES)[number];

export type TextAlign = 'left' | 'center' | 'right';

/** Shadow of an overlay text (same type as every shadow). */
export type TextShadow = Shadow;

export interface TextOutline {
  enabled: boolean;
  color: string;
  widthMm: number;
}

/** The `props` JSON document of an overlay text. All lengths in mm, page origin top-left. */
export interface TextProps {
  /** Multi-line text (`\n` separates lines); never empty in a saved layout. */
  text: string;
  fontFamily: TextFontFamily;
  fontSizePt: number;
  color: string;
  bold: boolean;
  italic: boolean;
  align: TextAlign;
  /** Box centre (rotation is around the centre). The box height follows from the wrapped text. */
  cxMm: number;
  cyMm: number;
  /** Box width; the text wraps inside it. */
  widthMm: number;
  rotationDeg: number;
  /** Stacking order, shared with photos; higher is in front. */
  z: number;
  shadow: TextShadow;
  outline: TextOutline;
}

/** Overlay text of a collage as returned by the API. The id is a UUID made by the frontend. */
export interface CollageText {
  id: string;
  props: TextProps;
}
