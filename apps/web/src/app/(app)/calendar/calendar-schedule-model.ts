import type {
  CalendarItemOut,
  ScheduleComparisonItemOut,
  ScheduleComparisonOut,
} from '@docket/planning/calendar-contract';
import { shiftISODate } from '@/components/agenda/agenda-context';
import { formatDay } from '@/components/date-picker';
import {
  isInlineEditableScheduleItem,
  scheduleDateRange,
  scheduleInstantAt,
  type ScheduleItem,
  type ScheduleLane,
} from '@/components/scheduling';
import { calendarScheduleItemAppearance } from '@/components/calendar/calendar-schedule-appearance';
const DERIVED_READ_ONLY_KINDS = new Set(['task_timebox', 'availability_block']);

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
  item: Pick<
    CalendarItemOut | ScheduleComparisonItemOut,
    'startsAt' | 'endsAt' | 'allDayStartDate' | 'allDayEndDate'
  >,
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

/** Return whether the calendar domain permits writing an item's exact time bounds. */
export function canPersistCalendarItemBounds(item: CalendarItemOut): boolean {
  return (
    item.permissions.canEditCore &&
    !item.hasConflict &&
    item.status !== 'conflicted' &&
    !DERIVED_READ_ONLY_KINDS.has(item.kind)
  );
}

/** Return application-owned copy only for explicit calendar-domain read-only states. */
function calendarReadOnlyLabel(item: CalendarItemOut): string | undefined {
  if (DERIVED_READ_ONLY_KINDS.has(item.kind)) return undefined;
  if (item.hasConflict || item.status === 'conflicted') return 'Conflict';
  return !item.permissions.canEditCore ? 'Read-only' : undefined;
}

/** Map a calendar item to the openable scheduling object, omitting derived read-only items. */
function calendarScheduleObject(item: CalendarItemOut): ScheduleItem['object'] {
  if (item.kind === 'task_timebox' || item.kind === 'availability_block') return undefined;
  return {
    kind: item.kind === 'native_block' || item.kind === 'timebox' ? 'time_block' : 'calendar_event',
    id: item.id,
    organizationId: null,
    title: item.title,
  };
}

/** Resolve whether the calendar item can accept an exact-time drag or resize. */
function calendarItemIsEditable(
  item: CalendarItemOut,
  allDay: boolean,
  displayTimezone: string,
): boolean {
  if (!canPersistCalendarItemBounds(item)) return false;
  if (allDay) return true;
  return isInlineEditableScheduleItem({
    canPersistBounds: true,
    allDay: false,
    startsAt: item.startsAt,
    endsAt: item.endsAt,
    displayTimezone,
  });
}

/** Resolve the stable id shown for a detailed or redacted comparison item. */
function comparisonItemId(
  person: ScheduleComparisonOut['people'][number],
  item: ScheduleComparisonOut['people'][number]['items'][number],
  index: number,
): string {
  if (item.access === 'details') return item.itemId;
  const startsAt = item.startsAt ?? item.allDayStartDate ?? 'unknown';
  const endsAt = item.endsAt ?? item.allDayEndDate ?? 'unknown';
  return `busy:${person.actorId}:${startsAt}:${endsAt}:${index}`;
}

/** Convert one permission-filtered comparison item into a redacted schedule item when needed. */
function toComparisonScheduleItem(
  person: ScheduleComparisonOut['people'][number],
  item: ScheduleComparisonOut['people'][number]['items'][number],
  date: string,
  displayTimezone: string,
  index: number,
): ScheduleLane['items'][number] {
  const allDay = item.allDayStartDate !== null && item.allDayEndDate !== null;
  return {
    id: comparisonItemId(person, item, index),
    title: item.access === 'details' ? item.title : 'Busy',
    startsAt:
      item.startsAt ?? requiredScheduleInstant(item.allDayStartDate ?? date, 0, displayTimezone),
    endsAt:
      item.endsAt ??
      requiredScheduleInstant(item.allDayEndDate ?? shiftISODate(date, 1), 0, displayTimezone),
    allDay,
    appearance: item.access === 'details' ? calendarScheduleItemAppearance(item.kind) : 'busy',
    editable: false,
    openable: item.access === 'details',
  };
}

/** Convert one calendar item into the domain-neutral scheduling contract and appearance. */
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
  return {
    id: item.id,
    title: item.title,
    startsAt,
    endsAt,
    allDay,
    color: color ?? undefined,
    appearance: calendarScheduleItemAppearance(item.kind),
    editable: calendarItemIsEditable(item, allDay, displayTimezone),
    readOnlyLabel: calendarReadOnlyLabel(item),
    object: calendarScheduleObject(item),
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
    label: formatDay(date, { weekday: 'short', month: 'short', day: 'numeric' }) ?? date,
    items: items
      .filter((item) => overlapsDate(item, date, displayTimezone))
      .map((item) => toScheduleItem(item, date, colorByLayer.get(item.layerId), displayTimezone)),
  };
}

/** Convert one permission-filtered person response into a read-only lane with redacted busy items. */
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
    items: person.items
      .filter((item) => overlapsDate(item, date, displayTimezone))
      .map((item, index) => toComparisonScheduleItem(person, item, date, displayTimezone, index)),
  };
}
