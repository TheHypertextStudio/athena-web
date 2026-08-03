/**
 * The app's day formatters — the only sanctioned way to turn a stored date into screen text.
 *
 * @remarks
 * `new Date(value).toLocaleDateString(...)` is a trap this codebase has already fallen into:
 * when `value` is not parseable the call returns the *string* `"Invalid Date"`, React renders it
 * as ordinary text, and the person sees a rendering bug where a due date should be. It shipped
 * on the global task list, where a full ISO instant was concatenated with `T00:00:00` before
 * parsing.
 *
 * These helpers make that outcome unreachable. They accept whatever the API actually returns for
 * a "date" field — a `YYYY-MM-DD` day *or* a full ISO instant, since the underlying columns are
 * `timestamp` — read the calendar day off the front without shifting it into the viewer's zone,
 * and return `null` when there is nothing valid to show. A caller then owns its own empty state
 * (`—`, "No due date", or nothing at all), which is what the application-owned-copy rule
 * requires anyway.
 */
import { TASK_DATE_MAX, TASK_DATE_MIN } from '@docket/types';
import { formatCalendarDay, toCalendarDay } from '@docket/ui/components';

/**
 * The earliest day any picker in the app offers.
 *
 * @remarks
 * Re-exported from `@docket/types` rather than restated, so the picker's floor and the DTO's
 * validation floor cannot drift apart. A person can therefore never select a day the API will
 * reject — the 1799 and 3999 dates that reached the database, and visibly destroyed the project
 * timeline axis, were entered through pickers that had no bounds at all.
 */
export const DATE_PICKER_MIN = TASK_DATE_MIN;

/** The latest day any picker in the app offers. See {@link DATE_PICKER_MIN}. */
export const DATE_PICKER_MAX = TASK_DATE_MAX;

/**
 * Read the calendar day out of an API date value.
 *
 * @param value - A `YYYY-MM-DD` day, a full ISO instant, `null`, or `undefined`.
 * @returns The `YYYY-MM-DD` day, or `null` when the value carries none.
 */
export function toDay(value: string | null | undefined): string | null {
  return toCalendarDay(value);
}

/**
 * Format a stored date for display.
 *
 * @param value - A `YYYY-MM-DD` day, a full ISO instant, `null`, or `undefined`.
 * @param options - `Intl.DateTimeFormat` options; defaults to a short "Aug 2, 2026".
 * @returns The formatted day, or `null` when there is nothing valid to show.
 */
export function formatDay(
  value: string | null | undefined,
  options?: Intl.DateTimeFormatOptions,
): string | null {
  return formatCalendarDay(value, options);
}

/**
 * Format a start→end window for display.
 *
 * @remarks
 * Returns `null` only when *neither* end is readable; a half-open window still deserves to be
 * shown, so a missing end renders as an em dash rather than swallowing the start.
 *
 * @param start - The window's first day.
 * @param end - The window's last day.
 * @param options - `Intl.DateTimeFormat` options applied to both ends.
 * @returns The formatted window, or `null` when neither end is readable.
 */
export function formatDayRange(
  start: string | null | undefined,
  end: string | null | undefined,
  options?: Intl.DateTimeFormatOptions,
): string | null {
  const from = formatCalendarDay(start, options);
  const to = formatCalendarDay(end, options);
  if (from === null && to === null) return null;
  if (from !== null && to === null) return `${from} → —`;
  if (from === null && to !== null) return `— → ${to}`;
  return `${from} → ${to}`;
}
