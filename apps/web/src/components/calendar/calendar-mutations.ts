'use client';

/**
 * `calendar/calendar-mutations` — the layered calendar's write layer: native-block create,
 * calendar-item edit/delete/retry-write, layer-visibility edit, and task-link create/detach.
 *
 * @remarks
 * Follows `agenda-mutations.ts`'s shape: every write goes through {@link useApiMutation}, patches
 * the caches the calendar surfaces actually read via {@link optimisticPatch} (rollback on error),
 * and reconciles with the server via `invalidateKeys` on settle. Two writes need more than
 * `optimisticPatch` gives out of the box because the same item can appear in several already-
 * fetched range windows at once (today's range, this week's range, …): {@link
 * patchCalendarItemAcrossRanges} and {@link removeCalendarItemFromRanges} search the query cache
 * for every `calendarItems(...)` entry that currently contains the item and patch/remove it there
 * too, returning exactly the keys touched so the mutation can invalidate only those on settle
 * (never a blanket "every range" invalidation).
 *
 * Per `docs/engineering/specs/data-layer.md` §2.4, server-assigned-identity inserts (a new native
 * block; the server mints its id) and viewer-filtered derived reads (linked-task summaries) stay
 * invalidate-only rather than fabricating an optimistic entity the client can't faithfully know.
 */
import type {
  CalendarItemCreate,
  CalendarItemOut,
  CalendarItemsRangeOut,
  CalendarItemTaskLinkCreate,
  CalendarItemTaskLinkOut,
  CalendarItemTaskLinkResultOut,
  CalendarItemRelationOut,
  CalendarItemUpdate,
  CalendarLayersOut,
  CalendarLayerUpdate,
} from '@docket/types';
import { CalendarItemId, OrganizationId, TaskId } from '@docket/types';
import { type QueryKey, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { optimisticPatch, queryKeys, unwrap, useApiMutation } from '@/lib/query';
import { acquireSerializedOptimisticWrite } from '@/lib/serialized-optimistic-write';

/**
 * The literal shared prefix of every `/v1/me/calendar/items` cache entry — both the range reads
 * (`queryKeys.calendarItems(startISO, endISO)`) and the detail reads
 * (`queryKeys.calendarItem(itemId)`, deliberately NOT nested under a range key; see
 * `query-keys.ts`). Used only for the intentionally broad, prefix-based invalidation a
 * layer-visibility change requires (it can change what every range read returns) — every other
 * write here invalidates the specific range keys it actually touched.
 */
const CALENDAR_ITEMS_PREFIX: QueryKey = ['me', 'calendar-items'];

/** Calendar and Agenda share this intentional cross-item serialization boundary. */
const DYNAMIC_UPDATE_QUEUE_KEY = 'calendar-item-by-id-updates';

/** Whether a cached query key is a `calendarItems(startISO, endISO)` range entry (not a detail). */
function isRangeKey(key: QueryKey): boolean {
  return key[0] === 'me' && key[1] === 'calendar-items' && key[2] !== 'detail';
}

/** One range cache entry, snapshotted for rollback. */
interface RangeSnapshot {
  key: QueryKey;
  data: CalendarItemsRangeOut;
}

/** Find every cached range entry that currently contains the given calendar item. */
function findRangesContainingItem(
  queryClient: ReturnType<typeof useQueryClient>,
  itemId: string,
): RangeSnapshot[] {
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

/** The result of an across-ranges optimistic patch: how to undo it, and which keys it touched. */
interface RangePatchResult {
  /** Restore every touched range entry to its pre-patch snapshot. */
  rollback: () => void;
  /** The range keys actually patched (only these need invalidating on settle). */
  rangeKeys: QueryKey[];
}

/** Optimistically apply `recipe` to one item across every range cache entry that contains it. */
function patchCalendarItemAcrossRanges(
  queryClient: ReturnType<typeof useQueryClient>,
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
    rangeKeys: snapshots.map((s) => s.key),
  };
}

/** Optimistically remove one item across every range cache entry that contains it. */
function removeCalendarItemFromRanges(
  queryClient: ReturnType<typeof useQueryClient>,
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
    rangeKeys: snapshots.map((s) => s.key),
  };
}

/** Combine an item-detail rollback with an across-ranges patch's rollback + touched keys. */
interface CombinedRollback {
  rollback: () => void;
  rangeKeys: QueryKey[];
}

/** Rollback context for serialized dynamic writes, including release of the next optimistic edit. */
interface SerializedCombinedRollback extends CombinedRollback {
  releaseQueue: () => void;
}

/**
 * Create a Docket-native calendar block (`POST /v1/me/calendar/items`).
 *
 * @remarks
 * Invalidate-only: the server mints the item's id, so there is no faithful optimistic entity to
 * show in the interim (data-layer.md §2.4). The caller supplies which range-list cache keys the
 * new block affects (the windows it might fall into) since a not-yet-fetched range isn't in the
 * cache to search; `calendarLayers()` is always invalidated too, since a block filed on a lazily-
 * created default native layer can make a new layer appear.
 */
export function useCreateCalendarItem() {
  const queryClient = useQueryClient();
  return useApiMutation<
    CalendarItemOut,
    { input: CalendarItemCreate; rangeKeys: readonly QueryKey[] }
  >({
    mutationFn: (vars) =>
      unwrap(
        () => api.v1.me.calendar.items.$post({ json: vars.input }),
        'Could not create the calendar item.',
      ),
    invalidateKeys: [queryKeys.calendarLayers()],
    onSettled: async (_data, _error, vars) => {
      await Promise.all(
        vars.rangeKeys.map((key) => queryClient.invalidateQueries({ queryKey: key })),
      );
    },
  });
}

/** @deprecated Use {@link useCreateCalendarItem}; retained for legacy block callers. */
export const useCreateNativeBlock = useCreateCalendarItem;

/**
 * Update a calendar item's core fields (`PATCH /v1/me/calendar/items/:id`).
 *
 * @remarks
 * Optimistically patches BOTH the item-detail cache and every range-list cache entry that
 * currently contains the item, so every surface showing it updates instantly. For
 * `provider_event` items, the patch also sets a visual `syncState: 'push_pending'` — signalling
 * "this edit is on its way to the provider" — without fabricating any other server-only state;
 * every other item kind's `syncState` is left untouched. Rolls back both caches on error, and
 * invalidates the item detail plus exactly the range keys the optimistic patch touched on settle.
 *
 * @param itemId - The calendar item to edit.
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
      const pendingPatch = (item: CalendarItemOut): CalendarItemOut => ({
        ...item,
        ...vars,
        ...(item.kind === 'provider_event' ? { syncState: 'push_pending' as const } : {}),
      });
      const detailPatch = optimisticPatch<CalendarItemOut>(
        queryClient,
        queryKeys.calendarItem(itemId),
        pendingPatch,
      );
      const rangePatch = patchCalendarItemAcrossRanges(queryClient, itemId, pendingPatch);
      return {
        rollback: () => {
          detailPatch.rollback();
          rangePatch.rollback();
        },
        rangeKeys: rangePatch.rangeKeys,
      };
    },
    onError: (_error, _vars, onMutateResult) => onMutateResult?.rollback(),
    invalidateKeys: [queryKeys.calendarItem(itemId)],
    // The 4th positional param is `onMutate`'s return value (TanStack v5 also passes a 5th,
    // framework-level `MutationFunctionContext` we don't use here).
    onSettled: async (_data, _error, _vars, onMutateResult) => {
      if (!onMutateResult) return;
      await Promise.all(
        onMutateResult.rangeKeys.map((key) => queryClient.invalidateQueries({ queryKey: key })),
      );
    },
  });
}

/** Variables for a canvas-owned update where the dragged item id is known only at gesture end. */
export interface UpdateCalendarItemByIdVariables {
  readonly itemId: string;
  readonly patch: CalendarItemUpdate;
}

/** Update arbitrary calendar items from the shared scheduling canvas. */
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
      const pendingPatch = (item: CalendarItemOut): CalendarItemOut => ({
        ...item,
        ...patch,
        ...(item.kind === 'provider_event' ? { syncState: 'push_pending' as const } : {}),
      });
      const applied: { rollback: () => void }[] = [];
      try {
        const detailPatch = optimisticPatch<CalendarItemOut>(
          queryClient,
          queryKeys.calendarItem(itemId),
          pendingPatch,
        );
        applied.push(detailPatch);
        const rangePatch = patchCalendarItemAcrossRanges(queryClient, itemId, pendingPatch);
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
    onSettled: async (_data, _error, vars, context) => {
      try {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.calendarItem(vars.itemId) }),
          ...(context?.rangeKeys ?? []).map((key) =>
            queryClient.invalidateQueries({ queryKey: key }),
          ),
        ]);
      } finally {
        context?.releaseQueue();
      }
    },
  });
}

/**
 * Delete a calendar item (`DELETE /v1/me/calendar/items/:id`).
 *
 * @remarks
 * Optimistically removes the item from every range-list cache entry that currently contains it;
 * rollback on error restores it. Invalidates the item detail (the server returns it as a
 * tombstone) plus exactly the touched range keys on settle.
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
    onError: (_error, _vars, onMutateResult) => onMutateResult?.rollback(),
    invalidateKeys: [queryKeys.calendarItem(itemId)],
    onSettled: async (_data, _error, _vars, onMutateResult) => {
      if (!onMutateResult) return;
      await Promise.all(
        onMutateResult.rangeKeys.map((key) => queryClient.invalidateQueries({ queryKey: key })),
      );
    },
  });
}

/**
 * Retry a `provider_event` item's failed/conflicted outbox write, keeping local changes
 * (`POST /v1/me/calendar/items/:id/retry-write`).
 *
 * @remarks
 * Invalidate-only: the retry's outcome (applied / still failed / re-conflicted) is determined
 * server-side, so the client can't optimistically know the item's next `syncState`.
 *
 * @param itemId - The calendar item whose outbox write to retry.
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

/**
 * Update a calendar layer's visibility (and, for native layers, title/color)
 * (`PATCH /v1/me/calendar/layers/:id`).
 *
 * @remarks
 * Optimistically patches the matching layer in the `calendarLayers()` list cache, rolling back on
 * error. Visibility changes what every range read returns (a deselected layer's items drop out of
 * every window), so this invalidates `calendarLayers()` plus the broad
 * `['me', 'calendar-items']` prefix — the one deliberately coarse invalidation in this module,
 * per the brief's call for a broad-not-narrow blast here.
 *
 * @param layerId - The calendar layer to edit.
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
      optimisticPatch<CalendarLayersOut>(queryClient, queryKeys.calendarLayers(), (prev) => ({
        items: prev.items.map((layer) => (layer.id === layerId ? { ...layer, ...vars } : layer)),
      })),
    onError: (_error, _vars, context) => context?.rollback(),
    invalidateKeys: [queryKeys.calendarLayers(), CALENDAR_ITEMS_PREFIX],
  });
}

/** Body for {@link useLinkTaskToItem} — link an existing task, without the `mode` discriminant. */
export type LinkExistingTaskVariables = Omit<
  Extract<CalendarItemTaskLinkCreate, { mode: 'link' }>,
  'mode'
>;

/**
 * Link an existing task to a calendar item (`POST /v1/me/calendar/items/:id/tasks`, `mode: 'link'`).
 *
 * @remarks
 * Invalidate-only: linked-task summaries are server-computed with viewer visibility filtering
 * (data-layer.md §2.4), so the client does not fabricate one.
 *
 * @param itemId - The calendar item to link the task to.
 */
export function useLinkTaskToItem(itemId: string) {
  return useApiMutation<CalendarItemTaskLinkResultOut, LinkExistingTaskVariables>({
    mutationFn: (vars) =>
      unwrap(
        () =>
          api.v1.me.calendar.items[':id'].tasks.$post({
            param: { id: itemId },
            json: { mode: 'link', ...vars },
          }),
        'Could not link the task.',
      ),
    invalidateKeys: [queryKeys.calendarItem(itemId)],
  });
}

/** Link an arbitrary dragged task to an arbitrary calendar target. */
export function useLinkTaskToCalendarItem() {
  const queryClient = useQueryClient();
  return useApiMutation<
    CalendarItemTaskLinkResultOut,
    {
      itemId: string;
      taskId: string;
      organizationId: string;
      role: 'contained' | 'related';
    }
  >({
    mutationFn: (vars) =>
      unwrap(
        () =>
          api.v1.me.calendar.items[':id'].tasks.$post({
            param: { id: CalendarItemId.parse(vars.itemId) },
            json: {
              mode: 'link',
              taskId: TaskId.parse(vars.taskId),
              organizationId: OrganizationId.parse(vars.organizationId),
              role: vars.role,
            },
          }),
        'Could not add this task to the calendar item.',
      ),
    onSettled: async (_data, _error, vars) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.calendarItem(vars.itemId) });
    },
  });
}

/** Associate one owned calendar item with another target. */
export function useRelateCalendarItems() {
  const queryClient = useQueryClient();
  return useApiMutation<
    CalendarItemRelationOut,
    { sourceItemId: string; targetItemId: string; role: 'contained' | 'related' }
  >({
    mutationFn: (vars) =>
      unwrap(
        () =>
          api.v1.me.calendar.items[':id'].relations.$post({
            param: { id: CalendarItemId.parse(vars.sourceItemId) },
            json: {
              targetItemId: CalendarItemId.parse(vars.targetItemId),
              role: vars.role,
            },
          }),
        'Could not relate these calendar items.',
      ),
    onSettled: async (_data, _error, vars) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.calendarItem(vars.sourceItemId) }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.calendarItemRelations(vars.sourceItemId),
        }),
      ]);
    },
  });
}

/** Remove one related/contained calendar item from a target. */
export function useDetachCalendarItemRelation(sourceItemId: string, targetItemId: string) {
  return useApiMutation<CalendarItemRelationOut, undefined>({
    mutationFn: () =>
      unwrap(
        () =>
          api.v1.me.calendar.items[':id'].relations[':relatedItemId'].$delete({
            param: {
              id: CalendarItemId.parse(sourceItemId),
              relatedItemId: CalendarItemId.parse(targetItemId),
            },
          }),
        'Could not remove this calendar relationship.',
      ),
    invalidateKeys: [
      queryKeys.calendarItem(sourceItemId),
      queryKeys.calendarItemRelations(sourceItemId),
    ],
  });
}

/** Body for {@link useCreateAndLinkTask} — create-and-link, without the `mode` discriminant. */
export type CreateAndLinkTaskVariables = Omit<
  Extract<CalendarItemTaskLinkCreate, { mode: 'create' }>,
  'mode'
>;

/**
 * Create a new task and link it to a calendar item
 * (`POST /v1/me/calendar/items/:id/tasks`, `mode: 'create'`).
 *
 * @remarks
 * Invalidate-only, for the same reason as {@link useLinkTaskToItem} — the created task and its
 * viewer-filtered link summary are server-computed.
 *
 * @param itemId - The calendar item to create and link the task to.
 */
export function useCreateAndLinkTask(itemId: string) {
  return useApiMutation<CalendarItemTaskLinkResultOut, CreateAndLinkTaskVariables>({
    mutationFn: (vars) =>
      unwrap(
        () =>
          api.v1.me.calendar.items[':id'].tasks.$post({
            param: { id: itemId },
            json: { mode: 'create', ...vars },
          }),
        'Could not create and link the task.',
      ),
    invalidateKeys: [queryKeys.calendarItem(itemId)],
  });
}

/**
 * Detach a task from a calendar item (`DELETE /v1/me/calendar/items/:id/tasks/:taskId`).
 *
 * @remarks
 * Invalidate-only, for the same reason as {@link useLinkTaskToItem}.
 *
 * @param itemId - The calendar item to detach the task from.
 * @param taskId - The task to detach.
 */
export function useDetachTaskFromItem(itemId: string, taskId: string) {
  return useApiMutation<CalendarItemTaskLinkOut, undefined>({
    mutationFn: () =>
      unwrap(
        () =>
          api.v1.me.calendar.items[':id'].tasks[':taskId'].$delete({
            param: { id: itemId, taskId },
          }),
        'Could not detach the task.',
      ),
    invalidateKeys: [queryKeys.calendarItem(itemId)],
  });
}
