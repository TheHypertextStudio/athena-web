'use client';

import type {
  CalendarLayerOut,
  CalendarLayersOut,
  CalendarLayerUpdate,
  CalendarSettingsOut,
  CalendarSourceGroupUpdate,
} from '@docket/planning/calendar-contract';
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
  return useApiMutation<CalendarLayerOut, CalendarLayerUpdate, { rollback: () => void }>({
    mutationFn: (vars) =>
      unwrap(
        () => api.v1.me.calendar.layers[':id'].$patch({ param: { id: layerId }, json: vars }),
        'Could not update the calendar layer.',
      ),
    onMutate: (vars) =>
      optimisticPatch<CalendarLayersOut>(queryClient, queryKeys.calendarLayers(), (previous) => ({
        items: previous.items.map((layer) =>
          layer.id === layerId ? Object.assign({}, layer, vars) : layer,
        ),
      })),
    onError: (_error, _vars, context) => context?.rollback(),
    invalidateKeys: [queryKeys.calendarLayers(), CALENDAR_ITEMS_PREFIX],
  });
}

/**
 * Update one server-owned logical calendar in one atomic request.
 *
 * @remarks
 * The API owns group membership and applies visibility to every physical source inside one
 * transaction. The optimistic cache mirrors that result without issuing parallel layer writes.
 *
 * @param groupId - Stable logical source-group id from Calendar settings.
 * @param layerIds - Active physical sources represented by the group.
 */
export function useUpdateCalendarSourceGroupVisibility(
  groupId: string,
  layerIds: readonly string[],
) {
  const queryClient = useQueryClient();
  const ids = [...layerIds];
  return useApiMutation<CalendarSettingsOut, CalendarSourceGroupUpdate, { rollback: () => void }>({
    mutationFn: (vars) =>
      unwrap(
        () =>
          api.v1.me.calendar['source-groups'][':id'].$patch({
            param: { id: groupId },
            json: vars,
          }),
        'Could not update calendar visibility.',
      ),
    onMutate: (vars) => {
      const layers = optimisticPatch<CalendarLayersOut>(
        queryClient,
        queryKeys.calendarLayers(),
        (previous) => ({
          items: previous.items.map((layer) =>
            ids.includes(layer.id) ? Object.assign({}, layer, vars) : layer,
          ),
        }),
      );
      const settings = optimisticPatch<CalendarSettingsOut>(
        queryClient,
        queryKeys.calendarSettings(),
        (previous) => ({
          ...previous,
          sourceGroups: previous.sourceGroups.map((group) =>
            group.id === groupId ? Object.assign({}, group, vars) : group,
          ),
        }),
      );
      return {
        rollback: () => {
          layers.rollback();
          settings.rollback();
        },
      };
    },
    onError: (_error, _vars, context) => context?.rollback(),
    invalidateKeys: [
      queryKeys.calendarSettings(),
      queryKeys.calendarLayers(),
      CALENDAR_ITEMS_PREFIX,
    ],
  });
}
