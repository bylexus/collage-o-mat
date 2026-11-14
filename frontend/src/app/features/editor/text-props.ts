// Overlay text props: defaults of a new text and comparisons. Pure functions: no Angular, no DOM.
import type { PageSize } from '../../core/models/collage';
import type { TextOutline, TextProps } from '../../core/models/text';
import { sameShadow } from './shadow';

/** Width of the text box of a new text as part of the page width. */
const NEW_TEXT_WIDTH_RATIO = 0.5;

/**
 * Props of a new text: the given text in Inter 24 pt, black, centred; the box is half the page
 * width wide and centred on the page, not rotated; shadow and outline off (with useful values for
 * when they are switched on).
 */
export function newTextProps(text: string, page: PageSize, z: number): TextProps {
  return {
    text,
    fontFamily: 'Inter',
    fontSizePt: 24,
    color: '#000000',
    bold: false,
    italic: false,
    align: 'center',
    cxMm: page.widthMm / 2,
    cyMm: page.heightMm / 2,
    widthMm: page.widthMm * NEW_TEXT_WIDTH_RATIO,
    rotationDeg: 0,
    z,
    shadow: {
      enabled: false,
      color: '#000000',
      blurMm: 1,
      offsetXMm: 0.5,
      offsetYMm: 0.5,
      opacity: 0.5,
    },
    outline: { enabled: false, color: '#ffffff', widthMm: 0.3 },
  };
}

/** True if the text has no visible characters (such a text is deleted on commit). */
export function isBlankText(props: TextProps): boolean {
  return props.text.trim() === '';
}

/** True if both props have the same values. */
export function sameTextProps(a: TextProps, b: TextProps): boolean {
  return (
    a === b ||
    (a.text === b.text &&
      a.fontFamily === b.fontFamily &&
      a.fontSizePt === b.fontSizePt &&
      a.color === b.color &&
      a.bold === b.bold &&
      a.italic === b.italic &&
      a.align === b.align &&
      a.cxMm === b.cxMm &&
      a.cyMm === b.cyMm &&
      a.widthMm === b.widthMm &&
      a.rotationDeg === b.rotationDeg &&
      a.z === b.z &&
      sameShadow(a.shadow, b.shadow) &&
      sameOutline(a.outline, b.outline))
  );
}

/** True if both outlines have the same values. */
export function sameOutline(a: TextOutline, b: TextOutline): boolean {
  return a.enabled === b.enabled && a.color === b.color && a.widthMm === b.widthMm;
}
