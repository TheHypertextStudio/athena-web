import type { ScheduleItem, ScheduleLane } from './scheduling-types';
import {
  scheduleDateRange,
  scheduleElapsedMinutes,
  scheduleWallPositionForInstant,
} from './scheduling-time-axis';

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
  return elapsedMinutes !== null && elapsedMinutes > 0 && start !== null && end !== null;
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
  const elapsedMinutes = scheduleElapsedMinutes(item.startsAt, item.endsAt);
  if (
    start.date === lane.date &&
    end.date === lane.date &&
    elapsedMinutes !== null &&
    elapsedMinutes > 0 &&
    endMinutes - startMinutes < elapsedMinutes
  ) {
    const repeatedEndMinutes = Math.min(24 * 60, startMinutes + elapsedMinutes);
    return repeatedEndMinutes > startMinutes
      ? { startMinutes, endMinutes: repeatedEndMinutes }
      : null;
  }
  if (endMinutes <= startMinutes) return null;
  return { startMinutes, endMinutes };
}

/** Return whether lane and item policy permit pointer edits. */
export function isScheduleItemEditable(item: ScheduleItem, lane: ScheduleLane): boolean {
  return (lane.editable ?? true) && (item.editable ?? true);
}

/** Direct-manipulation controls that belong to one clipped timed-item segment. */
export interface ScheduleItemEditCapabilities {
  readonly canMove: boolean;
  readonly canResizeStart: boolean;
  readonly canResizeEnd: boolean;
}

/**
 * Place move and resize controls only on the segment that owns the corresponding exact edge.
 *
 * @remarks
 * Cross-midnight and multi-day events render once per intersecting lane. Keeping movement and the
 * start handle on the true start lane—and the end handle on the true end lane—prevents a clipped
 * continuation segment from rewriting the wrong instant. An end at 24:00 belongs to the preceding
 * visible lane because the following lane has no positive-duration segment to render.
 */
export function scheduleItemEditCapabilities(
  item: ScheduleItem,
  lane: ScheduleLane,
  displayTimezone: string,
): ScheduleItemEditCapabilities {
  const unavailable = { canMove: false, canResizeStart: false, canResizeEnd: false } as const;
  if (item.allDay || !isScheduleItemEditable(item, lane)) return unavailable;
  const start = scheduleWallPositionForInstant(item.startsAt, displayTimezone);
  const end = scheduleWallPositionForInstant(item.endsAt, displayTimezone);
  if (!start || !end) return unavailable;

  const ownsStart = start.date === lane.date;
  const laneEnd = scheduleDateRange(lane.date, 1, displayTimezone).endISO;
  const ownsEnd =
    (end.date === lane.date && end.wallMinutes > 0) ||
    scheduleElapsedMinutes(item.endsAt, laneEnd) === 0;
  return {
    canMove: ownsStart,
    canResizeStart: ownsStart,
    canResizeEnd: ownsEnd,
  };
}
