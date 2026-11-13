import { Component, input, output } from '@angular/core';
import { MatSliderModule } from '@angular/material/slider';

/** Step of the zoom slider. */
const ZOOM_SLIDER_STEP = 0.01;

/**
 * Zoom slider of the canvas crop mode (presentational). The zoom is the crop zoom of
 * `CropModeState` (1 = largest crop that fills the frame). `zoomInput` follows the thumb while it
 * moves; `zoomCommit` comes when the thumb is released (or after a keyboard change).
 */
@Component({
  selector: 'app-crop-mode-controls',
  imports: [MatSliderModule],
  template: `
    <mat-slider
      class="zoom"
      [min]="minZoom()"
      [max]="maxZoom()"
      [step]="step"
      i18n-aria-label="@@editor.crop.zoom"
      aria-label="Image zoom"
    >
      <input
        matSliderThumb
        [value]="zoom()"
        (input)="zoomInput.emit(valueOf($event))"
        (change)="zoomCommit.emit()"
      />
    </mat-slider>
  `,
  styles: `
    /* Semi-transparent background, so the slider stays visible on top of photos. */
    :host {
      display: block;
      margin-top: 4px;
      padding: 0 12px;
      border-radius: var(--mat-sys-corner-full);
      background-color: color-mix(in srgb, var(--mat-sys-surface-container) 75%, transparent);
    }

    .zoom {
      width: 160px;
      margin: 0;
    }
  `,
})
export class CropModeControls {
  /** Current zoom. */
  readonly zoom = input.required<number>();
  readonly minZoom = input.required<number>();
  readonly maxZoom = input.required<number>();
  /** New zoom while the slider moves. */
  readonly zoomInput = output<number>();
  /** The slider was released: the zoom can be committed. */
  readonly zoomCommit = output<void>();

  protected readonly step = ZOOM_SLIDER_STEP;

  protected valueOf(event: Event): number {
    return (event.target as HTMLInputElement).valueAsNumber;
  }
}
