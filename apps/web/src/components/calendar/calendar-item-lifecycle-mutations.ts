'use client';

import type { CalendarItemCreate, CalendarItemOut } from '@docket/types';
import { useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { queryKeys, unwrap, useApiMutation } from '@/lib/query';

import {
  CALENDAR_ITEMS_PREFIX,
  type CombinedRollback,
  removeCalendarItemFromRanges,
} from './calendar-mutation-cache';

/**
 * Create a Docket-native calendar block.
 *
 * @remarks
 * The server assigns identity, so creation stays invalidate-only. Every cached range is refreshed
 * because the newly-created item can appear in any previously visited window; the layers list is
 * also refreshed for lazily-created native layers.
 */
export function useCreateCalendarItem() {
  return useApiMutation<CalendarItemOut, CalendarItemCreate>({
    mutationFn: (input) =>
      unwrap(
        () => api.v1.me.calendar.items.$post({ json: input }),
        'Could not create the calendar item.',
      ),
    invalidateKeys: [queryKeys.calendarLayers(), CALENDAR_ITEMS_PREFIX],
  });
}

/** @deprecated Use {@link useCreateCalendarItem}; retained for legacy block callers. */
export const useCreateNativeBlock = useCreateCalendarItem;

/**
 * Delete a calendar item and optimistically remove it from every cached containing range.
 *
 * @param itemId - The calendar item to delete.
 */
export function useDeleteCalendarItem(itemId: string) {
  const queryClient = useQueryClient();
  return useApiMutation<CalendarItemOut, undefined, CombinedRollback>({
    mutationFn: () =>
      unwrap(
        () => api.v1.me.calendar.items[':id'].$delete({ param: { id: itemId } }),
        'Could not delete the calendar item.',
      ),
    onMutate: () => {
      const rangePatch = removeCalendarItemFromRanges(queryClient, itemId);
      return { rollback: rangePatch.rollback, rangeKeys: rangePatch.rangeKeys };
    },
    onError: (_error, _vars, context) => context?.rollback(),
    invalidateKeys: [queryKeys.calendarItem(itemId)],
    onSettled: async (_data, _error, _vars, context) => {
      if (!context) return;
      await Promise.all(
        context.rangeKeys.map((key) => queryClient.invalidateQueries({ queryKey: key })),
      );
    },
  });
}

/**
 * Retry a provider event's failed or conflicted outbox write.
 *
 * @remarks
 * The provider outcome is server-owned, so retry stays invalidate-only.
 *
 * @param itemId - The item whose provider write should be retried.
 */
export function useRetryCalendarItemWrite(itemId: string) {
  return useApiMutation<CalendarItemOut, undefined>({
    mutationFn: () =>
      unwrap(
        () => api.v1.me.calendar.items[':id']['retry-write'].$post({ param: { id: itemId } }),
        'Could not retry the calendar write.',
      ),
    invalidateKeys: [queryKeys.calendarItem(itemId)],
  });
}
