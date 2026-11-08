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
import { isPlaced, Photo, photoFileUrl } from '../../../core/models/photo';
import { CollageRenderer, Scene, ScenePhoto } from './collage-renderer';

/**
 * Konva canvas of the editor (presentational): draws the page and the placed photos, reports
 * clicks and shows the zoom controls. Fills its container. The view is zoomed to fit on the first
 * render and when the page size or orientation changes; pan and zoom input is handled by the
 * renderer (see `StageNavigator`).
 */
@Component({
  selector: 'app-editor-canvas',
  imports: [PercentPipe, MatButtonModule, MatIconModule, MatTooltipModule],
  template: `
    <div #host class="canvas-host"></div>
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
  readonly selectedPhotoId = input<number | null>(null);
  /** Click on a photo (its id) or on the empty area (`null`). */
  readonly photoSelected = output<number | null>();

  private readonly destroyRef = inject(DestroyRef);
  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('host');
  private readonly renderer = signal<CollageRenderer | null>(null);
  /** Current zoom (1 = real size), reported by the renderer. */
  protected readonly zoom = signal(1);
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
          ? [{ id: photo.id, url: photoFileUrl(collageId, photo.id), props: photo.props }]
          : [],
      ),
      selectedPhotoId: this.selectedPhotoId(),
    };
  });

  constructor() {
    afterNextRender(() => this.createRenderer());
    effect(() => this.renderScene());
  }

  /** Shows the page and all photos as large as possible. */
  zoomToFit(): void {
    this.renderer()?.zoomToFit();
  }

  protected zoomIn(): void {
    this.renderer()?.zoomIn();
  }

  protected zoomOut(): void {
    this.renderer()?.zoomOut();
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
      onSelect: (id) => this.photoSelected.emit(id),
      onZoomChange: (zoom) => this.zoom.set(zoom),
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
