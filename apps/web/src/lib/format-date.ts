/**
 * Calendar-date formatting that is correct across timezones.
 *
 * @remarks
 * Many wire fields are *bare calendar dates* of the shape `z.iso.date()` — `YYYY-MM-DD`,
 * with no time or zone (a task's `dueDate`, a project's `startDate`/`targetDate`, a
 * milestone's `targetDate`). `new Date('2026-06-20')` parses that as **UTC midnight**, so
 * rendering it with a locale formatter in a behind-UTC zone (e.g. the Americas) rolls it
 * back a day — `2026-06-20` reads as "Jun 19". This module formats a bare calendar date as
 * that *same* calendar day regardless of the viewer's timezone, while still rendering full
 * ISO timestamps (which carry their own zone) in local time as usual.
 *
 * @see {@link todayISODate} for the inverse — emitting today's local calendar day.
 */

/** Matches a bare calendar date (`YYYY-MM-DD`) with no time component. */
const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The default short, locale-aware day options (e.g. `Jun 20, 2026`). */
const FULL_DAY_OPTIONS: Intl.DateTimeFormatOptions = {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
};

/**
 * Parse a value into a `Date` that renders as the intended calendar day.
 *
 * @remarks
 * For a bare `YYYY-MM-DD` the components are read as **local** time (so the day never shifts
 * under timezone conversion); for anything else (a full ISO timestamp) the native parse is
 * used, since the instant already carries its own zone.
 *
 * @param value - The wire date/timestamp string.
 * @returns the parsed `Date`, or `null` when absent or unparseable.
 */
function parseDate(value: string): Date | null {
  if (BARE_DATE.test(value)) {
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(5, 7));
    const day = Number(value.slice(8, 10));
    const date = new Date(year, month - 1, day);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Format a wire date as a short, locale-aware calendar day, or `null` when absent.
 *
 * @remarks
 * A bare `YYYY-MM-DD` renders as that same calendar day in every timezone; a full ISO
 * timestamp renders in the viewer's local zone.
 *
 * @param value - The ISO date or date-time string, or null/undefined when unset.
 * @param options - Optional `Intl.DateTimeFormat` overrides (defaults to `Jun 20, 2026`).
 * @returns the formatted day, or `null` when no value is set or it cannot be parsed.
 *
 * @example
 * ```ts
 * formatCalendarDate('2026-06-20');           // 'Jun 20, 2026' (in any timezone)
 * formatCalendarDate('2026-06-20', { month: 'short', day: 'numeric' }); // 'Jun 20'
 * formatCalendarDate(null);                   // null
 * ```
 */
export function formatCalendarDate(
  value: string | null | undefined,
  options: Intl.DateTimeFormatOptions = FULL_DAY_OPTIONS,
): string | null {
  if (!value) return null;
  const date = parseDate(value);
  if (!date) return null;
  return date.toLocaleDateString(undefined, options);
}
