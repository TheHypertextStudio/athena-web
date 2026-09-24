/** Calendar dates are parsed as local date parts without a UTC conversion. */
interface DatePoint {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

const BARE_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function datePoint(value: string): DatePoint | null {
  const match = BARE_DATE.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return { year, month, day };
}

function monthName(point: DatePoint, style: 'long' | 'short'): string {
  return new Intl.DateTimeFormat(undefined, { month: style }).format(
    new Date(point.year, point.month - 1, 1),
  );
}

function dateOrder(point: DatePoint): number {
  return point.year * 10_000 + point.month * 100 + point.day;
}

function tinyRange(start: DatePoint, end: DatePoint): string {
  if (start.year !== end.year || start.month !== end.month) {
    return `${String(start.month)}/${String(start.day)}–${String(end.month)}/${String(end.day)}`;
  }
  return start.day === end.day
    ? `${String(start.month)}/${String(start.day)}`
    : `${String(start.day)}–${String(end.day)}`;
}

function shortRange(start: DatePoint, end: DatePoint): string {
  const firstMonth = monthName(start, 'short');
  if (start.year !== end.year || start.month !== end.month) {
    return `${firstMonth} ${String(start.day)} – ${monthName(end, 'short')} ${String(end.day)}`;
  }
  return start.day === end.day
    ? `${firstMonth} ${String(start.day)}`
    : `${firstMonth} ${String(start.day)}–${String(end.day)}`;
}

function longRange(start: DatePoint, end: DatePoint): string {
  const firstMonth = monthName(start, 'long');
  if (start.year !== end.year) {
    return `${firstMonth} ${String(start.day)}, ${String(start.year)} – ${monthName(end, 'long')} ${String(end.day)}, ${String(end.year)}`;
  }
  if (start.month !== end.month) {
    return `${firstMonth} ${String(start.day)} – ${monthName(end, 'long')} ${String(end.day)}, ${String(end.year)}`;
  }
  return start.day === end.day
    ? `${firstMonth} ${String(start.day)}, ${String(start.year)}`
    : `${firstMonth} ${String(start.day)}–${String(end.day)}, ${String(start.year)}`;
}

/**
 * Describe the inclusive dates currently visible in Calendar's lanes.
 *
 * @param startDate - First visible local date as `YYYY-MM-DD`.
 * @param endDate - Last visible local date as `YYYY-MM-DD`.
 * @param style - Controls the visible label's width; the full form remains the accessible name.
 * @returns A localized range, or an empty label for invalid bounds.
 */
export function calendarRangeLabel(
  startDate: string,
  endDate: string,
  style: 'long' | 'short' | 'tiny' = 'long',
): string {
  const first = datePoint(startDate);
  const last = datePoint(endDate);
  if (!first && !last) return '';
  const initial = first ?? last;
  const final = last ?? first;
  if (!initial || !final) return '';
  const reversed = dateOrder(final) < dateOrder(initial);
  const start = reversed ? final : initial;
  const end = reversed ? initial : final;
  if (style === 'tiny') return tinyRange(start, end);
  if (style === 'short') return shortRange(start, end);
  return longRange(start, end);
}
