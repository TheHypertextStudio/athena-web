/**
 * Duration copy for the timer and its reports.
 *
 * @remarks
 * Two formats, for two different jobs. A running timer is watched, so it shows seconds and keeps
 * a fixed number of digits — a clock that changes width every second drags the controls beside it
 * back and forth. A report is read, so it shows hours and minutes: nobody reflecting on a week
 * wants "7h 12m 41s", and the seconds imply a precision the rounding does not have.
 */

/** Pad to two digits without pulling in a formatter. */
function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/**
 * A running clock: `H:MM:SS`, or `MM:SS` under an hour.
 *
 * @param ms - Elapsed milliseconds.
 * @returns the clock face.
 */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

/**
 * A reported total: `7h 12m`, `48m`, or `0m`.
 *
 * @remarks
 * Returns `0m` rather than an empty string for zero, so a bucket that genuinely recorded nothing
 * reads as a measured zero instead of a missing value.
 *
 * @param ms - Total milliseconds.
 * @returns the human-readable total.
 */
export function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours === 0) return `${remainder}m`;
  if (remainder === 0) return `${hours}h`;
  return `${hours}h ${remainder}m`;
}

/**
 * A spoken duration for assistive technology: "1 hour 12 minutes".
 *
 * @param ms - Total milliseconds.
 * @returns the accessible label.
 */
export function spokenDuration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
  if (remainder > 0 || hours === 0) {
    parts.push(`${remainder} minute${remainder === 1 ? '' : 's'}`);
  }
  return parts.join(' ');
}
