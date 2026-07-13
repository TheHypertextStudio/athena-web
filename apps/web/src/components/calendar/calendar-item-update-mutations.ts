'use client';

import type { CalendarItemOut, CalendarItemUpdate } from '@docket/types';
import { useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { optimisticPatch, queryKeys, unwrap, useApiMutation } from '@/lib/query';
import { acquireSerializedOptimisticWrite } from '@/lib/serialized-optimistic-write';

import {
  CALENDAR_ITEMS_PREFIX,
  type CombinedRollback,
  patchCalendarItemAcrossRanges,
  type SerializedCombinedRollback,
} from './calendar-mutation-cache';

/** Calendar and Agenda share this intentional cross-item serialization boundary. */
const DYNAMIC_UPDATE_QUEUE_KEY = 'calendar-item-by-id-updates';

/** Build the optimistic state shown while a calendar item write is pending. */
function pendingItemPatch(patch: CalendarItemUpdate): (item: CalendarItemOut) => CalendarItemOut {
  return (item) => ({
    ...item,
    ...patch,
    ...(item.kind === 'provider_event' ? { syncState: 'push_pending' as const } : {}),
  });
}

/**
 * Update one known calendar item across its detail cache and every cached containing range.
 *
 * @param itemId - The calendar item to update.
 */
export function useUpdateCalendarItem(itemId: string) {
  const queryClient = useQueryClient();
  return useApiMutation<CalendarItemOut, CalendarItemUpdate, CombinedRollback>({
    mutationFn: (vars) =>
      unwrap(
        () => api.v1.me.calendar.items[':id'].$patch({ param: { id: itemId }, json: vars }),
        'Could not update the calendar item.',
      ),
    onMutate: (vars) => {
      const applyPending = pendingItemPatch(vars);
      const detailPatch = optimisticPatch<CalendarItemOut>(
        queryClient,
        queryKeys.calendarItem(itemId),
        applyPending,
      );
      const rangePatch = patchCalendarItemAcrossRanges(queryClient, itemId, applyPending);
      return {
        rollback: () => {
          detailPatch.rollback();
          rangePatch.rollback();
        },
        rangeKeys: rangePatch.rangeKeys,
      };
    },
    onError: (_error, _vars, context) => context?.rollback(),
    invalidateKeys: [CALENDAR_ITEMS_PREFIX],
  });
}

/** Variables for a canvas update whose item identity is known only when the gesture ends. */
export interface UpdateCalendarItemByIdVariables {
  readonly itemId: string;
  readonly patch: CalendarItemUpdate;
}

/**
 * Update arbitrary calendar items from the shared scheduling canvas.
 *
 * @remarks
 * Optimistic setup is serialized across Calendar and Agenda consumers. A setup failure restores
 * every partial cache edit and releases the queue before rethrowing; settlement always releases
 * the next write after its targeted invalidations complete.
 */
export function useUpdateCalendarItemById() {
  const queryClient = useQueryClient();
  return useApiMutation<
    CalendarItemOut,
    UpdateCalendarItemByIdVariables,
    SerializedCombinedRollback
  >({
    mutationFn: ({ itemId, patch }) =>
      unwrap(
        () =>
          api.v1.me.calendar.items[':id'].$patch({
            param: { id: itemId },
            json: patch,
          }),
        'Could not update the calendar item.',
      ),
    onMutate: async ({ itemId, patch }) => {
      const lease = await acquireSerializedOptimisticWrite(queryClient, DYNAMIC_UPDATE_QUEUE_KEY);
      const applyPending = pendingItemPatch(patch);
      const applied: { rollback: () => void }[] = [];
      try {
        const detailPatch = optimisticPatch<CalendarItemOut>(
          queryClient,
          queryKeys.calendarItem(itemId),
          applyPending,
        );
        applied.push(detailPatch);
        const rangePatch = patchCalendarItemAcrossRanges(queryClient, itemId, applyPending);
        applied.push(rangePatch);
        return {
          rollback: () => {
            for (const optimistic of [...applied].reverse()) optimistic.rollback();
          },
          rangeKeys: rangePatch.rangeKeys,
          releaseQueue: lease.release,
        };
      } catch (error) {
        for (const optimistic of applied.reverse()) optimistic.rollback();
        lease.release();
        throw error;
      }
    },
    onError: (_error, _vars, context) => context?.rollback(),
    onSettled: async (_data, _error, _vars, context) => {
      try {
        await queryClient.invalidateQueries({ queryKey: CALENDAR_ITEMS_PREFIX });
      } finally {
        context?.releaseQueue();
      }
    },
  });
}
