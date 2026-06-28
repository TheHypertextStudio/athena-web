/**
 * Time tracking route helpers.
 *
 * @packageDocumentation
 */

const MINUTES_PER_HOUR = 60;

export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  const remainingMinutes = minutes % MINUTES_PER_HOUR;
  return `${String(hours)}h ${String(remainingMinutes)}m`;
}
