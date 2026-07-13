/**
 * Behavior tests for the layered calendar's data layer (`calendar-data.ts` +
 * `calendar-mutations.ts`).
 *
 * @remarks
 * Pins the contract Task 9's calendar UI will depend on:
 *
 * - Each read def unwraps its mocked RPC call to the parsed body.
 * - `useUpdateCalendarItem` optimistically patches BOTH the item-detail cache and any seeded
 *   range-list cache entry containing the item, rolls both back on a rejected mutation, and
 *   invalidates the item detail plus exactly the range keys it touched on success.
 * - `useUpdateLayerVisibility` optimistically patches the layers list and invalidates it plus the
 *   broad `['me', 'calendar-items']` prefix.
 * - `useDeleteCalendarItem` optimistically removes the item from a seeded range-list cache entry
 *   and restores it on rollback.
 * - The link/create-and-link/detach/retry-write hooks never touch the cache directly (no
 *   optimistic mutation) — only the settle-time invalidation refetches.
 */
import {
  CalendarItemId,
  type CalendarItemOut,
  type CalendarItemsRangeOut,
  CalendarLayerId,
  type CalendarLayerOut,
  type CalendarLayersOut,
  OrganizationId,
  TaskId,
} from '@docket/types';
import { QueryClient, QueryClientProvider, type QueryKey } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { JSX, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  layersGet,
  itemsGet,
  itemsPost,
  itemGet,
  itemPatch,
  itemDelete,
  itemRetryWrite,
  layerPatch,
  itemTasksPost,
  itemTaskDelete,
} = vi.hoisted(() => ({
  layersGet: vi.fn(),
  itemsGet: vi.fn(),
  itemsPost: vi.fn(),
  itemGet: vi.fn(),
  itemPatch: vi.fn(),
  itemDelete: vi.fn(),
  itemRetryWrite: vi.fn(),
  layerPatch: vi.fn(),
  itemTasksPost: vi.fn(),
  itemTaskDelete: vi.fn(),
}));

vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      me: {
        calendar: {
          layers: {
            $get: layersGet,
            ':id': { $patch: layerPatch },
          },
          items: {
            $get: itemsGet,
            $post: itemsPost,
            ':id': {
              $get: itemGet,
              $patch: itemPatch,
              $delete: itemDelete,
              'retry-write': { $post: itemRetryWrite },
              tasks: {
                $post: itemTasksPost,
                ':taskId': { $delete: itemTaskDelete },
              },
            },
          },
        },
      },
    },
  },
}));

import {
  calendarItemDef,
  calendarItemsDef,
  calendarLayersDef,
} from '../../src/components/calendar/calendar-data';
import {
  useCreateAndLinkTask,
  useDeleteCalendarItem,
  useDetachTaskFromItem,
  useLinkTaskToItem,
  useRetryCalendarItemWrite,
  useUpdateCalendarItem,
  useUpdateCalendarItemById,
  useUpdateLayerVisibility,
} from '../../src/components/calendar/calendar-mutations';
import { queryKeys, useApiListQuery, useApiQuery } from '../../src/lib/query';

const ORG_ID = OrganizationId.parse('01BX5ZZKBKACTAV9WEVGEMMVRZ');
const TASK_ID = TaskId.parse('01ARZ3NDEKTSV4RRFFQ69G5FA0');
const ITEM_ID = CalendarItemId.parse('01BX5ZZKBKACTAV9WEVGEMMVS1');
const OTHER_ITEM_ID = CalendarItemId.parse('01BX5ZZKBKACTAV9WEVGEMMVS2');
const LAYER_ID = CalendarLayerId.parse('01BX5ZZKBKACTAV9WEVGEMMVN1');
const START = '2026-07-01T00:00:00.000Z';
const END = '2026-07-02T00:00:00.000Z';

/** A typed mock Hono RPC response for the mutation/query unwrap layer. */
function okResponse<T>(body: T) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

/** A minimal `native_block` calendar item fixture. */
function nativeItem(overrides: Partial<CalendarItemOut> = {}): CalendarItemOut {
  return {
    id: ITEM_ID,
    layerId: LAYER_ID,
    connectionId: null,
    kind: 'native_block',
    provider: null,
    externalCalendarId: null,
    externalEventId: null,
    recurringEventId: null,
    recurrenceInstanceKey: null,
    status: 'confirmed',
    title: 'Focus block',
    description: null,
    location: null,
    htmlLink: null,
    startsAt: '2026-07-01T16:00:00.000Z',
    endsAt: '2026-07-01T17:00:00.000Z',
    allDayStartDate: null,
    allDayEndDate: null,
    timezone: null,
    organizer: null,
    attendees: [],
    permissions: { canEditCore: true, canDelete: true, readOnlyReason: null },
    syncState: 'clean',
    hasConflict: false,
    updatedExternalAt: null,
    archivedAt: null,
    linkedTasks: [],
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

/** A `provider_event` calendar item fixture, for `syncState` push-pending assertions. */
function providerItem(overrides: Partial<CalendarItemOut> = {}): CalendarItemOut {
  return {
    ...nativeItem(),
    kind: 'provider_event',
    provider: 'google',
    connectionId: null,
    externalCalendarId: 'primary',
    externalEventId: 'evt_1',
    syncState: 'clean',
    ...overrides,
  };
}

/** A calendar layer fixture. */
function layer(overrides: Partial<CalendarLayerOut> = {}): CalendarLayerOut {
  return {
    id: LAYER_ID,
    connectionId: null,
    provider: null,
    sourceKind: 'native_blocks',
    externalLayerId: null,
    title: 'My blocks',
    description: null,
    timezone: null,
    color: null,
    accessRole: null,
    primary: false,
    selected: true,
    visibleByDefault: true,
    editableCore: true,
    lastSyncedAt: null,
    lastError: null,
    watchExpiresAt: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

/** A fresh, retry-free QueryClient + provider wrapper for one test. */
function makeWrapper(): {
  client: QueryClient;
  wrapper: (props: { children: ReactNode }) => JSX.Element;
} {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

beforeEach(() => {
  layersGet.mockReset().mockResolvedValue(okResponse({ items: [layer()] }));
  itemsGet.mockReset().mockResolvedValue(okResponse({ layers: [layer()], items: [nativeItem()] }));
  itemsPost.mockReset().mockResolvedValue(okResponse(nativeItem()));
  itemGet.mockReset().mockResolvedValue(okResponse(nativeItem()));
  itemPatch.mockReset().mockResolvedValue(okResponse(nativeItem()));
  itemDelete
    .mockReset()
    .mockResolvedValue(okResponse(nativeItem({ archivedAt: '2026-07-01T00:00:00.000Z' })));
  itemRetryWrite.mockReset().mockResolvedValue(okResponse(nativeItem()));
  layerPatch.mockReset().mockResolvedValue(okResponse(layer()));
  itemTasksPost.mockReset().mockResolvedValue(
    okResponse({
      link: {
        calendarItemId: ITEM_ID,
        taskId: TASK_ID,
        organizationId: ORG_ID,
        role: 'related',
        sort: 0,
        note: null,
        createdBy: '01BX5ZZKBKACTAV9WEVGEMMVA1',
        createdAt: '2026-07-01T00:00:00.000Z',
      },
      task: {
        id: TASK_ID,
        organizationId: ORG_ID,
        title: 'Prep notes',
        teamId: '01BX5ZZKBKACTAV9WEVGEMMVT1',
        state: 'backlog',
        priority: 'none',
        provenance: { source: 'native' },
        createdAt: '2026-07-01T00:00:00.000Z',
      },
    }),
  );
  itemTaskDelete.mockReset().mockResolvedValue(
    okResponse({
      calendarItemId: ITEM_ID,
      taskId: TASK_ID,
      organizationId: ORG_ID,
      role: 'related',
      sort: 0,
      note: null,
      createdBy: '01BX5ZZKBKACTAV9WEVGEMMVA1',
      createdAt: '2026-07-01T00:00:00.000Z',
    }),
  );
});

afterEach(() => {
  cleanup();
});

describe('calendarLayersDef', () => {
  it('resolves the parsed layers list', async () => {
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useApiListQuery(calendarLayersDef()), { wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toEqual({ items: [layer()] });
    expect(layersGet).toHaveBeenCalledWith();
  });
});

describe('calendarItemsDef', () => {
  it('resolves the parsed range payload and passes the range query', async () => {
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useApiListQuery(calendarItemsDef(START, END)), { wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toEqual({ layers: [layer()], items: [nativeItem()] });
    expect(itemsGet).toHaveBeenCalledWith({
      query: { start: START, end: END, layerIds: undefined, kinds: undefined },
    });
  });

  it('joins layer/kind filters into comma-separated query params', async () => {
    const { wrapper } = makeWrapper();
    renderHook(
      () =>
        useApiListQuery(
          calendarItemsDef(START, END, { layerIds: [LAYER_ID, 'l2'], kinds: ['native_block'] }),
        ),
      { wrapper },
    );

    await waitFor(() => {
      expect(itemsGet).toHaveBeenCalled();
    });
    expect(itemsGet).toHaveBeenCalledWith({
      query: { start: START, end: END, layerIds: `${LAYER_ID},l2`, kinds: 'native_block' },
    });
  });
});

describe('calendarItemDef', () => {
  it('resolves the parsed item detail', async () => {
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useApiQuery(calendarItemDef(ITEM_ID)), { wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toEqual(nativeItem());
    expect(itemGet).toHaveBeenCalledWith({ param: { id: ITEM_ID } });
  });
});

describe('useUpdateCalendarItem', () => {
  it('optimistically patches the item-detail cache and rolls back on error', async () => {
    const { client, wrapper } = makeWrapper();
    client.setQueryData(queryKeys.calendarItem(ITEM_ID), nativeItem());
    itemPatch.mockRejectedValueOnce(new Error('Could not update the calendar item.'));

    const { result } = renderHook(() => useUpdateCalendarItem(ITEM_ID), { wrapper });

    act(() => {
      result.current.mutate({ title: 'Renamed block' });
    });

    // The optimistic patch lands before the mocked mutate rejects.
    await waitFor(() => {
      expect(client.getQueryData<CalendarItemOut>(queryKeys.calendarItem(ITEM_ID))?.title).toBe(
        'Renamed block',
      );
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    // Rolled back to the pre-mutation snapshot.
    expect(client.getQueryData<CalendarItemOut>(queryKeys.calendarItem(ITEM_ID))).toEqual(
      nativeItem(),
    );
  });

  it('patches every seeded range cache entry containing the item and invalidates it on settle', async () => {
    const { client, wrapper } = makeWrapper();
    client.setQueryData(queryKeys.calendarItem(ITEM_ID), nativeItem());
    const rangeKey = queryKeys.calendarItems(START, END);
    client.setQueryData<CalendarItemsRangeOut>(rangeKey, {
      layers: [layer()],
      items: [nativeItem(), nativeItem({ id: OTHER_ITEM_ID, title: 'Unrelated' })],
    });
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useUpdateCalendarItem(ITEM_ID), { wrapper });

    act(() => {
      result.current.mutate({ title: 'Renamed block' });
    });

    await waitFor(() => {
      const range = client.getQueryData<CalendarItemsRangeOut>(rangeKey);
      expect(range?.items.find((item) => item.id === ITEM_ID)?.title).toBe('Renamed block');
    });
    // The unrelated item in the same range entry is untouched.
    expect(
      client
        .getQueryData<CalendarItemsRangeOut>(rangeKey)
        ?.items.find((i) => i.id === OTHER_ITEM_ID)?.title,
    ).toBe('Unrelated');

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.calendarItem(ITEM_ID) });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: rangeKey });
  });

  it('patches a provider_event item to a pending syncState without fabricating other fields', async () => {
    const { client, wrapper } = makeWrapper();
    client.setQueryData(queryKeys.calendarItem(ITEM_ID), providerItem());

    const { result } = renderHook(() => useUpdateCalendarItem(ITEM_ID), { wrapper });

    act(() => {
      result.current.mutate({ title: 'Reschedule sync' });
    });

    await waitFor(() => {
      const cached = client.getQueryData<CalendarItemOut>(queryKeys.calendarItem(ITEM_ID));
      expect(cached?.syncState).toBe('push_pending');
    });
    const cached = client.getQueryData<CalendarItemOut>(queryKeys.calendarItem(ITEM_ID));
    expect(cached?.title).toBe('Reschedule sync');
    // Every other server-only field is untouched from the pre-mutation snapshot.
    expect(cached?.htmlLink).toBe(providerItem().htmlLink);
    expect(cached?.externalEventId).toBe(providerItem().externalEventId);
  });
});

describe('useUpdateCalendarItemById', () => {
  it('rolls back provider sync state, detail, and every containing range after rejection', async () => {
    const { client, wrapper } = makeWrapper();
    const original = providerItem({ syncState: 'provider_error' });
    const firstRangeKey = queryKeys.calendarItems(START, END);
    const secondRangeKey = queryKeys.calendarItems(
      '2026-06-30T00:00:00.000Z',
      '2026-07-03T00:00:00.000Z',
    );
    const unrelatedRangeKey = queryKeys.calendarItems(
      '2026-08-01T00:00:00.000Z',
      '2026-08-02T00:00:00.000Z',
    );
    client.setQueryData(queryKeys.calendarItem(ITEM_ID), original);
    for (const key of [firstRangeKey, secondRangeKey]) {
      client.setQueryData<CalendarItemsRangeOut>(key, {
        layers: [layer()],
        items: [original, nativeItem({ id: OTHER_ITEM_ID, title: 'Unrelated' })],
      });
    }
    client.setQueryData<CalendarItemsRangeOut>(unrelatedRangeKey, {
      layers: [layer()],
      items: [nativeItem({ id: OTHER_ITEM_ID, title: 'Outside' })],
    });
    let rejectPatch: ((reason: Error) => void) | undefined;
    itemPatch.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectPatch = reject;
        }),
    );

    const { result } = renderHook(() => useUpdateCalendarItemById(), { wrapper });

    act(() => {
      result.current.mutate({
        itemId: ITEM_ID,
        patch: {
          startsAt: '2026-07-01T18:00:00Z',
          endsAt: '2026-07-01T19:00:00Z',
        },
      });
    });

    await waitFor(() => {
      expect(client.getQueryData<CalendarItemOut>(queryKeys.calendarItem(ITEM_ID))?.syncState).toBe(
        'push_pending',
      );
    });
    for (const key of [firstRangeKey, secondRangeKey]) {
      expect(
        client.getQueryData<CalendarItemsRangeOut>(key)?.items.find((item) => item.id === ITEM_ID),
      ).toMatchObject({ startsAt: '2026-07-01T18:00:00Z', syncState: 'push_pending' });
    }

    act(() => {
      rejectPatch?.(new Error('hostile provider rollback text'));
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(client.getQueryData(queryKeys.calendarItem(ITEM_ID))).toEqual(original);
    for (const key of [firstRangeKey, secondRangeKey]) {
      expect(
        client.getQueryData<CalendarItemsRangeOut>(key)?.items.find((item) => item.id === ITEM_ID),
      ).toEqual(original);
      expect(
        client
          .getQueryData<CalendarItemsRangeOut>(key)
          ?.items.find((item) => item.id === OTHER_ITEM_ID)?.title,
      ).toBe('Unrelated');
    }
    expect(client.getQueryData<CalendarItemsRangeOut>(unrelatedRangeKey)?.items).toEqual([
      nativeItem({ id: OTHER_ITEM_ID, title: 'Outside' }),
    ]);
  });

  it('serializes overlapping writes so an older rollback cannot clobber a newer optimistic edit', async () => {
    const { client, wrapper } = makeWrapper();
    const original = providerItem({ syncState: 'clean' });
    const rangeKey = queryKeys.calendarItems(START, END);
    client.setQueryData(queryKeys.calendarItem(ITEM_ID), original);
    client.setQueryData<CalendarItemsRangeOut>(rangeKey, {
      layers: [layer()],
      items: [original],
    });

    let rejectFirst: ((reason: Error) => void) | undefined;
    let resolveSecond:
      | ((response: ReturnType<typeof okResponse<CalendarItemOut>>) => void)
      | undefined;
    itemPatch
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectFirst = reject;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve;
          }),
      );

    const { result } = renderHook(
      () => ({
        calendarSurface: useUpdateCalendarItemById(),
        agendaSurface: useUpdateCalendarItemById(),
      }),
      { wrapper },
    );
    const firstPatch = {
      startsAt: '2026-07-01T18:00:00Z',
      endsAt: '2026-07-01T19:00:00Z',
    };
    const secondPatch = {
      startsAt: '2026-07-01T20:00:00Z',
      endsAt: '2026-07-01T21:00:00Z',
    };

    act(() => {
      result.current.calendarSurface.mutate({ itemId: ITEM_ID, patch: firstPatch });
    });
    await waitFor(() => {
      expect(itemPatch).toHaveBeenCalledTimes(1);
    });

    act(() => {
      result.current.agendaSurface.mutate({ itemId: ITEM_ID, patch: secondPatch });
    });
    expect(itemPatch).toHaveBeenCalledTimes(1);

    act(() => {
      rejectFirst?.(new Error('older write rejected'));
    });
    await waitFor(() => {
      expect(itemPatch).toHaveBeenCalledTimes(2);
    });
    expect(client.getQueryData<CalendarItemOut>(queryKeys.calendarItem(ITEM_ID))).toMatchObject({
      ...secondPatch,
      syncState: 'push_pending',
    });
    expect(
      client
        .getQueryData<CalendarItemsRangeOut>(rangeKey)
        ?.items.find((item) => item.id === ITEM_ID),
    ).toMatchObject({ ...secondPatch, syncState: 'push_pending' });

    act(() => {
      resolveSecond?.(okResponse(providerItem(secondPatch)));
    });
    await waitFor(() => {
      expect(result.current.agendaSurface.isSuccess).toBe(true);
    });
  });

  it('restores partial setup patches and releases a failed setup before the next dynamic write', async () => {
    const { client, wrapper } = makeWrapper();
    const original = providerItem({ syncState: 'clean' });
    const firstRangeKey = queryKeys.calendarItems(START, END);
    const secondRangeKey = queryKeys.calendarItems(
      '2026-06-30T00:00:00.000Z',
      '2026-07-03T00:00:00.000Z',
    );
    client.setQueryData(queryKeys.calendarItem(ITEM_ID), original);
    for (const key of [firstRangeKey, secondRangeKey]) {
      client.setQueryData<CalendarItemsRangeOut>(key, {
        layers: [layer()],
        items: [original],
      });
    }

    const originalSetQueryData = client.setQueryData.bind(client) as (
      key: QueryKey,
      updater: unknown,
    ) => unknown;
    let throwDuringSecondRange = true;
    vi.spyOn(client, 'setQueryData').mockImplementation((key: QueryKey, updater: unknown) => {
      if (
        throwDuringSecondRange &&
        JSON.stringify(key) === JSON.stringify(secondRangeKey) &&
        typeof updater === 'object' &&
        updater !== null
      ) {
        throwDuringSecondRange = false;
        throw new Error('synthetic optimistic setup failure');
      }
      return originalSetQueryData(key, updater);
    });

    const { result } = renderHook(() => useUpdateCalendarItemById(), { wrapper });
    const firstPatch = {
      startsAt: '2026-07-01T18:00:00Z',
      endsAt: '2026-07-01T19:00:00Z',
    };
    act(() => {
      result.current.mutate({ itemId: ITEM_ID, patch: firstPatch });
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(itemPatch).not.toHaveBeenCalled();
    expect(client.getQueryData(queryKeys.calendarItem(ITEM_ID))).toEqual(original);
    for (const key of [firstRangeKey, secondRangeKey]) {
      expect(client.getQueryData<CalendarItemsRangeOut>(key)?.items).toEqual([original]);
    }

    const laterPatch = {
      startsAt: '2026-07-01T20:00:00Z',
      endsAt: '2026-07-01T21:00:00Z',
    };
    act(() => {
      result.current.mutate({ itemId: ITEM_ID, patch: laterPatch });
    });
    await waitFor(() => {
      expect(itemPatch).toHaveBeenCalledOnce();
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(client.getQueryData<CalendarItemOut>(queryKeys.calendarItem(ITEM_ID))).toMatchObject({
      ...laterPatch,
      syncState: 'push_pending',
    });
    for (const key of [firstRangeKey, secondRangeKey]) {
      expect(
        client.getQueryData<CalendarItemsRangeOut>(key)?.items.find((item) => item.id === ITEM_ID),
      ).toMatchObject({ ...laterPatch, syncState: 'push_pending' });
    }
  });
});

describe('useDeleteCalendarItem', () => {
  it('optimistically removes the item from a seeded range cache and restores it on rollback', async () => {
    const { client, wrapper } = makeWrapper();
    const rangeKey = queryKeys.calendarItems(START, END);
    client.setQueryData<CalendarItemsRangeOut>(rangeKey, {
      layers: [layer()],
      items: [nativeItem(), nativeItem({ id: OTHER_ITEM_ID })],
    });
    itemDelete.mockRejectedValueOnce(new Error('Could not delete the calendar item.'));

    const { result } = renderHook(() => useDeleteCalendarItem(ITEM_ID), { wrapper });

    act(() => {
      result.current.mutate(undefined);
    });

    await waitFor(() => {
      const range = client.getQueryData<CalendarItemsRangeOut>(rangeKey);
      expect(range?.items.map((i) => i.id)).toEqual([OTHER_ITEM_ID]);
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    const restored = client.getQueryData<CalendarItemsRangeOut>(rangeKey);
    expect(restored?.items.map((i) => i.id).sort()).toEqual([ITEM_ID, OTHER_ITEM_ID].sort());
  });
});

describe('useUpdateLayerVisibility', () => {
  it('optimistically patches the layers cache and invalidates it plus the calendar-items prefix', async () => {
    const { client, wrapper } = makeWrapper();
    client.setQueryData<CalendarLayersOut>(queryKeys.calendarLayers(), { items: [layer()] });
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useUpdateLayerVisibility(LAYER_ID), { wrapper });

    act(() => {
      result.current.mutate({ selected: false });
    });

    await waitFor(() => {
      const layers = client.getQueryData<CalendarLayersOut>(queryKeys.calendarLayers());
      expect(layers?.items[0]?.selected).toBe(false);
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.calendarLayers() });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['me', 'calendar-items'] });
  });
});

describe('invalidate-only task-link and retry-write hooks', () => {
  it('useLinkTaskToItem does not mutate any cache before settle-time invalidation', async () => {
    const { client, wrapper } = makeWrapper();
    client.setQueryData(queryKeys.calendarItem(ITEM_ID), nativeItem());
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useLinkTaskToItem(ITEM_ID), { wrapper });

    act(() => {
      result.current.mutate({ organizationId: ORG_ID, taskId: TASK_ID });
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    // The cached detail is untouched by the mutation itself (only invalidation was fired).
    expect(client.getQueryData<CalendarItemOut>(queryKeys.calendarItem(ITEM_ID))).toEqual(
      nativeItem(),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.calendarItem(ITEM_ID) });
    expect(itemTasksPost).toHaveBeenCalledWith({
      param: { id: ITEM_ID },
      json: { mode: 'link', organizationId: ORG_ID, taskId: TASK_ID },
    });
  });

  it('useCreateAndLinkTask invalidate-only, no optimistic cache write', async () => {
    const { client, wrapper } = makeWrapper();
    client.setQueryData(queryKeys.calendarItem(ITEM_ID), nativeItem());
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useCreateAndLinkTask(ITEM_ID), { wrapper });

    act(() => {
      result.current.mutate({ organizationId: ORG_ID, title: 'Prep notes' });
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(client.getQueryData<CalendarItemOut>(queryKeys.calendarItem(ITEM_ID))).toEqual(
      nativeItem(),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.calendarItem(ITEM_ID) });
    expect(itemTasksPost).toHaveBeenCalledWith({
      param: { id: ITEM_ID },
      json: { mode: 'create', organizationId: ORG_ID, title: 'Prep notes' },
    });
  });

  it('useDetachTaskFromItem invalidate-only, no optimistic cache write', async () => {
    const { client, wrapper } = makeWrapper();
    client.setQueryData(queryKeys.calendarItem(ITEM_ID), nativeItem());
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useDetachTaskFromItem(ITEM_ID, TASK_ID), { wrapper });

    act(() => {
      result.current.mutate(undefined);
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(client.getQueryData<CalendarItemOut>(queryKeys.calendarItem(ITEM_ID))).toEqual(
      nativeItem(),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.calendarItem(ITEM_ID) });
    expect(itemTaskDelete).toHaveBeenCalledWith({ param: { id: ITEM_ID, taskId: TASK_ID } });
  });

  it('useRetryCalendarItemWrite invalidate-only, no optimistic cache write', async () => {
    const { client, wrapper } = makeWrapper();
    client.setQueryData(
      queryKeys.calendarItem(ITEM_ID),
      providerItem({ syncState: 'provider_error' }),
    );
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useRetryCalendarItemWrite(ITEM_ID), { wrapper });

    act(() => {
      result.current.mutate(undefined);
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    // Cache untouched by the mutation directly — still shows the pre-settle snapshot.
    expect(client.getQueryData<CalendarItemOut>(queryKeys.calendarItem(ITEM_ID))?.syncState).toBe(
      'provider_error',
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.calendarItem(ITEM_ID) });
    expect(itemRetryWrite).toHaveBeenCalledWith({ param: { id: ITEM_ID } });
  });
});
