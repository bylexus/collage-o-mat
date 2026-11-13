import { Component, input, output } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { NumberLimits } from '../../../shared/number-limits';

/**
 * Compact numeric form field with a range error. Emits `committed` on the native `change` event
 * (blur after an edit, Enter, spinner click), not on every keystroke.
 */
@Component({
  selector: 'app-number-field',
  imports: [ReactiveFormsModule, MatFormFieldModule, MatInputModule],
  template: `
    <mat-form-field subscriptSizing="dynamic" [floatLabel]="placeholder() ? 'always' : 'auto'">
      <mat-label>{{ label() }}</mat-label>
      <input
        matInput
        type="number"
        [formControl]="control()"
        [attr.min]="limits().min"
        [attr.max]="limits().max"
        [attr.step]="limits().step"
        [placeholder]="placeholder()"
        (change)="committed.emit()"
      />
      @if (control().hasError('integer')) {
        <mat-error i18n="@@editor.settings.integerRangeError">
          Enter a whole number from {{ limits().min }} to {{ limits().max }}
        </mat-error>
      } @else {
        <mat-error i18n="@@editor.settings.rangeError">
          Enter a value from {{ limits().min }} to {{ limits().max }}
        </mat-error>
      }
    </mat-form-field>
  `,
  styles: `
    :host {
      display: block;
    }

    mat-form-field {
      width: 100%;
    }
  `,
})
export class NumberField {
  readonly control = input.required<FormControl<number> | FormControl<number | null>>();
  readonly label = input.required<string>();
  readonly limits = input.required<NumberLimits>();
  /** Shown in the empty field (the label then floats above it). */
  readonly placeholder = input('');
  readonly committed = output<void>();
}
