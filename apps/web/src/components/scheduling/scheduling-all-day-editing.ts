import { Temporal } from '@js-temporal/polyfill';

import { isScheduleItemEditable } from './scheduling-date-lanes';
import { scheduleWallPositionForInstant } from './scheduling-time-axis';
import type { ScheduleItem, ScheduleLane } from './scheduling-types';

/** One valid all-day range expressed as inclusive start and exclusive end dates. */
export interface ScheduleAllDayRange {
  readonly startDate: string;
  readonly endDate: string;
  readonly durationDays: number;
}

/** Edit controls owned by one visible segment of a potentially multi-day item. */
export interface ScheduleAllDayEditCapabilities {
  readonly canMove: boolean;
  readonly canResizeStart: boolean;
  readonly canResizeEnd: boolean;
}

/** Direct-manipulation preview for an all-day item. */
export interface ScheduleAllDayGesturePreview {
  readonly laneIndex: number;
  readonly startDate: string;
  readonly endDate: string;
}

/** One direct-manipulation operation supported by an all-day item. */
export type ScheduleAllDayGestureMode = 'move' | 'resize-start' | 'resize-end';

/** Shift one ISO calendar date without using elapsed milliseconds across DST boundaries. */
export function shiftScheduleDate(date: string, days: number): string {
  return Temporal.PlainDate.from(date).add({ days }).toString();
}

/** Derive a strict local-midnight date range for an all-day item. */
export function scheduleAllDayRange(
  item: ScheduleItem,
  displayTimezone: string,
): ScheduleAllDayRange | null {
  if (!item.allDay) return null;
  const start = scheduleWallPositionForInstant(item.startsAt, displayTimezone);
  const end = scheduleWallPositionForInstant(item.endsAt, displayTimezone);
  if (!start || !end || start.wallMinutes !== 0 || end.wallMinutes !== 0) return null;
  const startDate = Temporal.PlainDate.from(start.date);
  const endDate = Temporal.PlainDate.from(end.date);
  const durationDays = startDate.until(endDate, { largestUnit: 'day' }).days;
  return durationDays > 0 ? { startDate: start.date, endDate: end.date, durationDays } : null;
}

/** Put move/start controls on the true first segment and end controls on the true last segment. */
export function scheduleAllDayEditCapabilities(
  item: ScheduleItem,
  lane: ScheduleLane,
  displayTimezone: string,
): ScheduleAllDayEditCapabilities {
  const unavailable = { canMove: false, canResizeStart: false, canResizeEnd: false } as const;
  if (!isScheduleItemEditable(item, lane)) return unavailable;
  const range = scheduleAllDayRange(item, displayTimezone);
  if (!range) return unavailable;
  const finalDate = shiftScheduleDate(range.endDate, -1);
  return {
    canMove: lane.date === range.startDate,
    canResizeStart: lane.date === range.startDate,
    canResizeEnd: lane.date === finalDate,
  };
}

/** Derive one valid preview from a target lane while preserving exclusive-end semantics. */
export function deriveAllDayGesturePreview({
  mode,
  range,
  targetLane,
  targetLaneIndex,
}: {
  readonly mode: ScheduleAllDayGestureMode;
  readonly range: ScheduleAllDayRange;
  readonly targetLane: ScheduleLane;
  readonly targetLaneIndex: number;
}): ScheduleAllDayGesturePreview | null {
  if (!(targetLane.editable ?? true)) return null;
  const startDate = mode === 'move' || mode === 'resize-start' ? targetLane.date : range.startDate;
  const endDate =
    mode === 'move'
      ? shiftScheduleDate(targetLane.date, range.durationDays)
      : mode === 'resize-end'
        ? shiftScheduleDate(targetLane.date, 1)
        : range.endDate;
  if (Temporal.PlainDate.compare(startDate, endDate) >= 0) return null;
  return { laneIndex: targetLaneIndex, startDate, endDate };
}

/** Format an inclusive-start/exclusive-end range as the visible dates it covers. */
export function formatAllDayDateRange(startDate: string, endDate: string, locale?: string): string {
  const formatter = new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
  });
  const start = formatter.format(new Date(`${startDate}T00:00:00.000Z`));
  const finalDate = shiftScheduleDate(endDate, -1);
  const end = formatter.format(new Date(`${finalDate}T00:00:00.000Z`));
  return startDate === finalDate ? start : `${start} – ${end}`;
}
