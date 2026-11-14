import { Component, inject, input, output } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { defaultCollageSettings, SnapGridSettings } from '../../../core/models/collage';
import { limitValidators } from '../../../shared/number-limits';
import { LengthField } from '../fields/length-field';
import { syncFromInput } from '../fields/sync-from-input';
import { LengthUnit } from '../geometry/length-unit';
import { SETTINGS_LIMITS } from '../settings-panel/settings-limits';

/**
 * Content of the snap grid popover of the toolbar: grid on/off and the cell size. Emits each
 * valid change; the toggle commits at once, the size on the field's `committed`.
 */
@Component({
  selector: 'app-snap-grid-popover',
  imports: [ReactiveFormsModule, MatSlideToggleModule, LengthField],
  template: `
    <h2 id="snap-grid-popover-heading" class="popover-heading" i18n="@@editor.snapGrid.heading">
      Snap grid
    </h2>
    <mat-slide-toggle [formControl]="form.controls.enabled" (change)="commitEnabled()">
      <span i18n="@@editor.snapGrid.enabled">Snap to grid</span>
    </mat-slide-toggle>
    <app-length-field
      [control]="form.controls.sizeMm"
      [limits]="limits.snapGridSizeMm"
      [lengthUnit]="lengthUnit()"
      i18n-label="@@editor.snapGrid.size"
      label="Grid size"
      (committed)="commitSize()"
    />
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 16px;
      box-sizing: border-box;
      width: 240px;
      padding: 16px;
      border-radius: var(--mat-sys-corner-medium);
      background-color: var(--mat-sys-surface-container);
      box-shadow: var(--mat-sys-level2);
      color: var(--mat-sys-on-surface);
    }

    .popover-heading {
      margin: 0;
      font: var(--mat-sys-title-small);
      color: var(--mat-sys-on-surface-variant);
    }
  `,
  host: {
    role: 'dialog',
    'aria-labelledby': 'snap-grid-popover-heading',
  },
})
export class SnapGridPopover {
  readonly snapGrid = input.required<SnapGridSettings>();
  /** Display unit of the grid size with the collage DPI. */
  readonly lengthUnit = input.required<LengthUnit>();
  readonly snapGridChange = output<SnapGridSettings>();

  protected readonly limits = SETTINGS_LIMITS;

  private readonly defaults = defaultCollageSettings().snapGrid;
  protected readonly form = inject(NonNullableFormBuilder).group({
    enabled: [this.defaults.enabled],
    sizeMm: [this.defaults.sizeMm, limitValidators(this.limits.snapGridSizeMm)],
  });

  constructor() {
    syncFromInput(this.snapGrid, (snapGrid) => this.form.reset(snapGrid));
  }

  /** The toggle keeps the committed size (an invalid size in the field is not saved). */
  protected commitEnabled(): void {
    this.snapGridChange.emit({ ...this.snapGrid(), enabled: this.form.controls.enabled.value });
  }

  protected commitSize(): void {
    const size = this.form.controls.sizeMm;
    if (size.invalid) {
      size.markAsTouched();
      return;
    }
    this.snapGridChange.emit({ ...this.snapGrid(), sizeMm: size.value });
  }
}
