import { inject, Injectable } from '@angular/core';
import { MatDialog, MatDialogConfig } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { AdminUser } from '../../../core/models/admin';
import { UserCreateDialog, UserCreateDialogData } from './user-create-dialog';
import { UserDeleteDialog, UserDeleteDialogData } from './user-delete-dialog';
import { UserEditDialog, UserEditDialogData, UserEditDialogResult } from './user-edit-dialog';

const DIALOG_SIZE: MatDialogConfig = { width: '480px', maxWidth: 'calc(100vw - 32px)' };

/**
 * Opens the user management dialogs. The dialogs only collect input; the caller gives the
 * functions that call the API.
 */
@Injectable({ providedIn: 'root' })
export class AdminDialogs {
  private readonly dialog = inject(MatDialog);

  /** Resolves `true` if the user was created. */
  async create(data: UserCreateDialogData): Promise<boolean> {
    const ref = this.dialog.open<UserCreateDialog, UserCreateDialogData, boolean>(
      UserCreateDialog,
      { ...DIALOG_SIZE, data },
    );
    return (await firstValueFrom(ref.afterClosed())) === true;
  }

  /** Resolves what happened in the dialog, or `undefined` on cancel. */
  edit(data: UserEditDialogData): Promise<UserEditDialogResult | undefined> {
    const ref = this.dialog.open<UserEditDialog, UserEditDialogData, UserEditDialogResult>(
      UserEditDialog,
      { ...DIALOG_SIZE, data },
    );
    return firstValueFrom(ref.afterClosed());
  }

  /** Resolves `true` if the user was deleted. */
  async confirmDelete(user: AdminUser, remove: () => Promise<unknown>): Promise<boolean> {
    const ref = this.dialog.open<UserDeleteDialog, UserDeleteDialogData, boolean>(
      UserDeleteDialog,
      { ...DIALOG_SIZE, data: { user, remove } },
    );
    return (await firstValueFrom(ref.afterClosed())) === true;
  }
}
