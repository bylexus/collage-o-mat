import { Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { firstValueFrom } from 'rxjs';
import { AdminApi } from '../../../core/api/admin.api';
import { SystemSettings } from '../../../core/models/admin';
import { errorMessage } from '../../../shared/error-message';
import { NotificationService } from '../../../shared/notification.service';
import { bytesToGb, gbToBytes } from '../../../shared/storage-size';

/** Admin tab "Settings": system-wide settings (storage limit per user). */
@Component({
  selector: 'app-admin-settings-page',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './admin-settings.page.html',
  styleUrl: './admin-settings.page.scss',
})
export class AdminSettingsPage {
  private readonly api = inject(AdminApi);
  private readonly notification = inject(NotificationService);

  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly saving = signal(false);

  protected readonly form = inject(NonNullableFormBuilder).group({
    maxUserStorageGb: [0, [Validators.required, Validators.min(0)]],
  });

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      this.apply(await firstValueFrom(this.api.getSettings()));
    } catch (err) {
      this.loadError.set(
        errorMessage(err, $localize`:@@admin.settings.loadError:Could not load the settings.`),
      );
    } finally {
      this.loading.set(false);
    }
  }

  protected async save(): Promise<void> {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }
    const gb = this.form.controls.maxUserStorageGb.value;
    const settings: SystemSettings = { maxUserStorageBytes: gbToBytes(gb) };
    this.saving.set(true);
    this.form.disable();
    try {
      const stored = await firstValueFrom(this.api.updateSettings(settings));
      this.form.enable();
      this.apply(stored);
      this.notification.success($localize`:@@admin.settings.saved:Settings saved`);
    } catch (err) {
      this.form.enable();
      this.notification.error(
        errorMessage(err, $localize`:@@admin.settings.saveError:Could not save the settings.`),
      );
    } finally {
      this.saving.set(false);
    }
  }

  private apply(settings: SystemSettings): void {
    this.form.reset({ maxUserStorageGb: bytesToGb(settings.maxUserStorageBytes) });
  }
}
