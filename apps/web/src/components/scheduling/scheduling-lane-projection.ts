import { scheduleElapsedMinutes, scheduleWallPositionForInstant } from './scheduling-time-axis';
import type { ScheduleInstantRange, ScheduleLane, ScheduleMinuteBounds } from './scheduling-types';

function repeatedHourProjection(
  sameLane: boolean,
  startMinutes: number,
  endMinutes: number,
  elapsedMinutes: number | null,
): ScheduleMinuteBounds | null | undefined {
  if (
    !sameLane ||
    elapsedMinutes === null ||
    elapsedMinutes <= 0 ||
    endMinutes - startMinutes >= elapsedMinutes
  ) {
    return undefined;
  }
  const repeatedEndMinutes = Math.min(24 * 60, startMinutes + elapsedMinutes);
  return repeatedEndMinutes > startMinutes
    ? { startMinutes, endMinutes: repeatedEndMinutes }
    : null;
}

/**
 * Project an exact instant range onto one lane's wall-clock date.
 *
 * @remarks
 * Multi-day ranges begin at midnight or end at 24:00 as appropriate. Ranges wholly outside the
 * lane return `null`. The canvas display timezone controls every projection; resource metadata on
 * the lane never changes geometry. A repeated fall-back hour preserves positive elapsed duration
 * when its two wall-clock endpoints would otherwise collapse or compress the visible range.
 *
 * @param range - Exact instants to project without any domain-specific item metadata.
 * @param lane - Schedule lane whose date clips the projected bounds.
 * @param displayTimezone - Viewer timezone used by the shared canvas axis.
 * @returns Clipped wall-clock minute bounds, or `null` when the range does not intersect the lane.
 */
export function projectInstantRangeToScheduleLane(
  range: ScheduleInstantRange,
  lane: ScheduleLane,
  displayTimezone: string,
): ScheduleMinuteBounds | null {
  const start = scheduleWallPositionForInstant(range.startsAt, displayTimezone);
  const end = scheduleWallPositionForInstant(range.endsAt, displayTimezone);
  if (!start || !end || end.date < lane.date || start.date > lane.date) return null;
  const startMinutes = start.date < lane.date ? 0 : start.wallMinutes;
  const endMinutes = end.date > lane.date ? 24 * 60 : end.wallMinutes;
  const elapsedMinutes = scheduleElapsedMinutes(range.startsAt, range.endsAt);
  const repeated = repeatedHourProjection(
    start.date === lane.date && end.date === lane.date,
    startMinutes,
    endMinutes,
    elapsedMinutes,
  );
  if (repeated !== undefined) return repeated;
  if (endMinutes <= startMinutes) return null;
  return { startMinutes, endMinutes };
}
