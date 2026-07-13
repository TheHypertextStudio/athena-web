/**
 * Time-of-day formatting + parsing helpers.
 *
 * @remarks
 * The shared home for wall-clock time rendering, so components don't each redefine
 * `toLocaleTimeString` / `padStart` one-offs. {@link formatClock} renders an instant as a locale
 * 12-hour label; {@link clockValue} and {@link toISODateTime} round-trip an instant through an
 * `<input type="time">` value; {@link formatHour} labels an hour slot on a timeline.
 *
 * @see {@link formatCalendarDate} in `./format-date` for the calendar-day counterpart.
 */

/** Format an ISO instant as a locale wall-clock label, e.g. `9:30 AM`. */
export function formatClock(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(iso));
}

/** The local `HH:mm` (24h) value of an ISO instant, for an `<input type="time">`. */
export function clockValue(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Combine a `YYYY-MM-DD` day and a `HH:mm` clock into an ISO instant (parsed as local time). */
export function toISODateTime(date: string, clock: string): string {
  return new Date(`${date}T${clock}:00`).toISOString();
}

/** Format an hour (0–23) as a compact 12-hour label, e.g. `9 AM`. */
export function formatHour(hour: number): string {
  const period = hour < 12 ? 'AM' : 'PM';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${String(display)} ${period}`;
}
