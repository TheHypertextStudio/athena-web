import {
  isInlineEditableScheduleItem,
  scheduleInstantAt,
  type ScheduleItem,
} from '@/components/scheduling';

import type { AgendaEntry } from './agenda-model';

const DERIVED_READ_ONLY_KINDS = new Set(['task_timebox', 'availability_block']);
const RELATIONSHIP_TARGET_KINDS = new Set([
  'provider_event',
  'native_event',
  'native_block',
  'timebox',
]);

/** Return whether the Agenda owns a supported persistence path for one entry's bounds. */
function canPersistAgendaEntryBounds(entry: AgendaEntry): boolean {
  if (entry.planItemId && entry.source === 'task') return true;
  const item = entry.calendarItem;
  return Boolean(
    item &&
    item.permissions.canEditCore &&
    !item.hasConflict &&
    item.status !== 'conflicted' &&
    !DERIVED_READ_ONLY_KINDS.has(item.kind),
  );
}

/** Return whether one Agenda entry can safely round-trip through inline wall-clock controls. */
export function isAgendaEntryInlineEditable(entry: AgendaEntry, displayTimezone: string): boolean {
  const item = entry.calendarItem;
  return isInlineEditableScheduleItem({
    canPersistBounds: canPersistAgendaEntryBounds(entry),
    allDay: Boolean(item?.allDayStartDate && item.allDayEndDate),
    startsAt: entry.startsAt,
    endsAt: entry.endsAt,
    displayTimezone,
  });
}

/** Map one timed or all-day Agenda entry into the shared scheduling contract. */
export function toAgendaScheduleItem(
  entry: AgendaEntry,
  date: string,
  displayTimezone: string,
): ScheduleItem | null {
  const calendarItem = entry.calendarItem;
  const allDay = Boolean(calendarItem?.allDayStartDate && calendarItem.allDayEndDate);
  const startsAt = allDay
    ? scheduleInstantAt(calendarItem?.allDayStartDate ?? date, 0, displayTimezone)
    : (entry.startsAt ?? null);
  const endsAt = allDay
    ? scheduleInstantAt(calendarItem?.allDayEndDate ?? date, 0, displayTimezone)
    : (entry.endsAt ?? null);
  if (!startsAt || !endsAt) return null;

  const derivedCalendarItem =
    calendarItem !== undefined && DERIVED_READ_ONLY_KINDS.has(calendarItem.kind);
  return {
    id: entry.id,
    title: entry.title,
    startsAt,
    endsAt,
    allDay,
    color: entry.layerColor ?? entry.calendar?.color ?? undefined,
    editable: isAgendaEntryInlineEditable(entry, displayTimezone),
    dragObject:
      calendarItem && !derivedCalendarItem
        ? { kind: 'calendar_item', itemId: calendarItem.id, title: entry.title }
        : entry.taskId && entry.organizationId
          ? {
              kind: 'task',
              taskId: entry.taskId,
              organizationId: entry.organizationId,
              title: entry.title,
            }
          : undefined,
    dropTarget: Boolean(calendarItem && RELATIONSHIP_TARGET_KINDS.has(calendarItem.kind)),
  };
}
