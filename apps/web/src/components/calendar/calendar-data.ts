'use client';

/**
 * `calendar/calendar-data` — the layered calendar's read layer: typed query definitions for
 * calendar layers, calendar items (range + detail), and (first-party Google) calendar settings,
 * plus a hover/focus prefetch helper for item cards.
 *
 * @remarks
 * Follows the `agenda-context.tsx` module-level def-factory pattern exactly: each def is a plain
 * function returning an {@link apiQueryOptions} result, so the same definition serves the active
 * read, cache priming (`setQueryData`), and prefetch (`usePrefetchApi`) without drift. Mutations
 * live alongside in `calendar-mutations.ts`.
 *
 * @see `docs/engineering/specs/data-layer.md` for the binding data-layer rules.
 */
import type { CalendarItemKind } from '@docket/types';
import { useCallback } from 'react';

import { api } from '@/lib/api';
import { apiQueryOptions, queryKeys, STALE, usePrefetchApi } from '@/lib/query';

/** Optional filters for {@link calendarItemsDef}. */
export interface CalendarItemsRangeFilter {
  /** Restrict to these layer ids; omitted returns items across every selected layer. */
  layerIds?: readonly string[];
  /** Restrict to these item kinds; omitted returns every kind. */
  kinds?: readonly CalendarItemKind[];
}

/** Join a filter list into the comma-separated query-param convention `/v1/me/calendar/items` reads. */
function csv(values: readonly string[] | undefined): string | undefined {
  return values && values.length > 0 ? values.join(',') : undefined;
}

/** The calendar-layers query definition (every layer for the signed-in user, selected or not). */
export function calendarLayersDef() {
  return apiQueryOptions(
    queryKeys.calendarLayers(),
    () => api.v1.me.calendar.layers.$get(),
    'Could not load your calendar layers.',
    { staleTime: STALE.standard },
  );
}

/**
 * The calendar-items range query definition for `[startISO, endISO)`.
 *
 * @remarks
 * `STALE.volatile` — calendar data changes both from the caller's own edits and from
 * background provider sync, so this reads closer to real-time than a typical list.
 *
 * @param startISO - Range start (ISO 8601 datetime, inclusive).
 * @param endISO - Range end (ISO 8601 datetime, exclusive).
 * @param filter - Optional layer/kind restrictions.
 */
export function calendarItemsDef(
  startISO: string,
  endISO: string,
  filter?: CalendarItemsRangeFilter,
) {
  return apiQueryOptions(
    queryKeys.calendarItems(startISO, endISO),
    () =>
      api.v1.me.calendar.items.$get({
        query: {
          start: startISO,
          end: endISO,
          layerIds: csv(filter?.layerIds),
          kinds: csv(filter?.kinds),
        },
      }),
    'Could not load your calendar.',
    { staleTime: STALE.volatile },
  );
}

/** The calendar-item detail query definition, independent of any particular range window. */
export function calendarItemDef(itemId: string) {
  return apiQueryOptions(
    queryKeys.calendarItem(itemId),
    () => api.v1.me.calendar.items[':id'].$get({ param: { id: itemId } }),
    'Could not load the calendar item.',
    { staleTime: STALE.volatile },
  );
}

/**
 * The first-party Google Calendar settings query definition (linked accounts + selectable
 * calendars + layers).
 *
 * @remarks
 * Shares `queryKeys.calendarSettings()` with the inline definition in
 * `components/settings/google-calendar-settings.tsx` — TanStack Query caches by key, not by
 * definition-object identity, so both resolve to the same cache entry. Exported here so Task 9's
 * calendar surfaces can read the same settings without duplicating the definition.
 */
export function calendarSettingsDef() {
  return apiQueryOptions(
    queryKeys.calendarSettings(),
    () => api.v1.me.calendar.$get(),
    'Could not load Google Calendar settings.',
    { staleTime: STALE.standard },
  );
}

/**
 * Returns a stable `(itemId) => void` that prefetches a calendar item's detail into the cache —
 * wire it to a calendar item card's `onMouseEnter`/`onFocus` (mirrors how
 * `agenda-context.tsx` prefetches neighbouring days) so opening the item's detail renders from a
 * warm cache. No consuming component exists yet (Task 9 wires the calendar UI); this hook is
 * exported now so that work has a ready prefetcher.
 */
export function usePrefetchCalendarItem(): (itemId: string) => void {
  const prefetch = usePrefetchApi();
  return useCallback(
    (itemId: string) => {
      prefetch(calendarItemDef(itemId));
    },
    [prefetch],
  );
}
