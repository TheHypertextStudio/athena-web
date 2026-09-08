'use client';

/** `agenda/agenda-canvas` — list and shared-fluid-canvas arrangements of one agenda. */
import { useAppRouter as useRouter } from '@/lib/interactions/navigation';
import { type JSX, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Button, surfaceToneColor } from '@docket/ui/primitives';
import { SHELL_DESKTOP_QUERY } from '@docket/ui/components';
import { useMediaQuery } from '@docket/ui/hooks';

import CalendarItemDrawer from '@/components/calendar/calendar-item-drawer';
import { CalendarItemPeekOverlay } from '@/components/calendar/item-peek/calendar-item-peek-overlay';
import {
  resolvePeekItem,
  useCalendarItemSelection,
} from '@/components/calendar/item-peek/use-calendar-item-selection';
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
  const { date, displayTimezone, entries, loading, view } = useAgenda();
  const router = useRouter();
  const openEvent = useCalendarItemSelection();
  const { close: closeEvent } = openEvent;
  // Both the day and the list/timeline morph destroy the element the peek is pointing at.
  useEffect(() => {
    closeEvent();
  }, [date, view, closeEvent]);
  const peekItem = resolvePeekItem(
    openEvent.peekItemId,
    (id) => entries.find((entry) => entry.calendarItem?.id === id)?.calendarItem,
  );
  return (
    <>
      {view === 'list' ? (
        <AgendaListArrangement
          entries={entries}
          loading={loading}
          onOpenCalendarItem={openEvent.open}
        />
      ) : (
        <TimelineArrangement entries={entries} onOpenCalendarItem={openEvent.open} />
      )}
      <CalendarItemPeekOverlay
        item={peekItem}
        displayTimezone={displayTimezone}
        anchorRef={openEvent.anchorRef}
        onOpenDetail={openEvent.escalate}
        onClose={openEvent.close}
        onDismissOutside={openEvent.noteDismissal}
      />
      <CalendarItemDrawer
        displayTimezone={displayTimezone}
        itemId={openEvent.detailItemId}
        onClose={openEvent.close}
        onOpenTask={(organizationId, taskId) => {
          router.push(`/orgs/${organizationId}/tasks/${taskId}`);
        }}
      />
    </>
  );
}

/**
 * Announce an empty day without drawing anything.
 *
 * @remarks
 * The rail deliberately renders no visual empty state — the notice pinned itself to the viewport's
 * bottom edge and floated a pill over whatever hour was in view, restating what an empty timeline
 * already says. That leaves a gap for anyone who cannot see the timeline, which this closes.
 *
 * It owns its own branching rather than taking a single `show` boolean, because the three
 * conditions counted against {@link TimelineArrangement}'s complexity budget where they were.
 */
function AgendaEmptyStatus({
  loading,
  itemCount,
  error,
}: {
  readonly loading: boolean;
  readonly itemCount: number;
  readonly error: string | null | undefined;
}): JSX.Element | null {
  if (loading || itemCount > 0) return null;
  if (error !== null && error !== undefined && error.length > 0) return null;
  return (
    <p role="status" className="sr-only">
      Nothing scheduled.
    </p>
  );
}

/** One agenda day rendered through the same arbitrary-lane engine as the full calendar. */
function TimelineArrangement({
  entries,
  onOpenCalendarItem,
}: {
  readonly entries: readonly AgendaEntry[];
  readonly onOpenCalendarItem: (itemId: string, anchor: HTMLElement | null) => void;
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
          className={`${surfaceToneColor('page')} absolute inset-0 isolate`}
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
          // No visual empty state in the rail. The notice pins itself to the viewport's bottom
          // edge, so on an empty day it floated a pill over whatever hour you happened to be
          // scrolled to, restating what an empty timeline already says. The ghost grammar's rule 6
          // is the standard here — a lane with nothing to show renders nothing. The calendar page
          // keeps its own notice, because there the empty grid is the whole screen rather than a
          // supplemental panel, and "Plan in the calendar" is not a route out of the calendar.
          // The state is still announced; see the live region below.
          emptyMessage=""
          onOpenItem={({ item, anchor }) => {
            const entry = entryById.get(item.id);
            if (!entry) return;
            if (entry.taskId && entry.organizationId) {
              router.push(`/orgs/${entry.organizationId}/tasks/${entry.taskId}`);
            } else if (entry.calendarItem) {
              onOpenCalendarItem(entry.calendarItem.id, anchor ?? null);
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
      )}
      <AgendaEmptyStatus loading={loading} itemCount={lane.items.length} error={error} />
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
