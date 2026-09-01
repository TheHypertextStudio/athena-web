/** The units the formatter steps through, smallest first. */
const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const;

/** The step between units. Decimal, matching how storage providers bill and report. */
const STEP = 1000;

/**
 * Render a byte count at a scale a person can read.
 *
 * @remarks
 * Decimal units, because every provider this console reports on — Vercel Blob, Neon, Cloud Run —
 * bills and reports in them, and a console that disagreed with the invoice by 7% per step would be
 * worse than useless.
 *
 * One decimal place above kilobytes and none below, so a size stays roughly three significant
 * figures wide and a column of them stays scannable.
 *
 * @param bytes - The size in bytes. Negative input is treated as zero.
 * @returns the size with its unit, e.g. `0 B`, `4.1 KB`, `2.3 GB`.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';

  let value = bytes;
  let unit = 0;
  while (value >= STEP && unit < UNITS.length - 1) {
    value /= STEP;
    unit += 1;
  }

  const digits = unit === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${UNITS[unit] ?? 'B'}`;
}
