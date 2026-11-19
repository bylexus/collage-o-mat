import { FormControl, Validators } from '@angular/forms';
import { bytesToGb, gbToBytes } from '../../../shared/storage-size';

/** Validators of the storage limit field (GB, 0 = unlimited). */
export const storageLimitRules = [Validators.required, Validators.min(0)];

/** Form controls of the storage limit in the user dialogs. */
export interface StorageLimitControls {
  /** Checked: the user has no own limit, the server default applies. */
  useDefaultStorage: FormControl<boolean>;
  /** Own limit in GB; disabled while the server default is used. */
  storageLimitGb: FormControl<number>;
}

/** Start values: the own limit, or the server default with the checkbox checked. */
export function storageLimitValues(
  ownBytes: number | null,
  defaultBytes: number,
): { useDefaultStorage: boolean; storageLimitGb: number } {
  return {
    useDefaultStorage: ownBytes === null,
    storageLimitGb: bytesToGb(ownBytes ?? defaultBytes),
  };
}

/**
 * Enables the GB field only if the server default is not used. With the server default, the field
 * shows the default value.
 */
export function applyStorageDefault(controls: StorageLimitControls, defaultBytes: number): void {
  if (controls.useDefaultStorage.value) {
    controls.storageLimitGb.setValue(bytesToGb(defaultBytes), { emitEvent: false });
    controls.storageLimitGb.disable({ emitEvent: false });
  } else {
    controls.storageLimitGb.enable({ emitEvent: false });
  }
}

/** Value of `maxStorageBytes` for the API: `null` = server default, else the own limit in bytes. */
export function storageLimitRequest(
  useDefaultStorage: boolean,
  storageLimitGb: number,
): number | null {
  return useDefaultStorage ? null : gbToBytes(storageLimitGb);
}
