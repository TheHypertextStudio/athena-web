import type { CalendarItemOut, ScheduleComparisonOut } from '@docket/types';

import { shiftISODate } from '@/components/agenda/agenda-context';
import {
  scheduleDateRange,
  scheduleInstantAt,
  scheduleWallPositionForInstant,
  type ScheduleItem,
  type ScheduleLane,
} from '@/components/scheduling';

/** The resource dimension rendered by the calendar canvas. */
export type CalendarAxis = 'dates' | 'people';

/** Configurable policy for retaining date lanes outside the measured viewport. */
export interface RollingDateWindowPolicy {
  /** Number of complete measured viewports retained before and after the visible lanes. */
  readonly overscanViewports: number;
}

/** A rolling date window derived entirely from current viewport geometry. */
export interface RollingDateWindow {
  readonly startDate: string;
  readonly laneCount: number;
  readonly initialLaneIndex: number;
}

/** Default rolling-window policy: retain one measured viewport on either side. */
export const DEFAULT_ROLLING_DATE_WINDOW_POLICY: RollingDateWindowPolicy = {
  overscanViewports: 1,
};

/** Convert one validated schedule wall-clock position to its exact instant. */
function requiredScheduleInstant(date: string, minutes: number, displayTimezone: string): string {
  const instant = scheduleInstantAt(date, minutes, displayTimezone);
  if (!instant) throw new RangeError('Invalid scheduling wall-clock position.');
  return instant;
}

/** Return the exact instant range covering local date lanes in the required display timezone. */
export function dateRange(
  startDate: string,
  laneCount: number,
  displayTimezone: string,
): { startISO: string; endISO: string } {
  return scheduleDateRange(startDate, laneCount, displayTimezone);
}

/**
 * Derive a rolling date window from any measured visible-lane count and overscan policy.
 *
 * @remarks
 * The result scales with geometry: neither the visible window nor its retained neighbors use a
 * named view or a fixed number of dates.
 */
export function deriveRollingDateWindow(
  anchorDate: string,
  measuredVisibleLaneCount: number,
  policy: RollingDateWindowPolicy = DEFAULT_ROLLING_DATE_WINDOW_POLICY,
): RollingDateWindow {
  const visibleLaneCount = Math.max(1, Math.floor(measuredVisibleLaneCount));
  const overscanViewports = Math.max(0, Math.floor(policy.overscanViewports));
  const initialLaneIndex = visibleLaneCount * overscanViewports;
  return {
    startDate: shiftISODate(anchorDate, -initialLaneIndex),
    laneCount: visibleLaneCount * (overscanViewports * 2 + 1),
    initialLaneIndex,
  };
}

/** Return whether a normalized calendar item overlaps a local date lane. */
export function overlapsDate(
  item: CalendarItemOut,
  date: string,
  displayTimezone: string,
): boolean {
  if (item.allDayStartDate && item.allDayEndDate) {
    return item.allDayStartDate <= date && date < item.allDayEndDate;
  }
  if (!item.startsAt || !item.endsAt) return false;
  const range = scheduleDateRange(date, 1, displayTimezone);
  const laneStart = Date.parse(range.startISO);
  const laneEnd = Date.parse(range.endISO);
  return new Date(item.startsAt).getTime() < laneEnd && new Date(item.endsAt).getTime() > laneStart;
}

/** Convert one calendar item into the geometry-only scheduling contract. */
export function toScheduleItem(
  item: CalendarItemOut,
  date: string,
  color: string | null | undefined,
  displayTimezone: string,
): ScheduleItem {
  const allDay = item.allDayStartDate !== null && item.allDayEndDate !== null;
  const startsAt =
    item.startsAt ?? requiredScheduleInstant(item.allDayStartDate ?? date, 0, displayTimezone);
  const endsAt =
    item.endsAt ??
    requiredScheduleInstant(item.allDayEndDate ?? shiftISODate(date, 1), 0, displayTimezone);
  const startPosition = item.startsAt
    ? scheduleWallPositionForInstant(item.startsAt, displayTimezone)
    : null;
  const endPosition = item.endsAt
    ? scheduleWallPositionForInstant(item.endsAt, displayTimezone)
    : null;
  const singleDay =
    startPosition !== null && endPosition !== null && startPosition.date === endPosition.date;
  return {
    id: item.id,
    title: item.title,
    startsAt,
    endsAt,
    allDay,
    color: color ?? undefined,
    editable: item.permissions.canEditCore && !allDay && singleDay,
    dragObject:
      item.kind === 'task_timebox' || item.kind === 'availability_block'
        ? undefined
        : { kind: 'calendar_item', itemId: item.id, title: item.title },
    dropTarget: ['provider_event', 'native_event', 'native_block', 'timebox'].includes(item.kind),
  };
}

/** Build one date lane from an arbitrary visible range payload. */
export function buildDateLane(
  date: string,
  items: readonly CalendarItemOut[],
  colorByLayer: ReadonlyMap<string, string | null>,
  displayTimezone: string,
): ScheduleLane {
  return {
    id: `date:${date}`,
    date,
    label:
      new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      }) || date,
    items: items
      .filter((item) => overlapsDate(item, date, displayTimezone))
      .map((item) => toScheduleItem(item, date, colorByLayer.get(item.layerId), displayTimezone)),
  };
}

/** Convert one permission-filtered person response into a read-only resource lane. */
export function buildComparisonLane(
  person: ScheduleComparisonOut['people'][number],
  date: string,
  displayTimezone: string,
): ScheduleLane {
  return {
    id: `person:${person.actorId}`,
    resourceId: person.actorId,
    date,
    label: person.displayName,
    timezone: person.timezone ?? undefined,
    editable: false,
    items: person.items.map((item, index) => {
      const allDay = item.allDayStartDate !== null && item.allDayEndDate !== null;
      return {
        id:
          item.access === 'details'
            ? item.itemId
            : `busy:${person.actorId}:${item.startsAt ?? item.allDayStartDate ?? String(index)}`,
        title: item.access === 'details' ? item.title : 'Busy',
        startsAt:
          item.startsAt ??
          requiredScheduleInstant(item.allDayStartDate ?? date, 0, displayTimezone),
        endsAt:
          item.endsAt ??
          requiredScheduleInstant(item.allDayEndDate ?? shiftISODate(date, 1), 0, displayTimezone),
        allDay,
        editable: false,
      };
    }),
  };
}
