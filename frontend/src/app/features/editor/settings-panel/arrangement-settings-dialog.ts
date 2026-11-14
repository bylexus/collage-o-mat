import { Component, inject } from '@angular/core';
import {
  FormControl,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  ValidatorFn,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { CollageSettings, HEAP_ASPECTS, HeapAspect } from '../../../core/models/collage';
import { limitValidators } from '../../../shared/number-limits';
import { NumberField } from '../fields/number-field';
import { SETTINGS_LIMITS } from './settings-limits';

/** Rows and columns: empty (`null`) = computed from the photo count. */
const gridCountValidators = limitValidators(SETTINGS_LIMITS.gridCount, { optional: true });

/** Photos per center lane: empty (`null`) = distributed automatically. */
const laneCountValidators = limitValidators(SETTINGS_LIMITS.laneCount, { optional: true });

/** The arrangement part of the collage settings: the mode and the parameters of all modes. */
export type ArrangementSettings = Pick<CollageSettings, 'mode' | 'grid' | 'center' | 'heap'>;

/**
 * Input of the arrangement settings dialog: `mode` is the mode to edit (can differ from the saved
 * mode), `grid`, `center` and `heap` are the saved parameters.
 */
export type ArrangementSettingsDialogData = ArrangementSettings;

/**
 * Result of the arrangement settings dialog: `mode` and its edited parameters; the parameters of
 * the other modes are the input values. `center.centerPhotoId` is the input value.
 */
export type ArrangementSettingsDialogResult = ArrangementSettings;

/**
 * Parameters of one arrangement mode. Closes with the new settings ("Re-arrange") or `undefined`
 * (Cancel, Esc, backdrop); saves and re-arranges nothing by itself.
 */
@Component({
  selector: 'app-arrangement-settings-dialog',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatSelectModule,
    NumberField,
  ],
  templateUrl: './arrangement-settings-dialog.html',
  styles: `
    .arrangement-fields {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .field-row {
      display: flex;
      align-items: flex-start;
      gap: 12px;

      > * {
        flex: 1;
        min-width: 0;
      }
    }

    .settings-note {
      margin: 0;
      font: var(--mat-sys-body-small);
      color: var(--mat-sys-on-surface-variant);
    }
  `,
})
export class ArrangementSettingsDialog {
  private readonly data = inject<ArrangementSettingsDialogData>(MAT_DIALOG_DATA);
  private readonly ref =
    inject<MatDialogRef<ArrangementSettingsDialog, ArrangementSettingsDialogResult>>(MatDialogRef);
  private readonly fb = inject(NonNullableFormBuilder);

  protected readonly mode = this.data.mode;
  protected readonly limits = SETTINGS_LIMITS;
  protected readonly heapAspects = HEAP_ASPECTS;

  protected readonly form = this.fb.group({
    grid: this.fb.group({
      rows: this.autoCountControl(this.data.grid.rows, gridCountValidators),
      cols: this.autoCountControl(this.data.grid.cols, gridCountValidators),
      gapMm: [this.data.grid.gapMm, limitValidators(this.limits.gapMm)],
      marginMm: [this.data.grid.marginMm, limitValidators(this.limits.marginMm)],
    }),
    center: this.fb.group({
      sizePercent: [this.data.center.sizePercent, limitValidators(this.limits.sizePercent)],
      gapMm: [this.data.center.gapMm, limitValidators(this.limits.gapMm)],
      marginMm: [this.data.center.marginMm, limitValidators(this.limits.marginMm)],
      topCount: this.autoCountControl(this.data.center.topCount, laneCountValidators),
      middleCount: this.autoCountControl(this.data.center.middleCount, laneCountValidators),
      bottomCount: this.autoCountControl(this.data.center.bottomCount, laneCountValidators),
    }),
    heap: this.fb.group({
      aspect: this.fb.control<HeapAspect>(this.data.heap.aspect),
      coveragePercent: [
        this.data.heap.coveragePercent,
        limitValidators(this.limits.coveragePercent),
      ],
      sizeVariationPercent: [
        this.data.heap.sizeVariationPercent,
        limitValidators(this.limits.sizeVariationPercent),
      ],
      maxRotationDeg: [this.data.heap.maxRotationDeg, limitValidators(this.limits.maxRotationDeg)],
      marginMm: [this.data.heap.marginMm, limitValidators(this.limits.marginMm)],
    }),
  });

  /** The parameters of the edited mode are invalid (Re-arrange is disabled). */
  protected parametersInvalid(): boolean {
    return this.form.controls[this.mode].invalid;
  }

  protected submit(): void {
    const parameters = this.form.controls[this.mode];
    if (parameters.invalid) {
      parameters.markAllAsTouched();
      return;
    }
    const { grid, center, heap } = this.data;
    this.ref.close({
      mode: this.mode,
      grid: this.mode === 'grid' ? this.form.controls.grid.getRawValue() : grid,
      // centerPhotoId is not edited here; keep it.
      center:
        this.mode === 'center' ? { ...center, ...this.form.controls.center.getRawValue() } : center,
      heap: this.mode === 'heap' ? this.form.controls.heap.getRawValue() : heap,
    });
  }

  /** Count field where empty (`null`) means "automatic". */
  private autoCountControl(
    value: number | null,
    validators: ValidatorFn[],
  ): FormControl<number | null> {
    return this.fb.control<number | null>(value, validators);
  }
}
