import { inject, Injectable } from '@angular/core';
import { MatDialog, MatDialogConfig } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { CreateCollageRequest } from '../../core/models/collage';
import { CollageCreateDialog } from './collage-create-dialog';
import { CollageRenameDialog, CollageRenameDialogData } from './collage-rename-dialog';

const DIALOG_SIZE: MatDialogConfig = { width: '440px', maxWidth: 'calc(100vw - 32px)' };

/** Opens the collage dialogs. The dialogs only collect input; the caller calls the API. */
@Injectable({ providedIn: 'root' })
export class CollageDialogs {
  private readonly dialog = inject(MatDialog);

  /** Resolves the create request, or `undefined` if the user cancels. */
  create(): Promise<CreateCollageRequest | undefined> {
    const ref = this.dialog.open<CollageCreateDialog, void, CreateCollageRequest>(
      CollageCreateDialog,
      DIALOG_SIZE,
    );
    return firstValueFrom(ref.afterClosed());
  }

  /** Resolves the new (trimmed) name, or `undefined` if the user cancels. */
  rename(currentName: string): Promise<string | undefined> {
    const ref = this.dialog.open<CollageRenameDialog, CollageRenameDialogData, string>(
      CollageRenameDialog,
      { ...DIALOG_SIZE, data: { name: currentName } },
    );
    return firstValueFrom(ref.afterClosed());
  }
}
