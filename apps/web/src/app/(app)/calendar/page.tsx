/**
 * The full layered-calendar view — server entry (SSR prefetch + hydration).
 *
 * @remarks
 * Prefetches today's calendar-items range and the layers list with the caller's session cookie,
 * dehydrates them, and hands the warm cache to {@link CalendarClient} via `<HydrationBoundary>` —
 * see `docs/engineering/specs/data-layer.md` §7 (and `inbox/page.tsx` for the pattern this mirrors).
 * A failed prefetch degrades gracefully (the client fetches normally); a server/client local-date
 * mismatch across timezones likewise just degrades to a cold client fetch for the correct day,
 * never a wrong day rendered (the client always computes its own local "today").
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
  const queryClient = getServerQueryClient();
  const api = await getServerApi();
  const { startISO, endISO } = dayRangeISO(todayISODate());

  await Promise.allSettled([
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
  ]);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <CalendarClient />
    </HydrationBoundary>
  );
}
