'use client';

/**
 * `(app)/calendar` — the full layered-calendar view's client shell.
 *
 * @remarks
 * Owns the navigated day/week and the day↔week mode (mirroring `agenda-context.tsx`'s
 * date-is-a-plain-state, view-is-a-View-Transition split: navigating is a new data fetch, so it is
 * NOT wrapped; switching day↔week reshapes the same page, so it IS). Fetches the active range's
 * items and the full layers list, renders the mode-appropriate grid
 * ({@link CalendarTimeline}/{@link CalendarWeekGrid}), the layer toggle panel, the create-block
 * action, a view-level sync/conflict banner, and the item workspace drawer.
 */
import { ChevronLeft, ChevronRight } from '@docket/ui/icons';
import { Button, Skeleton } from '@docket/ui/primitives';
import { cn } from '@docket/ui/lib/utils';
import { useRouter } from 'next/navigation';
import { type JSX, useState } from 'react';

import { shiftISODate } from '@/components/agenda/agenda-context';
import CalendarItemDrawer from '@/components/calendar/calendar-item-drawer';
import CalendarLayerPanel from '@/components/calendar/calendar-layer-panel';
import CalendarTimeline from '@/components/calendar/calendar-timeline';
import CalendarWeekGrid from '@/components/calendar/calendar-week-grid';
import { calendarItemsDef, calendarLayersDef } from '@/components/calendar/calendar-data';
import CreateBlockForm from '@/components/calendar/create-block-form';
import { formatCalendarDate } from '@/lib/format-date';
import { queryKeys, useApiListQuery } from '@/lib/query';
import { todayISODate } from '@/lib/today';
import { startViewTransition } from '@/lib/view-transition';
import { userErrorMessage } from '@/lib/problem';

/** The calendar view's display mode. */
type CalendarViewMode = 'day' | 'week';

/** The day `getDay()` (Sunday-start) the week containing `date` begins on. */
function startOfWeek(date: string): string {
  const day = new Date(`${date}T00:00:00`).getDay();
  return shiftISODate(date, -day);
}

/** An instant range, exclusive of `endISO`, over which calendar items are queried. */
interface CalendarDayRange {
  /** Range start (ISO 8601 datetime, inclusive). */
  startISO: string;
  /** Range end (ISO 8601 datetime, exclusive). */
  endISO: string;
}

/** The `[startISO, endISO)` instant range covering `days` local calendar days from `startDate`. */
function rangeISO(startDate: string, days: number): CalendarDayRange {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${shiftISODate(startDate, days)}T00:00:00`);
  return { startISO: start.toISOString(), endISO: end.toISOString() };
}

/** The full calendar view. */
export default function CalendarClient(): JSX.Element {
  const router = useRouter();
  const [date, setDate] = useState(() => todayISODate());
  const [view, setViewState] = useState<CalendarViewMode>('day');
  const [openItemId, setOpenItemId] = useState<string | null>(null);

  const rangeStartDate = view === 'week' ? startOfWeek(date) : date;
  const { startISO, endISO } = rangeISO(rangeStartDate, view === 'week' ? 7 : 1);

  const itemsQuery = useApiListQuery(calendarItemsDef(startISO, endISO));
  const layersQuery = useApiListQuery(calendarLayersDef());
  const items = itemsQuery.data?.items ?? [];
  const layers = layersQuery.data?.items ?? [];

  const setView = (next: CalendarViewMode): void => {
    startViewTransition(() => {
      setViewState(next);
    });
  };
  const goToday = (): void => {
    setDate(todayISODate());
  };
  const goPrevious = (): void => {
    setDate((d) => shiftISODate(d, view === 'week' ? -7 : -1));
  };
  const goNext = (): void => {
    setDate((d) => shiftISODate(d, view === 'week' ? 7 : 1));
  };

  const conflictCount = items.filter((item) => item.hasConflict).length;
  const failedCount = items.filter(
    (item) => !item.hasConflict && item.syncState === 'provider_error',
  ).length;

  const heading =
    view === 'day'
      ? (formatCalendarDate(date) ?? date)
      : `${formatCalendarDate(rangeStartDate) ?? rangeStartDate} – ${
          formatCalendarDate(shiftISODate(rangeStartDate, 6)) ?? ''
        }`;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 @2xl:p-6 @4xl:p-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="outline" onClick={goToday}>
            Today
          </Button>
          <Button size="icon" variant="ghost" aria-label="Previous" onClick={goPrevious}>
            <ChevronLeft />
          </Button>
          <Button size="icon" variant="ghost" aria-label="Next" onClick={goNext}>
            <ChevronRight />
          </Button>
          <h1 className="text-on-surface ml-1 text-lg font-semibold">{heading}</h1>
        </div>
        <div className="flex items-center gap-2">
          <div
            role="group"
            aria-label="Calendar view"
            className="border-outline-variant flex rounded-md border p-0.5"
          >
            <button
              type="button"
              aria-pressed={view === 'day'}
              onClick={() => {
                setView('day');
              }}
              className={cn(
                'rounded-sm px-2.5 py-1 text-xs font-medium transition-colors',
                view === 'day'
                  ? 'bg-surface-container-high text-on-surface'
                  : 'text-on-surface-variant',
              )}
            >
              Day
            </button>
            <button
              type="button"
              aria-pressed={view === 'week'}
              onClick={() => {
                setView('week');
              }}
              className={cn(
                'rounded-sm px-2.5 py-1 text-xs font-medium transition-colors',
                view === 'week'
                  ? 'bg-surface-container-high text-on-surface'
                  : 'text-on-surface-variant',
              )}
            >
              Week
            </button>
          </div>
          <CreateBlockForm rangeKeys={[queryKeys.calendarItems(startISO, endISO)]} />
        </div>
      </header>

      {conflictCount > 0 || failedCount > 0 ? (
        <div
          role="alert"
          className="border-destructive/40 bg-destructive/10 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
        >
          <span className="text-destructive font-medium">
            {conflictCount > 0
              ? `${String(conflictCount)} sync conflict${conflictCount === 1 ? '' : 's'}`
              : null}
            {conflictCount > 0 && failedCount > 0 ? ' · ' : null}
            {failedCount > 0
              ? `${String(failedCount)} sync error${failedCount === 1 ? '' : 's'}`
              : null}
          </span>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 @3xl:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="border-outline-variant min-w-0 overflow-x-auto rounded-lg border p-3">
          {itemsQuery.isPending ? (
            <Skeleton className="h-96 w-full rounded-lg" />
          ) : itemsQuery.isError ? (
            <p role="alert" className="text-destructive text-sm">
              {userErrorMessage(itemsQuery.error, 'Could not load calendar items.')}
            </p>
          ) : view === 'day' ? (
            <CalendarTimeline
              items={items}
              layers={layers}
              isToday={date === todayISODate()}
              onOpenItem={setOpenItemId}
            />
          ) : (
            <CalendarWeekGrid
              weekStartDate={rangeStartDate}
              items={items}
              layers={layers}
              onOpenItem={setOpenItemId}
            />
          )}
        </div>
        <aside className="flex flex-col gap-2">
          <h2 className="text-on-surface text-sm font-semibold">Layers</h2>
          <CalendarLayerPanel layers={layers} />
        </aside>
      </div>

      <CalendarItemDrawer
        itemId={openItemId}
        onClose={() => {
          setOpenItemId(null);
        }}
        onOpenTask={(orgId, taskId) => {
          router.push(`/orgs/${orgId}/tasks/${taskId}`);
        }}
      />
    </div>
  );
}
