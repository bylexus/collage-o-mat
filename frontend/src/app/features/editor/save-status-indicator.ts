import { Component, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { SaveStatus } from './auto-saver';

/** Icon and text of the auto-save state (presentational). */
@Component({
  selector: 'app-save-status-indicator',
  imports: [MatIconModule],
  template: `
    @switch (status()) {
      @case ('saved') {
        <mat-icon>cloud_done</mat-icon>
        <span i18n="@@editor.saveStatus.saved">Saved</span>
      }
      @case ('pending') {
        <mat-icon>pending</mat-icon>
        <span i18n="@@editor.saveStatus.pending">Unsaved changes</span>
      }
      @case ('saving') {
        <mat-icon>cloud_upload</mat-icon>
        <span i18n="@@editor.saveStatus.saving">Saving…</span>
      }
      @case ('error') {
        <mat-icon>cloud_off</mat-icon>
        <span i18n="@@editor.saveStatus.error">Not saved</span>
      }
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-label-large);
      white-space: nowrap;
    }

    :host(.error) {
      color: var(--mat-sys-error);
    }

    mat-icon {
      font-size: 20px;
      width: 20px;
      height: 20px;
    }
  `,
  host: { role: 'status', '[class.error]': "status() === 'error'" },
})
export class SaveStatusIndicator {
  readonly status = input.required<SaveStatus>();
}
