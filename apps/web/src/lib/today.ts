/**
 * Format a `Date` as a `YYYY-MM-DD` calendar-day string in the caller's local timezone.
 *
 * @remarks
 * The Hub `today` and daily-plan reads take a `date` query of the shape `z.iso.date()`
 * (a bare calendar day, no time/zone). Using the browser's local components — rather than
 * `Date.toISOString()`, which is UTC — keeps "today" aligned to the user's wall clock, so a
 * late-evening US user does not see tomorrow's plan.
 *
 * @param date - The date to format; defaults to now.
 * @returns the local calendar day as `YYYY-MM-DD`.
 *
 * @example
 * ```ts
 * todayISODate(); // e.g. '2026-06-05'
 * ```
 */
export function todayISODate(date: Date = new Date()): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
