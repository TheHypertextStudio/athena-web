'use client';

/** `agenda/agenda-canvas` — list and shared-fluid-canvas arrangements of one agenda. */
import { Stack } from '@docket/ui/primitives';
import { useRouter } from 'next/navigation';
import { type JSX, useMemo, useState } from 'react';

import CalendarItemDrawer from '@/components/calendar/calendar-item-drawer';
import {
  useLinkTaskToCalendarItem,
  useRelateCalendarItems,
  useUpdateCalendarItemById,
} from '@/components/calendar/calendar-mutations';
import {
  scheduleInstantAt,
  type ScheduleItem,
  type ScheduleLane,
  SchedulingCanvas,
} from '@/components/scheduling';

import { type AgendaEntry, isTimeboxed, useAgenda } from './agenda-context';
import AgendaEntryCard from './agenda-entry-card';

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
  const { entries, view } = useAgenda();
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
  const { date, displayTimezone, pixelsPerHour, setTimebox } = useAgenda();
  const [now] = useState(() => new Date().toISOString());
  const updateCalendarItem = useUpdateCalendarItemById();
  const linkTask = useLinkTaskToCalendarItem();
  const relateItems = useRelateCalendarItems();
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
      items: entries.filter(isTimeboxed).map(
        (entry): ScheduleItem => ({
          id: entry.id,
          title: entry.title,
          startsAt: entry.startsAt,
          endsAt: entry.endsAt,
          color: entry.layerColor ?? entry.calendar?.color ?? undefined,
          editable:
            entry.planItemId !== undefined || entry.calendarItem?.permissions.canEditCore === true,
          dragObject: entry.calendarItem
            ? {
                kind: 'calendar_item',
                itemId: entry.calendarItem.id,
                title: entry.title,
              }
            : entry.taskId && entry.organizationId
              ? {
                  kind: 'task',
                  taskId: entry.taskId,
                  organizationId: entry.organizationId,
                  title: entry.title,
                }
              : undefined,
          dropTarget:
            entry.calendarItem !== undefined &&
            ['provider_event', 'native_event', 'native_block', 'timebox'].includes(
              entry.calendarItem.kind,
            ),
        }),
      ),
    }),
    [date, entries],
  );

  const persistBounds = (
    item: ScheduleItem,
    targetLane: ScheduleLane,
    startMinutes: number,
    endMinutes: number,
  ): void => {
    const entry = entryById.get(item.id);
    if (!entry) return;
    const startsAt = scheduleInstantAt(targetLane.date, startMinutes, displayTimezone);
    const endsAt = scheduleInstantAt(targetLane.date, endMinutes, displayTimezone);
    if (!startsAt || !endsAt) return;
    if (entry.planItemId) {
      setTimebox(entry, startsAt, endsAt);
    } else if (entry.calendarItem) {
      updateCalendarItem.mutate({
        itemId: entry.calendarItem.id,
        patch: { startsAt, endsAt },
      });
    }
  };

  return (
    <>
      <SchedulingCanvas
        displayTimezone={displayTimezone}
        lanes={[lane]}
        pixelsPerHour={pixelsPerHour}
        now={now}
        minimumLaneWidth={180}
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
          persistBounds(item, toLane, startMinutes, endMinutes);
        }}
        onResizeItem={({ item, lane: targetLane, startMinutes, endMinutes }) => {
          persistBounds(item, targetLane, startMinutes, endMinutes);
        }}
        onDropObjectOnItem={({ object, targetItem }) => {
          const target = entryById.get(targetItem.id)?.calendarItem;
          if (!target) return;
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
