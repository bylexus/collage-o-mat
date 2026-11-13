// Konva nodes of one overlay text. Plain class without Angular; owned by `CollageRenderer`.
import Konva from 'konva/lib/Core';
import { Text as KonvaText } from 'konva/lib/shapes/Text';
import { ptToMm, TextProps } from '../../../core/models/text';
import type { FrameBox } from '../geometry/transform';
import { DRAG_THRESHOLD_PX } from './canvas-theme';
import type { TextBox } from './scene';

/** Konva name of the text groups. */
const TEXT_NAME = 'text';
/** CSS font size of the font face strings (`textFontFace`); any size loads the same face. */
const FONT_FACE_SIZE_PX = 16;

/** The text group that contains the node (or is the node), or `null`. */
export function textGroupOf(node: Konva.Node): Konva.Node | null {
  return node.findAncestor(`.${TEXT_NAME}`, true) ?? null;
}

/** Konva `fontStyle` for the bold/italic flags. */
export function konvaFontStyle(props: Pick<TextProps, 'bold' | 'italic'>): string {
  if (props.bold && props.italic) {
    return 'italic bold';
  }
  return props.bold ? 'bold' : props.italic ? 'italic' : 'normal';
}

/**
 * CSS font shorthand of the font face a text uses (style, weight, family), for
 * `document.fonts.load`. Two texts with the same face give the same string.
 */
export function textFontFace(props: Pick<TextProps, 'bold' | 'italic' | 'fontFamily'>): string {
  const style = props.italic ? 'italic' : 'normal';
  const weight = props.bold ? 700 : 400;
  return `${style} ${weight} ${FONT_FACE_SIZE_PX}px "${props.fontFamily}"`;
}

/** Drag events of a text view to its owner. */
export interface TextViewEvents {
  onDragStart: (view: TextView) => void;
  /**
   * After each drag step (Konva has moved the group, before the layer is drawn): the owner may
   * adjust the position. `event` is the native pointer event of the step.
   */
  onDragMove: (view: TextView, event: Event | undefined) => void;
  onDragEnd: (view: TextView) => void;
}

/**
 * The Konva nodes of one overlay text: a group at the box centre (rotated, draggable) with a
 * `Konva.Text` that wraps at the box width. The group offset is half the box, so the rotation is
 * around the centre; the box height follows from the wrapped text.
 *
 * All lengths are world mm (the stage scale is px per mm), so font size, outline, shadow blur and
 * shadow offset keep their size in mm at every zoom and in an export at any resolution: Konva
 * scales the stroke with the transform and multiplies shadow blur/offset by the absolute scale
 * (stage scale included) and the canvas pixel ratio when it draws (`Context._applyShadow`).
 */
export class TextView {
  readonly group: Konva.Group;
  private readonly text: KonvaText;
  private face = '';
  /** True while a drag or transform changes the group; `update` then keeps the gesture's geometry. */
  private inGesture = false;

  /** @param events drag events; without them the view is static (not draggable, e.g. the export). */
  constructor(
    readonly id: string,
    events?: TextViewEvents,
  ) {
    this.group = new Konva.Group({
      name: TEXT_NAME,
      draggable: events !== undefined,
      dragDistance: DRAG_THRESHOLD_PX,
    });
    // The outline is drawn first, the fill on top: the outline does not cover the letters.
    this.text = new KonvaText({ wrap: 'word', fillAfterStrokeEnabled: true, lineJoin: 'round' });
    this.group.add(this.text);
    if (events) {
      this.group.on('dragstart', () => events.onDragStart(this));
      this.group.on('dragmove', (event) => events.onDragMove(this, event.evt));
      this.group.on('dragend', () => events.onDragEnd(this));
    }
  }

  /** CSS font face of the drawn text (see `textFontFace`). */
  get fontFace(): string {
    return this.face;
  }

  /** Shows the props of the scene; ignored while a gesture changes this text. */
  update(props: TextProps): void {
    if (!this.inGesture) {
      this.showProps(props);
    }
  }

  /** Draws the text with the props (scale reset to 1). */
  showProps(props: TextProps): void {
    this.face = textFontFace(props);
    const { shadow, outline } = props;
    this.text.setAttrs({
      text: props.text,
      fontFamily: props.fontFamily,
      fontSize: ptToMm(props.fontSizePt),
      fontStyle: konvaFontStyle(props),
      align: props.align,
      width: props.widthMm,
      fill: props.color,
      stroke: outline.color,
      // The fill covers the inner half of the stroke: twice the width gives a visible outline of
      // `widthMm` outside the letters.
      strokeWidth: outline.widthMm * 2,
      strokeEnabled: outline.enabled && outline.widthMm > 0,
      shadowEnabled: shadow.enabled,
      shadowColor: shadow.color,
      shadowBlur: shadow.blurMm,
      shadowOffsetX: shadow.offsetXMm,
      shadowOffsetY: shadow.offsetYMm,
      shadowOpacity: shadow.opacity,
    });
    this.group.setAttrs({
      x: props.cxMm,
      y: props.cyMm,
      scaleX: 1,
      scaleY: 1,
      rotation: props.rotationDeg,
    });
    this.centreOrigin();
  }

  /**
   * Measures and wraps the text again with the current font (call after a web font has loaded).
   * Konva measures only when a text attribute changes, so a font that loads later would keep the
   * line breaks and box height of the fallback font.
   */
  relayout(): void {
    this.text._setTextData();
    this.centreOrigin();
  }

  /** The box as currently drawn, including a move or transformer scale not yet committed. */
  textBox(): TextBox {
    return {
      cxMm: this.group.x(),
      cyMm: this.group.y(),
      widthMm: this.text.width() * Math.abs(this.group.scaleX()),
      rotationDeg: this.group.rotation(),
    };
  }

  /** The box as drawn with its height from the wrapped text (for bounds). */
  frameBox(): FrameBox {
    return {
      ...this.textBox(),
      heightMm: this.text.height() * Math.abs(this.group.scaleY()),
    };
  }

  /** True if the node is the group or one of its children. */
  contains(node: Konva.Node): boolean {
    return node === this.group || this.group.isAncestorOf(node);
  }

  setDraggable(draggable: boolean): void {
    if (this.group.draggable() !== draggable) {
      this.group.draggable(draggable);
    }
  }

  /** A drag or transform starts: scene updates must not reset the geometry until `endGesture`. */
  beginGesture(): void {
    this.inGesture = true;
  }

  endGesture(): void {
    this.inGesture = false;
  }

  destroy(): void {
    this.group.destroy();
  }

  /** Puts the group origin at the box centre (rotation around the centre). */
  private centreOrigin(): void {
    this.group.offset({ x: this.text.width() / 2, y: this.text.height() / 2 });
  }
}
