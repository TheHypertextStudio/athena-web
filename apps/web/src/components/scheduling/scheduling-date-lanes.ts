import type { ScheduleItem, ScheduleLane } from './scheduling-types';

/** Timed item bounds clipped to one lane's 24-hour date. */
export interface ScheduleItemLaneBounds {
  readonly startMinutes: number;
  readonly endMinutes: number;
}

interface ZonedDateParts {
  readonly date: string;
  readonly minutes: number;
}

/** Convert an instant to its date and minute-of-day in an optional IANA timezone. */
function zonedDateParts(instant: string, timezone?: string): ZonedDateParts | null {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return null;

  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-CA', {
      ...(timezone ? { timeZone: timezone } : {}),
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
  } catch {
    return null;
  }
  const parts = new Map(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  const year = parts.get('year');
  const month = parts.get('month');
  const day = parts.get('day');
  const hour = Number(parts.get('hour'));
  const minute = Number(parts.get('minute'));
  if (!year || !month || !day || !Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return { date: `${year}-${month}-${day}`, minutes: hour * 60 + minute };
}

/** Return an ISO instant's `YYYY-MM-DD` date in an optional IANA timezone. */
export function dateKeyForInstant(instant: string, timezone?: string): string | null {
  return zonedDateParts(instant, timezone)?.date ?? null;
}

/** Find the first arbitrary lane whose date contains an instant in that lane's timezone. */
export function findDateLane(lanes: readonly ScheduleLane[], instant: string): ScheduleLane | null {
  return lanes.find((lane) => dateKeyForInstant(instant, lane.timezone) === lane.date) ?? null;
}

/**
 * Clip a timed item to a lane's date and return minute-of-day geometry.
 *
 * Multi-day items begin at midnight or end at 24:00 as appropriate. Items wholly outside the lane
 * return `null`; all-day items are intentionally excluded from timed placement. An explicit
 * display timezone overrides resource metadata so every lane shares the canvas wall-clock axis.
 *
 * @param item - Timed item whose exact instants are being placed.
 * @param lane - Date lane that clips the resulting wall-clock bounds.
 * @param displayTimezone - Viewer timezone used by the shared canvas axis.
 * @returns Clipped wall-clock bounds, or `null` when the item is not placeable in this lane.
 */
export function itemBoundsInLane(
  item: ScheduleItem,
  lane: ScheduleLane,
  displayTimezone = lane.timezone,
): ScheduleItemLaneBounds | null {
  if (item.allDay) return null;
  const start = zonedDateParts(item.startsAt, displayTimezone);
  const end = zonedDateParts(item.endsAt, displayTimezone);
  if (!start || !end || end.date < lane.date || start.date > lane.date) return null;

  const startMinutes = start.date < lane.date ? 0 : start.minutes;
  const endMinutes = end.date > lane.date ? 24 * 60 : end.minutes;
  if (endMinutes <= startMinutes) {
    const elapsedMinutes =
      (new Date(item.endsAt).getTime() - new Date(item.startsAt).getTime()) / 60_000;
    if (
      start.date !== lane.date ||
      end.date !== lane.date ||
      !Number.isFinite(elapsedMinutes) ||
      elapsedMinutes <= 0
    ) {
      return null;
    }
    const repeatedEndMinutes = Math.min(24 * 60, startMinutes + elapsedMinutes);
    return repeatedEndMinutes > startMinutes
      ? { startMinutes, endMinutes: repeatedEndMinutes }
      : null;
  }
  return { startMinutes, endMinutes };
}

/** Return whether lane and item policy permit pointer edits. */
export function isScheduleItemEditable(item: ScheduleItem, lane: ScheduleLane): boolean {
  return (lane.editable ?? true) && (item.editable ?? true);
}
