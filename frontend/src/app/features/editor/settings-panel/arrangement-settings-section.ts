import { Component, computed, inject, input, output } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  FormControl,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  ValidatorFn,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import {
  ArrangementMode,
  CenterSettings,
  defaultCollageSettings,
  GridSettings,
} from '../../../core/models/collage';
import { limitValidators } from '../../../shared/number-limits';
import { NumberField } from './number-field';
import { SETTINGS_LIMITS } from './settings-limits';
import { syncFromInput } from './sync-from-input';

/** Rows and columns: empty (`null`) = computed from the photo count. */
const gridCountValidators = limitValidators(SETTINGS_LIMITS.gridCount, { optional: true });

/** Photos per center lane: empty (`null`) = distributed automatically. */
const laneCountValidators = limitValidators(SETTINGS_LIMITS.laneCount, { optional: true });

/**
 * Arrangement mode with its parameters and the "Re-arrange" button. Emits each valid change of
 * the mode, the grid or the center parameters; never re-arranges by itself.
 */
@Component({
  selector: 'app-arrangement-settings-section',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatSelectModule,
    NumberField,
  ],
  templateUrl: './arrangement-settings-section.html',
  styleUrl: './settings-section.scss',
})
export class ArrangementSettingsSection {
  readonly mode = input.required<ArrangementMode>();
  readonly grid = input.required<GridSettings>();
  readonly center = input.required<CenterSettings>();
  readonly photoCount = input(0);

  readonly modeChange = output<ArrangementMode>();
  readonly gridChange = output<GridSettings>();
  readonly centerChange = output<CenterSettings>();
  readonly rearrange = output<void>();

  protected readonly limits = SETTINGS_LIMITS;

  private readonly fb = inject(NonNullableFormBuilder);
  private readonly defaults = defaultCollageSettings();
  protected readonly form = this.fb.group({
    mode: [this.defaults.mode],
    grid: this.fb.group({
      rows: this.autoCountControl(gridCountValidators),
      cols: this.autoCountControl(gridCountValidators),
      gapMm: [this.defaults.grid.gapMm, limitValidators(this.limits.gapMm)],
      marginMm: [this.defaults.grid.marginMm, limitValidators(this.limits.marginMm)],
    }),
    center: this.fb.group({
      sizePercent: [this.defaults.center.sizePercent, limitValidators(this.limits.sizePercent)],
      gapMm: [this.defaults.center.gapMm, limitValidators(this.limits.gapMm)],
      marginMm: [this.defaults.center.marginMm, limitValidators(this.limits.marginMm)],
      topCount: this.autoCountControl(laneCountValidators),
      middleCount: this.autoCountControl(laneCountValidators),
      bottomCount: this.autoCountControl(laneCountValidators),
    }),
  });

  /** Mode shown in the select (equals `mode` after each commit). */
  protected readonly selectedMode = toSignal(this.form.controls.mode.valueChanges, {
    initialValue: this.form.controls.mode.value,
  });
  protected readonly canRearrange = computed(() => this.photoCount() > 0);

  constructor() {
    syncFromInput(this.mode, (mode) => this.form.controls.mode.setValue(mode));
    syncFromInput(this.grid, ({ rows, cols, gapMm, marginMm }) =>
      this.form.controls.grid.reset({ rows, cols, gapMm, marginMm }),
    );
    // `centerPhotoId` has no control here; `reset` ignores it.
    syncFromInput(this.center, (center) => this.form.controls.center.reset(center));
  }

  /** The parameters of the selected mode are invalid (re-arranging would use old values). */
  protected parametersInvalid(): boolean {
    return this.form.controls[this.selectedMode()].invalid;
  }

  protected commitMode(): void {
    this.modeChange.emit(this.form.controls.mode.value);
  }

  protected commitGrid(): void {
    const grid = this.form.controls.grid;
    if (grid.invalid) {
      grid.markAllAsTouched();
      return;
    }
    this.gridChange.emit(grid.getRawValue());
  }

  protected commitCenter(): void {
    const center = this.form.controls.center;
    if (center.invalid) {
      center.markAllAsTouched();
      return;
    }
    // centerPhotoId is not edited here; keep it.
    this.centerChange.emit({ ...this.center(), ...center.getRawValue() });
  }

  /** Count field where empty (`null`) means "automatic". */
  private autoCountControl(validators: ValidatorFn[]): FormControl<number | null> {
    return this.fb.control<number | null>(null, validators);
  }
}
