import { Temporal } from '@js-temporal/polyfill';
import type { CalendarItemOut } from '@docket/types';

import {
  isInlineEditableScheduleItem,
  itemBoundsInLane,
  moveScheduleInstantRange,
  resizeScheduleInstantRange,
  type ScheduleItem,
  type ScheduleLane,
} from '@/components/scheduling';

import { canPersistCalendarItemBounds } from './calendar-schedule-model';

/** Exact instant bounds accepted by the calendar update contract. */
export interface CalendarExactBounds {
  readonly startsAt: string;
  readonly endsAt: string;
}

/** Inclusive-start/exclusive-end dates accepted by an all-day calendar update. */
export interface CalendarAllDayBounds {
  readonly allDayStartDate: string;
  readonly allDayEndDate: string;
}

/** Return whether one timed source can safely round-trip through direct manipulation. */
function sourceIsInlineEditable(source: CalendarItemOut, displayTimezone: string): boolean {
  return isInlineEditableScheduleItem({
    canPersistBounds: canPersistCalendarItemBounds(source),
    allDay: Boolean(source.allDayStartDate && source.allDayEndDate),
    startsAt: source.startsAt,
    endsAt: source.endsAt,
    displayTimezone,
  });
}

/** Reject malformed candidate instants before they reach the mutation layer. */
function candidateIsSafe(bounds: CalendarExactBounds, displayTimezone: string): boolean {
  return isInlineEditableScheduleItem({
    canPersistBounds: true,
    allDay: false,
    startsAt: bounds.startsAt,
    endsAt: bounds.endsAt,
    displayTimezone,
  });
}

/** Derive exact persisted bounds for one timed move without changing elapsed duration. */
export function movedCalendarItemBounds(
  source: CalendarItemOut | undefined,
  targetDate: string,
  startMinutes: number,
  displayTimezone: string,
): CalendarExactBounds | null {
  if (!source?.startsAt || !source.endsAt || !sourceIsInlineEditable(source, displayTimezone)) {
    return null;
  }
  const moved = moveScheduleInstantRange({
    startsAt: source.startsAt,
    endsAt: source.endsAt,
    targetDate,
    startMinutes,
    displayTimezone,
  });
  return moved && candidateIsSafe(moved, displayTimezone) ? moved : null;
}

/** Derive exact persisted bounds for one true-edge timed resize. */
export function resizedCalendarItemBounds({
  source,
  item,
  lane,
  edge,
  startMinutes,
  endMinutes,
  displayTimezone,
}: {
  readonly source: CalendarItemOut | undefined;
  readonly item: ScheduleItem;
  readonly lane: ScheduleLane;
  readonly edge: 'start' | 'end';
  readonly startMinutes: number;
  readonly endMinutes: number;
  readonly displayTimezone: string;
}): CalendarExactBounds | null {
  if (!source?.startsAt || !source.endsAt || !sourceIsInlineEditable(source, displayTimezone)) {
    return null;
  }
  const originalBounds = itemBoundsInLane(
    { ...item, startsAt: source.startsAt, endsAt: source.endsAt },
    lane,
    displayTimezone,
  );
  if (!originalBounds) return null;
  const resized = resizeScheduleInstantRange({
    startsAt: source.startsAt,
    endsAt: source.endsAt,
    edge,
    targetDate: lane.date,
    edgeMinutes: edge === 'start' ? startMinutes : endMinutes,
    displayTimezone,
  });
  return resized && candidateIsSafe(resized, displayTimezone) ? resized : null;
}

/** Validate and map one writable all-day item's exclusive date range to an update patch. */
export function calendarAllDayBounds(
  source: CalendarItemOut | undefined,
  startDate: string,
  endDate: string,
): CalendarAllDayBounds | null {
  if (!source?.allDayStartDate || !source.allDayEndDate || !canPersistCalendarItemBounds(source)) {
    return null;
  }
  try {
    if (Temporal.PlainDate.compare(startDate, endDate) >= 0) return null;
  } catch {
    return null;
  }
  return { allDayStartDate: startDate, allDayEndDate: endDate };
}
