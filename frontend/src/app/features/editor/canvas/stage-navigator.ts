// Pan and zoom of the editor stage. Plain class without Angular; owned by `CollageRenderer`.
import type Konva from 'konva/lib/Core';
import type { KonvaEventObject } from 'konva/lib/Node';
import { pointInElement } from './pointer';
import type { PressGestureTracker } from './press-gesture';
import {
  centreOf,
  fitRect,
  keepCentre,
  panBy,
  Point,
  Rect,
  Size,
  ViewTransform,
  wheelZoomFactor,
  zoomBy,
  zoomOfScale,
} from './viewport';

/** Konva event namespace of the navigator listeners. */
const EVENT_NAMESPACE = '.navigator';
/** Free space around the content after "zoom to fit", in screen px. */
const FIT_MARGIN_PX = 24;
/** Zoom factor of one zoom button step. */
const ZOOM_BUTTON_STEP = 1.25;
/** Pointer movement (screen px) after which a press on the empty workspace becomes a pan. */
const PAN_THRESHOLD_PX = 4;
/** `MouseEvent.button` of the primary (left) button. */
const PRIMARY_BUTTON = 0;
/** Px per line for wheel events in line mode (Firefox with some mouse drivers). */
const WHEEL_LINE_HEIGHT_PX = 16;

const CURSOR_DEFAULT = '';
const CURSOR_GRAB = 'grab';
const CURSOR_GRABBING = 'grabbing';

export interface StageNavigatorOptions {
  /** Marks a press that became a pan, so that the following click is ignored. */
  gestures: PressGestureTracker;
  /** Bounds (world mm) that "zoom to fit" shows; `null` while there is nothing to show. */
  contentBounds: () => Rect | null;
  /** Called with the zoom (1 = real size) after each view change. */
  onZoomChange: (zoom: number) => void;
  /**
   * Gets plain (vertical) wheel events first, with the pointer in container px and the vertical
   * delta in px; returns true if it handled the event (no view pan then). Used by crop mode.
   */
  interceptWheel?: (pointer: Point, deltaYPx: number) => boolean;
}

/** A press of the primary button on the empty workspace. */
interface PressGesture {
  pointerId: number;
  /** Client px of the press. */
  start: Point;
  /** Client px of the last applied movement. */
  last: Point;
  /** True once the pointer moved more than `PAN_THRESHOLD_PX`. */
  panning: boolean;
}

/**
 * Pan and zoom of a Konva stage; the stage scale (px per mm) and position are the view transform.
 *
 * - Wheel / trackpad scroll pans (Shift + wheel pans horizontally).
 * - Ctrl/Cmd + wheel and trackpad pinch zoom at the pointer.
 * - Plain wheel events go to `interceptWheel` first (crop mode zooms the crop over the frame).
 * - Dragging the empty workspace (page included, photos excluded) pans; the cursor shows grab /
 *   grabbing. A press without movement stays a click (a pan is marked in `PressGestureTracker`).
 * - Zoom buttons zoom around the view centre.
 * - Resize: until the user moves the view (and again after each "zoom to fit") the content is
 *   fitted again; after a manual pan or zoom, the zoom stays and the view centre stays in place.
 */
export class StageNavigator {
  private press: PressGesture | null = null;
  /** True after the first successful "zoom to fit". */
  private fitted = false;
  /** True when the user panned or zoomed since the last "zoom to fit". */
  private navigated = false;

  constructor(
    private readonly stage: Konva.Stage,
    private readonly options: StageNavigatorOptions,
  ) {
    this.container.addEventListener('wheel', this.onWheel, { passive: false });
    stage.on(`pointerdown${EVENT_NAMESPACE}`, (event) => this.onPointerDown(event));
    stage.on(`pointermove${EVENT_NAMESPACE}`, (event) => this.updateHoverCursor(event.target));
    stage.on(`pointerleave${EVENT_NAMESPACE}`, () => this.updateHoverCursor(null));
  }

  /** Shows the content as large as possible. Returns false if there is nothing to fit. */
  zoomToFit(): boolean {
    const bounds = this.options.contentBounds();
    const size = this.stage.size();
    if (!bounds || size.width === 0 || size.height === 0) {
      return false;
    }
    this.apply(fitRect(bounds, size, FIT_MARGIN_PX));
    this.fitted = true;
    this.navigated = false;
    return true;
  }

  /** Zooms to fit if this has not been done yet (first content, stage was hidden). */
  fitOnce(): void {
    if (!this.fitted) {
      this.zoomToFit();
    }
  }

  /** Zooms in by one button step around the view centre. */
  zoomIn(): void {
    this.zoomAroundCentre(ZOOM_BUTTON_STEP);
  }

  /** Zooms out by one button step around the view centre. */
  zoomOut(): void {
    this.zoomAroundCentre(1 / ZOOM_BUTTON_STEP);
  }

  /** Sets the stage size in px; see the class doc for how the view follows. */
  resize(size: Size): void {
    const previous = this.stage.size();
    this.stage.size(size);
    if (this.navigated) {
      this.apply(keepCentre(this.view(), previous, size));
    } else if (!this.zoomToFit()) {
      this.stage.batchDraw();
    }
  }

  /** Removes the DOM listeners (the Konva listeners go with the stage). */
  destroy(): void {
    this.container.removeEventListener('wheel', this.onWheel);
    this.stopTrackingPress();
  }

  private get container(): HTMLDivElement {
    return this.stage.container();
  }

  private view(): ViewTransform {
    return { scale: this.stage.scaleX(), x: this.stage.x(), y: this.stage.y() };
  }

  private apply(view: ViewTransform): void {
    this.stage.scale({ x: view.scale, y: view.scale });
    this.stage.position({ x: view.x, y: view.y });
    this.stage.batchDraw();
    this.options.onZoomChange(zoomOfScale(view.scale));
  }

  /** A view change made by the user (pan, zoom); ends the "follow fit on resize" state. */
  private navigate(view: ViewTransform): void {
    this.navigated = true;
    this.apply(view);
  }

  private zoomAroundCentre(factor: number): void {
    this.navigate(zoomBy(this.view(), factor, centreOf(this.stage.size())));
  }

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const size = this.stage.size();
    const dx = wheelDeltaPx(event.deltaX, event.deltaMode, size.width);
    const dy = wheelDeltaPx(event.deltaY, event.deltaMode, size.height);
    const pointer = pointInElement(this.container, event);
    if (event.ctrlKey || event.metaKey) {
      // Trackpad pinch arrives as a wheel event with `ctrlKey`.
      this.navigate(zoomBy(this.view(), wheelZoomFactor(dy), pointer));
    } else if (!event.shiftKey && this.options.interceptWheel?.(pointer, dy)) {
      return;
    } else if (event.shiftKey && dx === 0) {
      // Mouse wheel with Shift: browsers that do not swap the axes themselves.
      this.navigate(panBy(this.view(), -dy, 0));
    } else {
      this.navigate(panBy(this.view(), -dx, -dy));
    }
  };

  private onPointerDown(event: KonvaEventObject<PointerEvent>): void {
    const evt = event.evt;
    if (event.target !== this.stage || evt.button !== PRIMARY_BUTTON || this.press) {
      return;
    }
    const point = clientPoint(evt);
    this.press = { pointerId: evt.pointerId, start: point, last: point, panning: false };
    // On the window: the pan goes on when the pointer leaves the canvas.
    window.addEventListener('pointermove', this.onPressMove);
    window.addEventListener('pointerup', this.onPressEnd);
    window.addEventListener('pointercancel', this.onPressEnd);
  }

  private readonly onPressMove = (event: PointerEvent): void => {
    const press = this.press;
    if (!press || event.pointerId !== press.pointerId) {
      return;
    }
    const point = clientPoint(event);
    if (!press.panning) {
      if (distance(press.start, point) < PAN_THRESHOLD_PX) {
        return;
      }
      press.panning = true;
      this.options.gestures.markGesture();
      this.setCursor(CURSOR_GRABBING);
    }
    this.navigate(panBy(this.view(), point.x - press.last.x, point.y - press.last.y));
    press.last = point;
  };

  private readonly onPressEnd = (event: PointerEvent): void => {
    if (event.pointerId !== this.press?.pointerId) {
      return;
    }
    const panned = this.press.panning;
    this.stopTrackingPress();
    if (panned) {
      this.setCursor(CURSOR_GRAB);
    }
  };

  private stopTrackingPress(): void {
    this.press = null;
    window.removeEventListener('pointermove', this.onPressMove);
    window.removeEventListener('pointerup', this.onPressEnd);
    window.removeEventListener('pointercancel', this.onPressEnd);
  }

  /** Grab cursor over the empty workspace, default over photos and outside; kept while panning. */
  private updateHoverCursor(target: Konva.Node | null): void {
    if (this.press?.panning) {
      return;
    }
    this.setCursor(target === this.stage ? CURSOR_GRAB : CURSOR_DEFAULT);
  }

  private setCursor(cursor: string): void {
    if (this.container.style.cursor !== cursor) {
      this.container.style.cursor = cursor;
    }
  }
}

/** Wheel delta in px; `pagePx` is the view length used for page mode. */
function wheelDeltaPx(delta: number, deltaMode: number, pagePx: number): number {
  switch (deltaMode) {
    case WheelEvent.DOM_DELTA_LINE:
      return delta * WHEEL_LINE_HEIGHT_PX;
    case WheelEvent.DOM_DELTA_PAGE:
      return delta * pagePx;
    default:
      return delta;
  }
}

function clientPoint(event: MouseEvent): Point {
  return { x: event.clientX, y: event.clientY };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}
