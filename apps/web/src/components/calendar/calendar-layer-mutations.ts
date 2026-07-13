'use client';

import type { CalendarLayersOut, CalendarLayerUpdate } from '@docket/types';
import { useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { optimisticPatch, queryKeys, unwrap, useApiMutation } from '@/lib/query';

import { CALENDAR_ITEMS_PREFIX } from './calendar-mutation-cache';

/**
 * Update a calendar layer's visibility and editable native-layer fields.
 *
 * @remarks
 * The layer list updates optimistically. Visibility can change every range read, so this is the
 * one intentionally broad calendar-item-prefix invalidation in the write layer.
 *
 * @param layerId - The calendar layer to update.
 */
export function useUpdateLayerVisibility(layerId: string) {
  const queryClient = useQueryClient();
  return useApiMutation<
    CalendarLayersOut['items'][number],
    CalendarLayerUpdate,
    { rollback: () => void }
  >({
    mutationFn: (vars) =>
      unwrap(
        () => api.v1.me.calendar.layers[':id'].$patch({ param: { id: layerId }, json: vars }),
        'Could not update the calendar layer.',
      ),
    onMutate: (vars) =>
      optimisticPatch<CalendarLayersOut>(queryClient, queryKeys.calendarLayers(), (previous) => ({
        items: previous.items.map((layer) =>
          layer.id === layerId ? { ...layer, ...vars } : layer,
        ),
      })),
    onError: (_error, _vars, context) => context?.rollback(),
    invalidateKeys: [queryKeys.calendarLayers(), CALENDAR_ITEMS_PREFIX],
  });
}
