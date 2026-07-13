import type { ScheduleItem, ScheduleLane } from './scheduling-types';
import { scheduleElapsedMinutes, scheduleWallPositionForInstant } from './scheduling-time-axis';

/** Timed item bounds clipped to one lane's 24-hour date. */
export interface ScheduleItemLaneBounds {
  readonly startMinutes: number;
  readonly endMinutes: number;
}

/** Return whether exact item bounds are safe to rewrite through one viewer wall-clock lane. */
export function isInlineEditableScheduleItem({
  canPersistBounds,
  allDay,
  startsAt,
  endsAt,
  displayTimezone,
}: {
  readonly canPersistBounds: boolean;
  readonly allDay: boolean;
  readonly startsAt: string | null | undefined;
  readonly endsAt: string | null | undefined;
  readonly displayTimezone: string;
}): boolean {
  if (!canPersistBounds || allDay || !startsAt || !endsAt) return false;
  const elapsedMinutes = scheduleElapsedMinutes(startsAt, endsAt);
  const start = scheduleWallPositionForInstant(startsAt, displayTimezone);
  const end = scheduleWallPositionForInstant(endsAt, displayTimezone);
  return (
    elapsedMinutes !== null &&
    elapsedMinutes > 0 &&
    start !== null &&
    end !== null &&
    start.date === end.date &&
    start.wallMinutes < end.wallMinutes
  );
}

/** Return an ISO instant's `YYYY-MM-DD` date in the required canvas timezone. */
export function dateKeyForInstant(instant: string, displayTimezone: string): string | null {
  return scheduleWallPositionForInstant(instant, displayTimezone)?.date ?? null;
}

/** Find the first lane whose date contains an instant in the shared canvas timezone. */
export function findDateLane(
  lanes: readonly ScheduleLane[],
  instant: string,
  displayTimezone: string,
): ScheduleLane | null {
  const date = dateKeyForInstant(instant, displayTimezone);
  return date ? (lanes.find((lane) => lane.date === date) ?? null) : null;
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
  displayTimezone: string,
): ScheduleItemLaneBounds | null {
  if (item.allDay) return null;
  const start = scheduleWallPositionForInstant(item.startsAt, displayTimezone);
  const end = scheduleWallPositionForInstant(item.endsAt, displayTimezone);
  if (!start || !end || end.date < lane.date || start.date > lane.date) return null;

  const startMinutes = start.date < lane.date ? 0 : start.wallMinutes;
  const endMinutes = end.date > lane.date ? 24 * 60 : end.wallMinutes;
  if (endMinutes <= startMinutes) {
    const elapsedMinutes = scheduleElapsedMinutes(item.startsAt, item.endsAt);
    if (
      start.date !== lane.date ||
      end.date !== lane.date ||
      elapsedMinutes === null ||
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
