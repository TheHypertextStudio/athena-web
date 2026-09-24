/**
 * The full layered-calendar view — server entry (SSR prefetch + hydration).
 *
 * @remarks
 * Prefetches today's calendar items and layers with the caller's session cookie, then passes the
 * saved timezone into the first render so its date and starting hours are correct before hydration.
 * The prefetch cache reaches {@link CalendarClient} through `<HydrationBoundary>`; see
 * `docs/engineering/specs/data-layer.md` §7. Failed reads fall back to client fetching and the
 * browser's local timezone.
 */
import { HydrationBoundary } from '@tanstack/react-query';
import type { JSX } from 'react';

import { unwrap } from '@/lib/query-core';
import { queryKeys } from '@/lib/query-keys';
import { dehydrate, getServerApi, getServerQueryClient } from '@/lib/query-server';
import { todayISODate } from '@/lib/today';

import CalendarClient from './calendar-client';

/** An instant range, exclusive of `endISO`, over which calendar items are queried. */
interface CalendarDayRange {
  /** Range start (ISO 8601 datetime, inclusive). */
  startISO: string;
  /** Range end (ISO 8601 datetime, exclusive). */
  endISO: string;
}

/** The `[startISO, endISO)` instant range covering one local calendar day. */
function dayRangeISO(date: string): CalendarDayRange {
  const start = new Date(`${date}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { startISO: start.toISOString(), endISO: end.toISOString() };
}

/**
 * The full calendar view page (Server Component).
 *
 * @returns the hydrated calendar view.
 */
export default async function CalendarPage(): Promise<JSX.Element> {
  const initialNow = new Date().toISOString();
  const queryClient = getServerQueryClient();
  const api = await getServerApi();
  const { startISO, endISO } = dayRangeISO(todayISODate());

  const [, , preferencesResult] = await Promise.allSettled([
    queryClient.prefetchQuery({
      queryKey: queryKeys.calendarItems(startISO, endISO),
      queryFn: () =>
        unwrap(
          () =>
            api.v1.me.calendar.items.$get({
              query: { start: startISO, end: endISO, layerIds: undefined, kinds: undefined },
            }),
          'Could not load your calendar.',
        ),
    }),
    queryClient.prefetchQuery({
      queryKey: queryKeys.calendarLayers(),
      queryFn: () =>
        unwrap(() => api.v1.me.calendar.layers.$get(), 'Could not load your calendar layers.'),
    }),
    unwrap(() => api.v1.hub.preferences.$get(), 'Could not load calendar preferences.'),
  ]);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <CalendarClient
        initialNow={initialNow}
        initialTimezone={
          preferencesResult.status === 'fulfilled' ? preferencesResult.value.timezone : undefined
        }
      />
    </HydrationBoundary>
  );
}
