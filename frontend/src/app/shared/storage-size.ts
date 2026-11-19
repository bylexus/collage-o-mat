/** Bytes per GB in the UI (decimal unit, same as the server: 1 GB = 10^9 bytes). */
export const BYTES_PER_GB = 1_000_000_000;

/** Bytes per MB in the UI (decimal unit: 1 MB = 10^6 bytes). */
export const BYTES_PER_MB = 1_000_000;

/** Converts bytes to GB (for number fields). */
export function bytesToGb(bytes: number): number {
  return bytes / BYTES_PER_GB;
}

/** Converts GB (from number fields) to whole bytes. */
export function gbToBytes(gb: number): number {
  return Math.round(gb * BYTES_PER_GB);
}

/**
 * Formats a size in GB with at most two decimals in the current locale, e.g. "1.23 GB", "2 GB".
 * A size above 0 that rounds to 0 shows as "< 0.01 GB".
 */
export function formatGb(bytes: number): string {
  if (bytes > 0 && bytes < BYTES_PER_GB / 200) {
    const min = formatNumber(0.01);
    return $localize`:@@shared.storage.lessThanGb:< ${min}:size: GB`;
  }
  const size = formatNumber(bytesToGb(bytes));
  return $localize`:@@shared.storage.gb:${size}:size: GB`;
}

/**
 * Formats a stored size in MB below 1 GB and in GB from 1 GB, with at most two decimals in the
 * current locale, e.g. "0 MB", "24.6 MB", "1.23 GB".
 */
export function formatStorageSize(bytes: number): string {
  if (bytes >= BYTES_PER_GB) {
    return formatGb(bytes);
  }
  const size = formatNumber(bytes / BYTES_PER_MB);
  return $localize`:@@shared.storage.mb:${size}:size: MB`;
}

/** Formats a storage limit: "2 GB", or "unlimited" for 0. */
export function formatStorageLimit(bytes: number): string {
  return bytes > 0 ? formatGb(bytes) : $localize`:@@shared.storage.unlimited:unlimited`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat($localize.locale ?? 'en', { maximumFractionDigits: 2 }).format(
    value,
  );
}
