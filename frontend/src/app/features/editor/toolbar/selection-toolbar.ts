import { CdkDrag, CdkDragHandle, DragRef, Point } from '@angular/cdk/drag-drop';
import {
  CdkConnectedOverlay,
  CdkOverlayOrigin,
  ConnectedPosition,
  FlexibleConnectedPositionStrategy,
  OverlayModule,
} from '@angular/cdk/overlay';
import {
  afterEveryRender,
  afterNextRender,
  Component,
  computed,
  DOCUMENT,
  effect,
  inject,
  Injector,
  input,
  linkedSignal,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { BorderSettings } from '../../../core/models/collage';
import { Photo, PhotoAdjust } from '../../../core/models/photo';
import type { Shadow } from '../../../core/models/shadow';
import { CollageText, TextProps } from '../../../core/models/text';
import { LengthUnit } from '../geometry/length-unit';
import { PhotoAdjustSection } from '../photo-panel/photo-adjust-section';
import { PhotoBorderSection } from '../photo-panel/photo-border-section';
import { PhotoShadowSection } from '../photo-panel/photo-shadow-section';
import { TextEditSection } from '../text-panel/text-edit-section';
import { TextOutlineSection } from '../text-panel/text-outline-section';
import { TextShadowSection } from '../text-panel/text-shadow-section';

/** Kind of the selected element the toolbar is for. */
export type SelectionToolbarKind = 'photo' | 'text';

/** Popover of a toolbar button. */
type ToolbarPopoverId =
  'photoBorder' | 'photoShadow' | 'photoAdjust' | 'textEdit' | 'textOutline' | 'textShadow';

/** The open popover and the toolbar button it is connected to. */
interface OpenPopover {
  id: ToolbarPopoverId;
  origin: CdkOverlayOrigin;
}

/** Gap between the toolbar and the popover (px). */
const POPOVER_OFFSET = 8;
/** Minimum distance between the popover and the window edges (px). */
const POPOVER_VIEWPORT_MARGIN = 8;

/**
 * Only below the button, centred on it (no "above" fallback: the popover must not cover the
 * element). The toolbar has no vertical padding, so the button edges are the toolbar edges.
 * No CDK push (it also moves the popover up when it goes below the window bottom): the horizontal
 * offset that keeps it inside the window is set by `SelectionToolbar.placePopover`.
 */
const POPOVER_POSITIONS: ConnectedPosition[] = [
  {
    originX: 'center',
    originY: 'bottom',
    overlayX: 'center',
    overlayY: 'top',
    offsetY: POPOVER_OFFSET,
  },
];

/**
 * Floating icon row below the selected photo or text (presentational). The owner places it at the
 * anchor reported by the canvas. Direct actions are outputs; the popover buttons open the section
 * of the element in a CDK overlay connected to the button (one popover at a time) and forward its
 * outputs. The owner can request the "Edit text" popover for a text (`openTextEditFor`): it opens
 * as soon as the toolbar shows that text, and its text area gets the focus.
 *
 * The grip bar at the top of a popover moves it inside the window (`cdkDrag`); each open starts at
 * the default place.
 *
 * A popover closes on its button, Escape, a click outside it (the click itself works as usual), a
 * change of the selected element, when the swap mode starts (the toolbar then shows only the
 * Swap button), and when the toolbar is removed (the owner hides it during a gesture and in crop
 * mode).
 */
@Component({
  selector: 'app-selection-toolbar',
  imports: [
    OverlayModule,
    CdkDrag,
    CdkDragHandle,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    PhotoAdjustSection,
    PhotoBorderSection,
    PhotoShadowSection,
    TextEditSection,
    TextOutlineSection,
    TextShadowSection,
  ],
  templateUrl: './selection-toolbar.html',
  styleUrl: './selection-toolbar.scss',
  host: {
    role: 'toolbar',
    '[attr.aria-label]': "kind() === 'photo' ? photoToolbarLabel : textToolbarLabel",
    '(window:resize)': 'placePopover()',
  },
})
export class SelectionToolbar {
  readonly kind = input.required<SelectionToolbarKind>();
  /** Photo only: the selected photo (input of the photo popovers). */
  readonly photo = input<Photo | null>(null);
  /** Photo only: default border of the collage (border popover). */
  readonly defaultBorder = input<BorderSettings | null>(null);
  /** Photo only: default shadow of the collage (shadow popover). */
  readonly defaultShadow = input<Shadow | null>(null);
  /** Text only: the selected text with its committed props (input of the text popovers). */
  readonly text = input<CollageText | null>(null);
  /**
   * Text only: id of a text whose "Edit text" popover must open (with the focus in its text area)
   * as soon as the toolbar shows that text; `textEditOpened` reports that it is open.
   */
  readonly openTextEditFor = input<string | null>(null);
  /** Display unit of the lengths with the collage DPI. */
  readonly lengthUnit = input.required<LengthUnit>();
  /** Photo only: the photo is the background image (the "Use as background" action is off). */
  readonly isBackground = input(false);
  /**
   * Photo only: swap mode is on for this photo. The toolbar then shows only the active Swap button
   * (a click ends the mode); an open popover closes.
   */
  readonly swapping = input(false);
  /** Photo only: the Swap button can start the swap mode (else disabled). */
  readonly canSwap = input(false);
  /** Photo only: tooltip of the Swap button (explains the disabled states and the active mode). */
  readonly swapHint = input('');
  /** Photo only: show the "Set as centre" button (center arrangement mode). */
  readonly showSetCentre = input(false);
  /** Photo only: the photo is the centre photo ("Set as centre" is disabled). */
  readonly isCentrePhoto = input(false);
  /** Photo only: tooltip of the "Set as centre" button (explains the disabled state). */
  readonly setCentreHint = input('');

  /** Photo only: start crop mode. */
  readonly crop = output<void>();
  readonly bringToFront = output<void>();
  readonly sendToBack = output<void>();
  /** Photo only: make the photo the background image. */
  readonly useAsBackground = output<void>();
  /** Photo only: start the swap mode, or end it in swap mode. */
  readonly swap = output<void>();
  /** Photo only: make the photo the centre photo of the center arrangement. */
  readonly setCentre = output<void>();
  readonly delete = output<void>();
  /** Photo only: see `PhotoBorderSection`. */
  readonly borderChange = output<BorderSettings | null>();
  readonly borderPreview = output<BorderSettings>();
  /** Photo only: see `PhotoShadowSection`. */
  readonly shadowChange = output<Shadow | null>();
  readonly shadowPreview = output<Shadow>();
  /** Photo only: see `PhotoAdjustSection`. */
  readonly adjustChange = output<PhotoAdjust | null>();
  readonly adjustPreview = output<PhotoAdjust>();
  /** Text only: full props of a committed edit in a text popover (see `TextEditSection`). */
  readonly textChange = output<TextProps>();
  /** Text only: full props while a text popover field is edited (not committed). */
  readonly textPreview = output<TextProps>();
  /** Text only: the popover requested with `openTextEditFor` is open. */
  readonly textEditOpened = output<void>();

  protected readonly popoverPositions = POPOVER_POSITIONS;
  protected readonly popoverViewportMargin = POPOVER_VIEWPORT_MARGIN;

  /** Kind and id of the selected element; changes only when another element is selected. */
  private readonly elementKey = computed(
    () => `${this.kind()}:${this.photo()?.id ?? this.text()?.id ?? ''}`,
  );

  /** The open popover; `null` if none. Closed when another element is selected. */
  protected readonly openPopover = linkedSignal<string, OpenPopover | null>({
    source: this.elementKey,
    computation: () => null,
  });

  private readonly popoverOverlay = viewChild(CdkConnectedOverlay);
  /** Drag of the popover surface (grip bar). */
  private readonly popoverDrag = viewChild(CdkDrag);
  /** Origin of the "Edit text" button (text toolbar only). */
  private readonly editTextOrigin = viewChild<CdkOverlayOrigin>('editTextOrigin');
  /** The section of the open "Edit text" popover. */
  private readonly textEditSection = viewChild(TextEditSection);
  /** The text area of the next "Edit text" section gets the focus (popover opened on request). */
  private readonly focusTextPending = signal(false);
  private readonly injector = inject(Injector);
  private readonly document = inject(DOCUMENT);

  constructor() {
    // Opens the requested "Edit text" popover once the shown text and its button exist (the
    // request can come before the toolbar is shown, e.g. right after "Add text").
    effect(() => {
      const text = this.text();
      const origin = this.editTextOrigin();
      if (this.kind() !== 'text' || !text || !origin || this.openTextEditFor() !== text.id) {
        return;
      }
      untracked(() => {
        this.openPopover.set({ id: 'textEdit', origin });
        this.focusTextPending.set(true);
        this.textEditOpened.emit();
      });
    });
    // Focuses the text area after the popover with the section is rendered.
    effect(() => {
      const section = this.textEditSection();
      if (!section || !this.focusTextPending()) {
        return;
      }
      this.focusTextPending.set(false);
      afterNextRender(() => section.focusText(), { injector: this.injector });
    });
    // Swap mode shows only the Swap button: the open popover closes when the mode starts.
    effect(() => {
      if (this.swapping()) {
        untracked(() => this.closePopover());
      }
    });
    // A switch to another popover keeps the overlay (and the surface) attached: start the new
    // popover at the default place. A popover that opens is a new surface without a drag offset.
    effect(() => {
      this.openPopover();
      untracked(() => this.popoverDrag()?.reset());
    });
    // The toolbar follows the element (pan/zoom, size changes of a preview), but a connected
    // overlay is placed again only on window scroll/resize: place the open popover after each render.
    afterEveryRender({ write: () => this.placePopover() });
  }

  /** Accessible name of the open popover (its button label). */
  protected readonly popoverLabel = computed(() => {
    switch (this.openPopover()?.id) {
      case 'photoBorder':
        return this.borderLabel;
      case 'photoShadow':
      case 'textShadow':
        return this.shadowLabel;
      case 'photoAdjust':
        return this.adjustLabel;
      case 'textEdit':
        return this.editTextLabel;
      case 'textOutline':
        return this.outlineLabel;
      default:
        return null;
    }
  });

  protected isOpen(id: ToolbarPopoverId): boolean {
    return this.openPopover()?.id === id;
  }

  /** Opens the popover of a button, or closes it if it is open (one popover at a time). */
  protected togglePopover(id: ToolbarPopoverId, origin: CdkOverlayOrigin): void {
    this.openPopover.set(this.isOpen(id) ? null : { id, origin });
  }

  /**
   * Places the open popover again: always below the toolbar with its natural height, also if it
   * goes below the window bottom (the user drags it up to see it all). Its height is limited only
   * to the window height minus the margins, so that it fits completely after a drag (the content
   * then scrolls); the CDK applies `maxHeight` to the pane, the popover surface inherits it.
   * Horizontally it is centred on its button and moved inside the window (offset of the position,
   * as the CDK push would do, but without a vertical push). A drag offset of the surface (CSS
   * transform of the surface, not of the pane) stays.
   */
  protected placePopover(): void {
    const open = this.openPopover();
    const overlayRef = this.popoverOverlay()?.overlayRef;
    if (open === null || !overlayRef?.hasAttached()) {
      return;
    }
    const viewport = this.document.documentElement;
    const maxHeight = Math.max(0, viewport.clientHeight - 2 * POPOVER_VIEWPORT_MARGIN);
    if (overlayRef.getConfig().maxHeight !== maxHeight) {
      overlayRef.updateSize({ maxHeight });
    }
    const originRect = open.origin.elementRef.nativeElement.getBoundingClientRect();
    const width = overlayRef.overlayElement.getBoundingClientRect().width;
    const centredLeft = originRect.left + originRect.width / 2 - width / 2;
    const maxLeft = viewport.clientWidth - POPOVER_VIEWPORT_MARGIN - width;
    const left = Math.max(POPOVER_VIEWPORT_MARGIN, Math.min(centredLeft, maxLeft));
    const strategy = overlayRef.getConfig().positionStrategy as FlexibleConnectedPositionStrategy;
    strategy.withDefaultOffsetX(Math.round(left - centredLeft));
    overlayRef.updatePosition();
  }

  /**
   * Drag limit of the popover surface: inside the window, but a side where the surface already
   * goes out of the window at drag start (e.g. below the window bottom) is limited only to that
   * start position. Like this the surface does not jump at drag start (the CDK boundary clamps the
   * whole surface into the window at the first move), it follows the pointer and a drag up shows
   * it completely. Returns the top-left corner of the surface (window coordinates).
   */
  protected readonly constrainPopoverDrag = (
    pointer: Point,
    _ref: DragRef,
    start: DOMRect,
    pickup: Point,
  ): Point => {
    const viewport = this.document.documentElement;
    const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));
    return {
      x: clamp(
        pointer.x - pickup.x,
        Math.min(0, start.left),
        Math.max(viewport.clientWidth - start.width, start.left),
      ),
      y: clamp(
        pointer.y - pickup.y,
        Math.min(0, start.top),
        Math.max(viewport.clientHeight - start.height, start.top),
      ),
    };
  };

  protected closePopover(): void {
    this.openPopover.set(null);
  }

  /**
   * Click outside the popover: closes it, except for a click on another overlay (e.g. the
   * backdrop of a select panel opened in the popover, if the panel is not a native popover).
   */
  protected closeOnOutsideClick(event: MouseEvent): void {
    const target = event.composedPath()[0];
    if (target instanceof Element && target.closest('.cdk-overlay-backdrop, .cdk-overlay-pane')) {
      return;
    }
    this.closePopover();
  }

  protected readonly photoToolbarLabel = $localize`:@@editor.toolbar.photo:Selected photo`;
  protected readonly textToolbarLabel = $localize`:@@editor.toolbar.text:Selected text`;
  protected readonly cropLabel = $localize`:@@editor.toolbar.crop:Crop`;
  protected readonly borderLabel = $localize`:@@editor.toolbar.border:Border`;
  protected readonly shadowLabel = $localize`:@@editor.toolbar.shadow:Shadow`;
  protected readonly adjustLabel = $localize`:@@editor.toolbar.adjust:Adjustments`;
  protected readonly bringToFrontLabel = $localize`:@@editor.toolbar.bringToFront:Bring to front`;
  protected readonly sendToBackLabel = $localize`:@@editor.toolbar.sendToBack:Send to back`;
  protected readonly useAsBackgroundLabel = $localize`:@@editor.toolbar.useAsBackground:Use as background`;
  protected readonly swapLabel = $localize`:@@editor.swap:Swap photos`;
  protected readonly setCentreLabel = $localize`:@@editor.setCentre:Set as centre`;
  protected readonly isBackgroundLabel = $localize`:@@editor.toolbar.isBackground:Background image`;
  protected readonly deletePhotoLabel = $localize`:@@editor.toolbar.deletePhoto:Delete photo`;
  protected readonly editTextLabel = $localize`:@@editor.toolbar.editText:Edit text`;
  protected readonly outlineLabel = $localize`:@@editor.toolbar.outline:Outline`;
  protected readonly movePopoverLabel = $localize`:@@editor.toolbar.movePopover:Move`;
  protected readonly deleteTextLabel = $localize`:@@editor.toolbar.deleteText:Delete text`;
}
