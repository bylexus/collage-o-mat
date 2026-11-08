import { Component, input, output } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';

/**
 * Native colour picker with a label. Emits `committed` on the native `change` event (when the
 * picker value is confirmed), not while the colour is dragged.
 */
@Component({
  selector: 'app-color-field',
  imports: [ReactiveFormsModule],
  template: `
    <label class="color-field">
      <input type="color" [formControl]="control()" (change)="committed.emit()" />
      <span>{{ label() }}</span>
    </label>
  `,
  styles: `
    .color-field {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
    }

    input {
      width: 40px;
      height: 32px;
      padding: 0 2px;
      border: 1px solid var(--mat-sys-outline);
      border-radius: 4px;
      background: none;
      cursor: pointer;
    }
  `,
})
export class ColorField {
  readonly control = input.required<FormControl<string>>();
  readonly label = input.required<string>();
  readonly committed = output<void>();
}
