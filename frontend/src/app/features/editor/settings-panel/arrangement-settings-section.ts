import { Component, computed, inject, input, output } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ArrangementMode, defaultCollageSettings } from '../../../core/models/collage';
import { syncFromInput } from '../fields/sync-from-input';

/**
 * Arrangement mode, the "Re-arrange…" button and the quick re-roll button. A mode selection and
 * "Re-arrange…" emit a request to open the arrangement settings dialog (the mode is saved only by
 * the dialog); the re-roll button emits a request to re-arrange with the saved settings. Never
 * re-arranges by itself. All controls are disabled without photos.
 */
@Component({
  selector: 'app-arrangement-settings-section',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatSelectModule,
    MatTooltipModule,
  ],
  templateUrl: './arrangement-settings-section.html',
  styleUrl: '../fields/panel-section.scss',
  styles: `
    .rearrange-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .rearrange-button {
      flex: 1;
      min-width: 0;
    }
  `,
})
export class ArrangementSettingsSection {
  readonly mode = input.required<ArrangementMode>();
  readonly photoCount = input(0);

  /**
   * Open the arrangement settings dialog for this mode: the saved mode ("Re-arrange…") or the
   * mode selected in the select.
   */
  readonly openArrangement = output<ArrangementMode>();
  /** Quick re-roll: re-arrange again with the saved settings (no dialog). */
  readonly rearrangeAgain = output<void>();

  private readonly defaults = defaultCollageSettings();
  protected readonly form = inject(NonNullableFormBuilder).group({
    mode: [this.defaults.mode],
  });

  protected readonly canRearrange = computed(() => this.photoCount() > 0);

  constructor() {
    syncFromInput(this.mode, (mode) => this.form.controls.mode.setValue(mode));
    syncFromInput(this.canRearrange, (can) => {
      const control = this.form.controls.mode;
      if (can) {
        control.enable({ emitEvent: false });
      } else {
        control.disable({ emitEvent: false });
      }
    });
  }

  /**
   * Requests the dialog for the selected mode and shows the saved mode again at once. The saved
   * mode changes only through the dialog (Re-arrange); the new mode then comes back through the
   * `mode` input. A reset is needed here because the `mode` input does not change on Cancel.
   */
  protected requestMode(): void {
    this.openArrangement.emit(this.form.controls.mode.value);
    this.form.controls.mode.setValue(this.mode());
  }
}
