import { Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ConnectorConfigInput, ConnectorSummary, ConnectorType } from '../../core/models/connector';
import { errorMessage } from '../../shared/error-message';
import { connectorTypeLabel } from './connector-types';
import { createImmichConfigGroup, ImmichConfigForm } from './immich-config-form';

/** Maximum length of a connector name (same as the backend). */
const MAX_NAME_LENGTH = 100;

/** Values entered in the connector dialog. */
export interface ConnectorDialogValue {
  type: ConnectorType;
  name: string;
  config: ConnectorConfigInput;
}

/** Input of the connector dialog. */
export interface ConnectorDialogData {
  /** Connector to edit; `null` creates a new Immich connector. */
  connector: ConnectorSummary | null;
  /**
   * Saves the values (done by the page). A rejected promise keeps the dialog open and shows the
   * error; on success the dialog closes with `true`.
   */
  save: (value: ConnectorDialogValue) => Promise<unknown>;
}

/**
 * Create/edit dialog of a connector: common fields (name) plus the form of the connector type.
 * A new type adds its config form component and one `@case`.
 */
@Component({
  selector: 'app-connector-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    ImmichConfigForm,
  ],
  template: `
    <h2 mat-dialog-title>
      @if (isEdit) {
        <ng-container i18n="@@connectors.dialog.editTitle">Edit connector</ng-container>
      } @else {
        <ng-container i18n="@@connectors.dialog.addTitle">Add connector</ng-container>
      }
    </h2>
    <form [formGroup]="form" (ngSubmit)="submit()">
      <mat-dialog-content class="dialog-fields">
        <p class="dialog-type" i18n="@@connectors.dialog.type">Type: {{ typeLabel }}</p>

        <mat-form-field>
          <mat-label i18n="@@connectors.dialog.name">Name</mat-label>
          <input
            matInput
            formControlName="name"
            [maxlength]="maxNameLength"
            required
            cdkFocusInitial
          />
          @if (form.controls.name.hasError('required')) {
            <mat-error i18n="@@connectors.dialog.nameRequired">Name is required</mat-error>
          }
        </mat-form-field>

        @switch (type) {
          @case ('immich') {
            <app-immich-config-form
              [group]="form.controls.config"
              [apiKeySet]="data.connector?.config?.apiKeySet ?? false"
            />
          }
        }

        @if (error(); as message) {
          <p class="dialog-error" role="alert">{{ message }}</p>
        }
      </mat-dialog-content>

      <mat-dialog-actions align="end">
        <button matButton type="button" mat-dialog-close [disabled]="saving()">
          <ng-container i18n="@@connectors.dialog.cancel">Cancel</ng-container>
        </button>
        <button matButton="filled" type="submit" [disabled]="saving()">
          @if (saving()) {
            <mat-spinner class="dialog-spinner" diameter="18" />
          }
          <ng-container i18n="@@connectors.dialog.save">Save</ng-container>
        </button>
      </mat-dialog-actions>
    </form>
  `,
  styles: `
    .dialog-fields {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .dialog-type {
      margin: 0 0 8px;
      color: var(--mat-sys-on-surface-variant);
    }

    .dialog-error {
      margin: 0;
      color: var(--mat-sys-error);
      font: var(--mat-sys-body-medium);
    }

    .dialog-spinner {
      display: inline-block;
      margin-right: 8px;
      vertical-align: middle;
    }
  `,
})
export class ConnectorDialog {
  protected readonly data = inject<ConnectorDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<ConnectorDialog, boolean>>(MatDialogRef);
  private readonly fb = inject(NonNullableFormBuilder);

  protected readonly isEdit = this.data.connector !== null;
  protected readonly type: ConnectorType = this.data.connector?.type ?? 'immich';
  protected readonly typeLabel = connectorTypeLabel(this.type);
  protected readonly maxNameLength = MAX_NAME_LENGTH;

  protected readonly form = this.fb.group({
    name: [this.data.connector?.name ?? '', Validators.required],
    config: createImmichConfigGroup(this.fb, this.data.connector?.config),
  });
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected async submit(): Promise<void> {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }
    const { name, config } = this.form.getRawValue();
    this.setSaving(true);
    this.error.set(null);
    try {
      await this.data.save({ type: this.type, name: name.trim(), config });
      this.ref.close(true);
    } catch (err) {
      this.error.set(errorMessage(err));
      this.setSaving(false);
    }
  }

  private setSaving(saving: boolean): void {
    this.saving.set(saving);
    this.ref.disableClose = saving;
    if (saving) {
      this.form.disable();
    } else {
      this.form.enable();
    }
  }
}
