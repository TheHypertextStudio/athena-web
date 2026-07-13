import type { CalendarItemOut, CalendarItemsRangeOut } from '@docket/types';
import type { QueryClient, QueryKey } from '@tanstack/react-query';

/**
 * Shared prefix for calendar item range and detail caches.
 *
 * @remarks
 * Layer visibility changes intentionally invalidate this broad prefix because they can affect every
 * visible range. Item-level writes invalidate only the range keys they actually patch.
 */
export const CALENDAR_ITEMS_PREFIX: QueryKey = ['me', 'calendar-items'];

/** One range cache entry, snapshotted for rollback. */
interface RangeSnapshot {
  key: QueryKey;
  data: CalendarItemsRangeOut;
}

/** The rollback and touched keys produced by an optimistic range-cache edit. */
export interface RangePatchResult {
  /** Restore every touched range entry to its pre-patch snapshot. */
  rollback: () => void;
  /** The range keys actually patched. */
  rangeKeys: QueryKey[];
}

/** Rollback context shared by item-detail and range-cache mutations. */
export interface CombinedRollback {
  rollback: () => void;
  rangeKeys: QueryKey[];
}

/** Rollback context for serialized dynamic writes. */
export interface SerializedCombinedRollback extends CombinedRollback {
  releaseQueue: () => void;
}

/** Whether a cached key belongs to a calendar-item range rather than an item detail. */
function isRangeKey(key: QueryKey): boolean {
  return key[0] === 'me' && key[1] === 'calendar-items' && key[2] !== 'detail';
}

/** Find every cached range that currently contains the requested item. */
function findRangesContainingItem(queryClient: QueryClient, itemId: string): RangeSnapshot[] {
  return queryClient
    .getQueryCache()
    .findAll({ queryKey: CALENDAR_ITEMS_PREFIX })
    .filter((cached) => isRangeKey(cached.queryKey))
    .flatMap((cached) => {
      const data = queryClient.getQueryData<CalendarItemsRangeOut>(cached.queryKey);
      if (!data?.items.some((item) => item.id === itemId)) return [];
      return [{ key: cached.queryKey, data }];
    });
}

/** Apply a recipe to one item in every cached range that contains it. */
export function patchCalendarItemAcrossRanges(
  queryClient: QueryClient,
  itemId: string,
  recipe: (item: CalendarItemOut) => CalendarItemOut,
): RangePatchResult {
  const snapshots = findRangesContainingItem(queryClient, itemId);
  const applied: RangeSnapshot[] = [];
  try {
    for (const snapshot of snapshots) {
      const { key, data } = snapshot;
      queryClient.setQueryData<CalendarItemsRangeOut>(key, {
        ...data,
        items: data.items.map((item) => (item.id === itemId ? recipe(item) : item)),
      });
      applied.push(snapshot);
    }
  } catch (error) {
    for (const { key, data } of applied.reverse()) queryClient.setQueryData(key, data);
    throw error;
  }
  return {
    rollback: () => {
      for (const { key, data } of snapshots) queryClient.setQueryData(key, data);
    },
    rangeKeys: snapshots.map((snapshot) => snapshot.key),
  };
}

/** Remove one item from every cached range that contains it. */
export function removeCalendarItemFromRanges(
  queryClient: QueryClient,
  itemId: string,
): RangePatchResult {
  const snapshots = findRangesContainingItem(queryClient, itemId);
  for (const { key, data } of snapshots) {
    queryClient.setQueryData<CalendarItemsRangeOut>(key, {
      ...data,
      items: data.items.filter((item) => item.id !== itemId),
    });
  }
  return {
    rollback: () => {
      for (const { key, data } of snapshots) queryClient.setQueryData(key, data);
    },
    rangeKeys: snapshots.map((snapshot) => snapshot.key),
  };
}
