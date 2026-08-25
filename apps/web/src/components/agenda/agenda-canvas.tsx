'use client';

/** `agenda/agenda-canvas` — list and shared-fluid-canvas arrangements of one agenda. */
import Link from '@/components/docket-link';
import { useAppRouter as useRouter } from '@/lib/interactions/navigation';
import { type JSX, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@docket/ui/primitives';
import { SHELL_DESKTOP_QUERY } from '@docket/ui/components';
import { useMediaQuery } from '@docket/ui/hooks';

import CalendarItemDrawer from '@/components/calendar/calendar-item-drawer';
import CreateBlockForm, {
  type CalendarRegionSelection,
} from '@/components/calendar/create-block-form';
import { formatDay } from '@/components/date-picker';
import { useUpdateCalendarItemById } from '@/components/calendar/calendar-mutations';
import {
  isInlineEditableScheduleItem,
  itemBoundsInLane,
  moveScheduleInstantRange,
  resizeScheduleInstantRange,
  resolveScheduleWallInstant,
  type ScheduleItem,
  type ScheduleLane,
  type ScheduleRegionSelection,
  scheduleWallPositionForInstant,
  SchedulingCanvas,
} from '@/components/scheduling';
import { useNow } from '@/lib/use-now';

import { type AgendaEntry, shiftISODate, useAgenda } from './agenda-context';
import { AgendaListArrangement } from './agenda-list-arrangement';
import { isAgendaEntryInlineEditable, toAgendaScheduleItem } from './agenda-schedule-item';

const INLINE_UPDATE_FAILURE_COPY =
  'Could not update this item. Your previous time has been restored.';

/** Arranges the agenda for the active list/timeline view. */
export default function AgendaCanvas(): JSX.Element {
  const { displayTimezone, entries, loading, view } = useAgenda();
  const router = useRouter();
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  return (
    <>
      {view === 'list' ? (
        <AgendaListArrangement
          entries={entries}
          loading={loading}
          onOpenCalendarItem={setOpenItemId}
        />
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

/** One agenda day rendered through the same arbitrary-lane engine as the full calendar. */
function TimelineArrangement({
  entries,
  onOpenCalendarItem,
}: {
  readonly entries: readonly AgendaEntry[];
  readonly onOpenCalendarItem: (itemId: string) => void;
}): JSX.Element {
  const router = useRouter();
  const {
    date,
    displayTimezone,
    loading,
    pixelsPerHour,
    goToPreviousDay,
    goToNextDay,
    goToToday,
    registerNavigationGuard,
    setTimebox,
    timeboxFailed,
    clearTimeboxFailure,
    error,
    retrying,
    retry,
    workPlaces,
    workLocationComposition,
  } = useAgenda();
  const now = useNow().toISOString();
  const [draftSelection, setDraftSelection] = useState<{
    readonly selection: CalendarRegionSelection;
    readonly canvasRegion: ScheduleRegionSelection | null;
  } | null>(null);
  const [draftDirty, setDraftDirty] = useState(false);
  const [mobileCreateHost, setMobileCreateHost] = useState<HTMLDivElement | null>(null);
  const isDesktop = useMediaQuery(SHELL_DESKTOP_QUERY);
  const draftAnchorRef = useRef<HTMLDivElement>(null);
  const allDayDraftAnchorRef = useRef<HTMLElement>(null);
  const updateCalendarItem = useUpdateCalendarItemById();
  const resetCalendarItem = updateCalendarItem.reset;
  const clearInlineFailures = useCallback(() => {
    clearTimeboxFailure();
    resetCalendarItem();
  }, [clearTimeboxFailure, resetCalendarItem]);
  useEffect(() => {
    clearInlineFailures();
    allDayDraftAnchorRef.current = null;
    setDraftSelection(null);
    setDraftDirty(false);
  }, [clearInlineFailures, date]);
  useEffect(() => {
    if (!draftSelection) return undefined;
    return registerNavigationGuard(() => {
      if (
        draftDirty &&
        !window.confirm('Discard this unsaved calendar item and view another date?')
      ) {
        return false;
      }
      allDayDraftAnchorRef.current = null;
      setDraftSelection(null);
      setDraftDirty(false);
      return true;
    });
  }, [draftDirty, draftSelection, registerNavigationGuard]);
  const entryById = useMemo(() => new Map(entries.map((entry) => [entry.id, entry])), [entries]);
  const lane = useMemo<ScheduleLane>(
    () => ({
      id: `agenda:${date}`,
      date,
      label: formatDay(date, { weekday: 'short', month: 'short', day: 'numeric' }) ?? date,
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
  ): void => {
    const entry = entryById.get(item.id);
    if (
      !entry ||
      targetLane.editable === false ||
      !isAgendaEntryInlineEditable(entry, displayTimezone)
    )
      return;
    const moved = moveScheduleInstantRange({
      startsAt: item.startsAt,
      endsAt: item.endsAt,
      targetDate: targetLane.date,
      startMinutes,
      displayTimezone,
    });
    if (
      !moved ||
      !isInlineEditableScheduleItem({
        canPersistBounds: true,
        allDay: false,
        startsAt: moved.startsAt,
        endsAt: moved.endsAt,
        displayTimezone,
      })
    )
      return;
    persistExactBounds(entry, moved.startsAt, moved.endsAt);
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
    const originalBounds = itemBoundsInLane(
      { ...item, startsAt: entry.startsAt, endsAt: entry.endsAt },
      targetLane,
      displayTimezone,
    );
    if (!originalBounds) return;
    const resized = resizeScheduleInstantRange({
      startsAt: entry.startsAt,
      endsAt: entry.endsAt,
      edge,
      targetDate: targetLane.date,
      edgeMinutes: edge === 'start' ? startMinutes : endMinutes,
      displayTimezone,
    });
    if (
      !resized ||
      !isInlineEditableScheduleItem({
        canPersistBounds: true,
        allDay: false,
        startsAt: resized.startsAt,
        endsAt: resized.endsAt,
        displayTimezone,
      })
    )
      return;
    persistExactBounds(entry, resized.startsAt, resized.endsAt);
  };

  const selectTimedRegion = (canvasRegion: ScheduleRegionSelection): void => {
    const start = resolveScheduleWallInstant(
      canvasRegion.lane.date,
      canvasRegion.startMinutes,
      displayTimezone,
    );
    const end = resolveScheduleWallInstant(
      canvasRegion.lane.date,
      canvasRegion.endMinutes,
      displayTimezone,
    );
    if (start.kind !== 'resolved' || end.kind !== 'resolved') return;
    allDayDraftAnchorRef.current = null;
    setDraftSelection({
      selection: { startsAt: start.instant, endsAt: end.instant },
      canvasRegion,
    });
  };

  const updateDraftProjection = useCallback(
    (selection: CalendarRegionSelection): void => {
      if (!('startsAt' in selection)) {
        setDraftSelection((current) => (current ? { ...current, selection } : current));
        return;
      }
      const start = scheduleWallPositionForInstant(selection.startsAt, displayTimezone);
      const end = scheduleWallPositionForInstant(selection.endsAt, displayTimezone);
      if (!start || !end || start.date !== lane.date || end.date !== lane.date) return;
      setDraftSelection({
        selection,
        canvasRegion: {
          lane,
          startMinutes: start.wallMinutes,
          endMinutes: end.wallMinutes,
        },
      });
    },
    [displayTimezone, lane],
  );

  const mobileCreateActive = draftSelection !== null && !isDesktop;
  const hasInlineUpdateFailure = timeboxFailed || updateCalendarItem.isError;

  return (
    <div className="relative h-full min-h-0">
      {mobileCreateActive ? (
        <div
          ref={setMobileCreateHost}
          data-agenda-create-host=""
          className="bg-surface absolute inset-0 isolate"
        />
      ) : (
        <SchedulingCanvas
          presentation="agenda"
          displayTimezone={displayTimezone}
          lanes={[lane]}
          pixelsPerHour={pixelsPerHour}
          now={now}
          viewportHeight="100%"
          minimumLaneWidth={180}
          {...workLocationComposition?.canvasProps}
          selectedRegion={draftSelection?.canvasRegion}
          selectedRegionAnchorRef={draftAnchorRef}
          onSelectRegion={selectTimedRegion}
          onSelectAllDayRegion={(targetLane, anchor) => {
            allDayDraftAnchorRef.current = anchor;
            setDraftSelection({
              selection: {
                allDayStartDate: targetLane.date,
                allDayEndDate: shiftISODate(targetLane.date, 1),
              },
              canvasRegion: null,
            });
          }}
          onDateShortcut={(shortcut) => {
            if (shortcut === 'previous') goToPreviousDay();
            else if (shortcut === 'next') goToNextDay();
            else goToToday();
          }}
          error={hasInlineUpdateFailure ? INLINE_UPDATE_FAILURE_COPY : error}
          errorAction={
            !hasInlineUpdateFailure && error ? (
              <Button type="button" variant="outline" size="sm" disabled={retrying} onClick={retry}>
                {retrying ? 'Retrying…' : 'Retry'}
              </Button>
            ) : null
          }
          emptyMessage={loading ? '' : 'Nothing scheduled.'}
          emptyAction={
            loading ? null : (
              <Button asChild variant="outline" size="sm">
                <Link href="/calendar">Plan in the calendar</Link>
              </Button>
            )
          }
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
            onMoveItem={({ item, toLane, startMinutes }) => {
              persistMove(item, toLane, startMinutes);
            }}
            onResizeItem={({ item, lane: targetLane, edge, startMinutes, endMinutes }) => {
              persistResize(item, targetLane, edge, startMinutes, endMinutes);
            }}
          />
        </div>
      )}
      {workLocationComposition?.overlays}
      <CreateBlockForm
        presentation="agenda"
        trigger="hidden"
        displayTimezone={displayTimezone}
        selection={draftSelection?.selection}
        selectionAnchorRef={
          draftSelection
            ? draftSelection.canvasRegion
              ? draftAnchorRef
              : allDayDraftAnchorRef
            : undefined
        }
        onDraftChange={updateDraftProjection}
        onDirtyChange={setDraftDirty}
        agendaMobileHost={mobileCreateHost}
        workPlaces={workPlaces}
        onSelectionConsumed={() => {
          allDayDraftAnchorRef.current = null;
          setDraftSelection(null);
          setDraftDirty(false);
        }}
      />
    </div>
  );
}
