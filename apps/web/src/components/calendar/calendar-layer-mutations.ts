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
  return useUpdateLayerGroupVisibility([layerId]);
}

/**
 * Update every copy of one calendar together.
 *
 * @remarks
 * The calendar panel lists a calendar that arrives on two linked accounts as **one** row. That row
 * has to move every copy: unticking it while a second copy stayed selected would leave the identical
 * events on the grid and make the control look broken. So the unit of this mutation is the set of
 * layer ids the row stands for, not a single layer — one visible decision, one request per copy, one
 * optimistic patch, one rollback.
 *
 * A single-id call is the ordinary case and is exactly what {@link useUpdateLayerVisibility} is.
 *
 * @param layerIds - Every layer the caller's one control governs; usually a single id.
 * @returns The mutation, whose variables are applied to every id.
 *
 * @example
 * ```ts
 * const update = useUpdateLayerGroupVisibility([keep.id, ...redundantIds]);
 * update.mutate({ selected: false });
 * ```
 */
export function useUpdateLayerGroupVisibility(layerIds: readonly string[]) {
  const queryClient = useQueryClient();
  const ids = [...layerIds];
  return useApiMutation<
    readonly CalendarLayersOut['items'][number][],
    CalendarLayerUpdate,
    { rollback: () => void }
  >({
    mutationFn: (vars) =>
      Promise.all(
        ids.map((id) =>
          unwrap(
            () => api.v1.me.calendar.layers[':id'].$patch({ param: { id }, json: vars }),
            'Could not update the calendar layer.',
          ),
        ),
      ),
    onMutate: (vars) =>
      optimisticPatch<CalendarLayersOut>(queryClient, queryKeys.calendarLayers(), (previous) => ({
        items: previous.items.map((layer) =>
          ids.includes(layer.id) ? { ...layer, ...vars } : layer,
        ),
      })),
    onError: (_error, _vars, context) => context?.rollback(),
    invalidateKeys: [queryKeys.calendarLayers(), CALENDAR_ITEMS_PREFIX],
  });
}
