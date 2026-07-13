'use client';

/** `agenda/agenda-canvas` — list and shared-fluid-canvas arrangements of one agenda. */
import { Stack } from '@docket/ui/primitives';
import { useRouter } from 'next/navigation';
import { type JSX, useCallback, useEffect, useMemo, useState } from 'react';

import CalendarItemDrawer from '@/components/calendar/calendar-item-drawer';
import {
  useLinkTaskToCalendarItem,
  useRelateCalendarItems,
  useUpdateCalendarItemById,
} from '@/components/calendar/calendar-mutations';
import {
  isInlineEditableScheduleItem,
  scheduleInstantAt,
  type ScheduleItem,
  type ScheduleLane,
  SchedulingCanvas,
} from '@/components/scheduling';
import { useNow } from '@/lib/use-now';

import { type AgendaEntry, isTimeboxed, useAgenda } from './agenda-context';
import AgendaEntryCard from './agenda-entry-card';
import {
  isAgendaEntryInlineEditable,
  isAgendaRelationshipTarget,
  toAgendaScheduleItem,
} from './agenda-schedule-item';

const INLINE_UPDATE_FAILURE_COPY =
  'Could not update this item. Your previous time has been restored.';

/** Start time in ms for a timeboxed entry, or `null` for untimed. */
function startMs(entry: AgendaEntry): number | null {
  return isTimeboxed(entry) ? new Date(entry.startsAt).getTime() : null;
}

/** Order timeboxed entries first and untimed entries by plan order. */
function chronological(entries: readonly AgendaEntry[]): AgendaEntry[] {
  return [...entries].sort((left, right) => {
    const leftStart = startMs(left);
    const rightStart = startMs(right);
    if (leftStart !== null && rightStart !== null) return leftStart - rightStart;
    if (leftStart !== null) return -1;
    if (rightStart !== null) return 1;
    return left.sort - right.sort;
  });
}

/** Arranges the agenda for the active list/timeline view. */
export default function AgendaCanvas(): JSX.Element {
  const { displayTimezone, entries, view } = useAgenda();
  const router = useRouter();
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  return (
    <>
      {view === 'list' ? (
        <ListArrangement entries={entries} onOpenCalendarItem={setOpenItemId} />
      ) : (
        <TimelineArrangement entries={entries} onOpenCalendarItem={setOpenItemId} />
      )}
      <CalendarItemDrawer
        displayTimezone={displayTimezone}
        itemId={openItemId}
        onClose={() => {
          setOpenItemId(null);
        }}
        onOpenTask={(organizationId, taskId) => {
          router.push(`/orgs/${organizationId}/tasks/${taskId}`);
        }}
      />
    </>
  );
}

/** The chronological list arrangement. */
function ListArrangement({
  entries,
  onOpenCalendarItem,
}: {
  readonly entries: readonly AgendaEntry[];
  readonly onOpenCalendarItem: (itemId: string) => void;
}): JSX.Element {
  const ordered = useMemo(() => chronological(entries), [entries]);
  return (
    <Stack as="ul" gap={1}>
      {ordered.map((entry) => (
        <li key={entry.id}>
          <AgendaEntryCard entry={entry} onOpenCalendarItem={onOpenCalendarItem} />
        </li>
      ))}
    </Stack>
  );
}

/** One agenda day rendered through the same arbitrary-lane engine as the full calendar. */
function TimelineArrangement({
  entries,
  onOpenCalendarItem,
}: {
  readonly entries: readonly AgendaEntry[];
  readonly onOpenCalendarItem: (itemId: string) => void;
}): JSX.Element {
  const router = useRouter();
  const { date, displayTimezone, pixelsPerHour, setTimebox, timeboxFailed, clearTimeboxFailure } =
    useAgenda();
  const now = useNow().toISOString();
  const updateCalendarItem = useUpdateCalendarItemById();
  const linkTask = useLinkTaskToCalendarItem();
  const relateItems = useRelateCalendarItems();
  const resetCalendarItem = updateCalendarItem.reset;
  const resetLinkTask = linkTask.reset;
  const resetRelateItems = relateItems.reset;
  const clearInlineFailures = useCallback(() => {
    clearTimeboxFailure();
    resetCalendarItem();
    resetLinkTask();
    resetRelateItems();
  }, [clearTimeboxFailure, resetCalendarItem, resetLinkTask, resetRelateItems]);
  useEffect(() => {
    clearInlineFailures();
  }, [clearInlineFailures, date]);
  const entryById = useMemo(() => new Map(entries.map((entry) => [entry.id, entry])), [entries]);
  const lane = useMemo<ScheduleLane>(
    () => ({
      id: `agenda:${date}`,
      date,
      label: new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      }),
      items: entries.flatMap((entry) => {
        const item = toAgendaScheduleItem(entry, date, displayTimezone);
        return item ? [item] : [];
      }),
    }),
    [date, displayTimezone, entries],
  );

  const persistExactBounds = (entry: AgendaEntry, startsAt: string, endsAt: string): void => {
    clearInlineFailures();
    if (entry.planItemId) {
      setTimebox(entry, startsAt, endsAt);
    } else if (entry.calendarItem) {
      updateCalendarItem.mutate({
        itemId: entry.calendarItem.id,
        patch: { startsAt, endsAt },
      });
    }
  };

  const persistMove = (
    item: ScheduleItem,
    targetLane: ScheduleLane,
    startMinutes: number,
    endMinutes: number,
  ): void => {
    const entry = entryById.get(item.id);
    if (
      !entry ||
      targetLane.editable === false ||
      !isAgendaEntryInlineEditable(entry, displayTimezone)
    )
      return;
    const startsAt = scheduleInstantAt(targetLane.date, startMinutes, displayTimezone, 'reject');
    const endsAt = scheduleInstantAt(targetLane.date, endMinutes, displayTimezone, 'reject');
    if (
      !startsAt ||
      !endsAt ||
      !isInlineEditableScheduleItem({
        canPersistBounds: true,
        allDay: false,
        startsAt,
        endsAt,
        displayTimezone,
      })
    )
      return;
    persistExactBounds(entry, startsAt, endsAt);
  };

  const persistResize = (
    item: ScheduleItem,
    targetLane: ScheduleLane,
    edge: 'start' | 'end',
    startMinutes: number,
    endMinutes: number,
  ): void => {
    const entry = entryById.get(item.id);
    if (
      !entry ||
      targetLane.editable === false ||
      !entry.startsAt ||
      !entry.endsAt ||
      !isAgendaEntryInlineEditable(entry, displayTimezone)
    )
      return;
    const startsAt =
      edge === 'start'
        ? scheduleInstantAt(targetLane.date, startMinutes, displayTimezone, 'reject')
        : entry.startsAt;
    const endsAt =
      edge === 'end'
        ? scheduleInstantAt(targetLane.date, endMinutes, displayTimezone, 'reject')
        : entry.endsAt;
    if (
      !startsAt ||
      !endsAt ||
      !isInlineEditableScheduleItem({
        canPersistBounds: true,
        allDay: false,
        startsAt,
        endsAt,
        displayTimezone,
      })
    )
      return;
    persistExactBounds(entry, startsAt, endsAt);
  };

  return (
    <>
      <SchedulingCanvas
        displayTimezone={displayTimezone}
        lanes={[lane]}
        pixelsPerHour={pixelsPerHour}
        now={now}
        minimumLaneWidth={180}
        error={
          timeboxFailed || updateCalendarItem.isError || linkTask.isError || relateItems.isError
            ? INLINE_UPDATE_FAILURE_COPY
            : null
        }
        emptyMessage="Nothing scheduled."
        onOpenItem={({ item }) => {
          const entry = entryById.get(item.id);
          if (!entry) return;
          if (entry.taskId && entry.organizationId) {
            router.push(`/orgs/${entry.organizationId}/tasks/${entry.taskId}`);
          } else if (entry.calendarItem) {
            onOpenCalendarItem(entry.calendarItem.id);
          } else {
            router.push('/calendar');
          }
        }}
        onMoveItem={({ item, toLane, startMinutes, endMinutes }) => {
          persistMove(item, toLane, startMinutes, endMinutes);
        }}
        onResizeItem={({ item, lane: targetLane, edge, startMinutes, endMinutes }) => {
          persistResize(item, targetLane, edge, startMinutes, endMinutes);
        }}
        onDropObjectOnItem={({ object, targetItem }) => {
          const targetEntry = entryById.get(targetItem.id);
          const target = targetEntry?.calendarItem;
          if (!targetEntry || !target || !isAgendaRelationshipTarget(targetEntry)) return;
          if (object.kind === 'calendar_item' && object.itemId === target.id) return;
          clearInlineFailures();
          const role = target.kind === 'timebox' ? 'contained' : 'related';
          if (object.kind === 'task') {
            linkTask.mutate({
              itemId: target.id,
              taskId: object.taskId,
              organizationId: object.organizationId,
              role,
            });
          } else {
            relateItems.mutate({
              sourceItemId: target.id,
              targetItemId: object.itemId,
              role,
            });
          }
        }}
      />
    </>
  );
}
