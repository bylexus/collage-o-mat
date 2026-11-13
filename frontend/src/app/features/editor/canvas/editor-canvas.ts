import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { PercentPipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CollageSettings, PageSize } from '../../../core/models/collage';
import { isPlaced, Photo, photoFileUrl, PhotoProps } from '../../../core/models/photo';
import type { CollageText, TextProps } from '../../../core/models/text';
import type { EditorSelection } from '../selection';
import { CollageRenderer, CropModeState, Scene, ScenePhoto } from './collage-renderer';
import { CropModeControls } from './crop-mode-controls';

/** A committed change of one photo made on the canvas. */
export interface PhotoChange {
  id: number;
  /** The complete new props. */
  props: PhotoProps;
}

/** A committed change of one text made on the canvas (move, rotation, box width). */
export interface TextChange {
  id: string;
  /** The complete new props. */
  props: TextProps;
}

/**
 * Konva canvas of the editor (presentational): draws the page, the placed photos and the overlay
 * texts, reports the selection, committed photo edits (move, rotate, resize, crop), committed text
 * edits (move, rotate, box width) and text edit requests (double-click), and shows the zoom
 * controls and the crop mode controls. Fills its container. The view is zoomed to fit on the first render and
 * when the page size or orientation changes. All canvas input is handled by the renderer (see
 * `CollageRenderer`).
 */
@Component({
  selector: 'app-editor-canvas',
  imports: [PercentPipe, MatButtonModule, MatIconModule, MatTooltipModule, CropModeControls],
  template: `
    <div #host class="canvas-host"></div>
    @if (cropMode(); as crop) {
      <app-crop-mode-controls
        class="crop-controls"
        [style.--anchor-x.px]="crop.anchor.x"
        [style.--anchor-y.px]="crop.anchor.y"
        [zoom]="crop.zoom"
        [minZoom]="crop.minZoom"
        [maxZoom]="crop.maxZoom"
        (zoomInput)="setCropZoom($event)"
        (zoomCommit)="commitCropZoom()"
      />
    }
    <div
      class="zoom-controls"
      role="toolbar"
      i18n-aria-label="@@editor.zoom.controls"
      aria-label="Zoom"
    >
      <button
        matIconButton
        type="button"
        (click)="zoomOut()"
        i18n-aria-label="@@editor.zoom.out"
        aria-label="Zoom out"
        i18n-matTooltip="@@editor.zoom.out"
        matTooltip="Zoom out"
        matTooltipPosition="above"
      >
        <mat-icon>remove</mat-icon>
      </button>
      <span class="zoom-level">{{ zoom() | percent: '1.0-0' }}</span>
      <button
        matIconButton
        type="button"
        (click)="zoomIn()"
        i18n-aria-label="@@editor.zoom.in"
        aria-label="Zoom in"
        i18n-matTooltip="@@editor.zoom.in"
        matTooltip="Zoom in"
        matTooltipPosition="above"
      >
        <mat-icon>add</mat-icon>
      </button>
      <button
        matIconButton
        type="button"
        (click)="zoomToFit()"
        i18n-aria-label="@@editor.zoom.fit"
        aria-label="Zoom to fit"
        i18n-matTooltip="@@editor.zoom.fit"
        matTooltip="Zoom to fit"
        matTooltipPosition="above"
      >
        <mat-icon>fit_screen</mat-icon>
      </button>
    </div>
  `,
  styles: `
    :host {
      display: block;
      position: relative;
      overflow: hidden;
      background-color: #e3e3e3;
      user-select: none;
    }

    .canvas-host {
      position: absolute;
      inset: 0;
      /* Touch drags pan the canvas, not the page. */
      touch-action: none;
    }

    /* Directly below the frame in crop mode, kept inside the canvas. */
    .crop-controls {
      position: absolute;
      top: clamp(0px, var(--anchor-y), calc(100% - 52px));
      left: clamp(92px, var(--anchor-x), calc(100% - 92px));
      transform: translateX(-50%);
    }

    .zoom-controls {
      position: absolute;
      right: 12px;
      bottom: 12px;
      display: flex;
      align-items: center;
      padding: 0 4px;
      border-radius: var(--mat-sys-corner-full);
      background-color: var(--mat-sys-surface-container);
      box-shadow: var(--mat-sys-level2);
      color: var(--mat-sys-on-surface);
    }

    .zoom-level {
      min-width: 5ch;
      text-align: center;
      font: var(--mat-sys-label-large);
      font-variant-numeric: tabular-nums;
    }
  `,
})
export class EditorCanvas {
  readonly settings = input.required<CollageSettings>();
  readonly photos = input.required<readonly Photo[]>();
  /** Collage of the photos (for the image URLs). */
  readonly collageId = input.required<number>();
  /** All texts of the collage, with a live preview of the panel already applied. */
  readonly texts = input.required<readonly CollageText[]>();
  readonly selection = input<EditorSelection>(null);
  /** Click on a photo, on a text, or on the empty area (`null`). */
  readonly selectionChange = output<EditorSelection>();
  /** A committed move, rotation, resize or crop change (once per gesture, never during it). */
  readonly photoChange = output<PhotoChange>();
  /** A committed move, rotation or box width change of a text (once per gesture, never during it). */
  readonly textChange = output<TextChange>();
  /** Double-click on a text (its id): the owner shows the text for editing. */
  readonly textEditRequest = output<string>();

  private readonly destroyRef = inject(DestroyRef);
  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('host');
  private readonly renderer = signal<CollageRenderer | null>(null);
  /** Current zoom (1 = real size), reported by the renderer. */
  protected readonly zoom = signal(1);
  /** Crop mode of the renderer (`null` when off). */
  protected readonly cropMode = signal<CropModeState | null>(null);
  /** Page size of the last render; a change triggers "zoom to fit". */
  private renderedPageSize: PageSize | null = null;

  private readonly scene = computed<Scene>(() => {
    const settings = this.settings();
    const collageId = this.collageId();
    return {
      page: settings.page,
      backgroundColor: settings.backgroundColor,
      defaultBorder: settings.defaultBorder,
      photos: this.photos().flatMap((photo): ScenePhoto[] =>
        isPlaced(photo.props)
          ? [
              {
                id: photo.id,
                url: photoFileUrl(collageId, photo.id),
                image: { widthPx: photo.widthPx, heightPx: photo.heightPx },
                props: photo.props,
              },
            ]
          : [],
      ),
      texts: this.texts(),
      selection: this.selection(),
    };
  });

  constructor() {
    afterNextRender(() => this.createRenderer());
    effect(() => this.renderScene());
  }

  /** Shows the page and all elements as large as possible. */
  zoomToFit(): void {
    this.renderer()?.zoomToFit();
  }

  protected zoomIn(): void {
    this.renderer()?.zoomIn();
  }

  protected zoomOut(): void {
    this.renderer()?.zoomOut();
  }

  protected setCropZoom(zoom: number): void {
    this.renderer()?.setCropZoom(zoom);
  }

  protected commitCropZoom(): void {
    this.renderer()?.commitCropZoom();
  }

  /** Draws the scene; fits the view after a page size or orientation change. */
  private renderScene(): void {
    const renderer = this.renderer();
    if (!renderer) {
      return;
    }
    const scene = this.scene();
    renderer.render(scene);
    if (this.pageSizeChanged(scene.page)) {
      renderer.zoomToFit();
    }
  }

  /** Remembers the page size; true if it differs from the previous one (not on the first call). */
  private pageSizeChanged(page: PageSize): boolean {
    const previous = this.renderedPageSize;
    this.renderedPageSize = { widthMm: page.widthMm, heightMm: page.heightMm };
    return (
      previous !== null &&
      (previous.widthMm !== page.widthMm || previous.heightMm !== page.heightMm)
    );
  }

  private createRenderer(): void {
    const container = this.host().nativeElement;
    const renderer = new CollageRenderer(container, {
      onSelect: (selection) => this.selectionChange.emit(selection),
      onZoomChange: (zoom) => this.zoom.set(zoom),
      onPhotoChange: (id, props) => this.photoChange.emit({ id, props }),
      onTextChange: (id, props) => this.textChange.emit({ id, props }),
      onTextEditRequest: (id) => this.textEditRequest.emit(id),
      onCropModeChange: (state) => this.cropMode.set(state),
    });
    const resizeObserver = new ResizeObserver(() =>
      renderer.setSize(container.clientWidth, container.clientHeight),
    );
    resizeObserver.observe(container);
    this.destroyRef.onDestroy(() => {
      resizeObserver.disconnect();
      renderer.destroy();
    });
    this.renderer.set(renderer);
  }
}
