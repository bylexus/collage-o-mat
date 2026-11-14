import { inject, Injectable } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import {
  ArrangementSettingsDialog,
  ArrangementSettingsDialogData,
  ArrangementSettingsDialogResult,
} from './arrangement-settings-dialog';

/** Opens the arrangement settings dialog. */
@Injectable({ providedIn: 'root' })
export class ArrangementSettingsDialogService {
  private readonly dialog = inject(MatDialog);

  /** Resolves the new settings if the user clicks "Re-arrange", else `undefined`. */
  async open(
    data: ArrangementSettingsDialogData,
  ): Promise<ArrangementSettingsDialogResult | undefined> {
    const ref = this.dialog.open<
      ArrangementSettingsDialog,
      ArrangementSettingsDialogData,
      ArrangementSettingsDialogResult
    >(ArrangementSettingsDialog, {
      data,
      width: '400px',
      maxWidth: 'calc(100vw - 32px)',
    });
    return firstValueFrom(ref.afterClosed());
  }
}
