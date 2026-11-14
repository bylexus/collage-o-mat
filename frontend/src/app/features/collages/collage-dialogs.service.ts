import { inject, Injectable } from '@angular/core';
import { MatDialog, MatDialogConfig } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { COLLAGE_NAME_MAX_LENGTH, CreateCollageRequest } from '../../core/models/collage';
import { CollageCreateDialog } from './collage-create-dialog';
import { CollageNameDialog, CollageNameDialogData } from './collage-name-dialog';

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
    return this.askName({
      name: currentName,
      title: $localize`:@@collages.rename.title:Rename collage`,
      submitLabel: $localize`:@@collages.rename.submit:Rename`,
    });
  }

  /**
   * Asks for the name of a copy, prefilled with `"<sourceName> (copy)"`. Resolves the (trimmed)
   * name, or `undefined` if the user cancels.
   */
  duplicate(sourceName: string): Promise<string | undefined> {
    return this.askName({
      name: copyName(sourceName),
      title: $localize`:@@collages.duplicate.title:Duplicate collage`,
      submitLabel: $localize`:@@collages.duplicate.submit:Duplicate`,
    });
  }

  private askName(data: CollageNameDialogData): Promise<string | undefined> {
    const ref = this.dialog.open<CollageNameDialog, CollageNameDialogData, string>(
      CollageNameDialog,
      { ...DIALOG_SIZE, data },
    );
    return firstValueFrom(ref.afterClosed());
  }
}

/**
 * Default name of a copy: the source name plus the localized suffix " (copy)". If the result is
 * longer than `COLLAGE_NAME_MAX_LENGTH`, the source name is cut so that it fits. Lengths are counted
 * in Unicode code points, as in the backend.
 */
function copyName(sourceName: string): string {
  const suffix = $localize`:@@collages.duplicate.defaultNameSuffix: (copy)`;
  const sourceChars = Array.from(sourceName);
  const room = COLLAGE_NAME_MAX_LENGTH - Array.from(suffix).length;
  if (sourceChars.length <= room) {
    return sourceName + suffix;
  }
  return sourceChars.slice(0, Math.max(room, 0)).join('').trimEnd() + suffix;
}
