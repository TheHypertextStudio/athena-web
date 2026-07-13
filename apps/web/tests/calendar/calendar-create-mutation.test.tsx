import {
  CalendarItemId,
  type CalendarItemCreate,
  type CalendarItemOut,
  type CalendarItemsRangeOut,
  CalendarLayerId,
} from '@docket/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { JSX, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { itemsPost } = vi.hoisted(() => ({ itemsPost: vi.fn() }));

vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      me: {
        calendar: {
          items: { $post: itemsPost },
        },
      },
    },
  },
}));

import { useCreateCalendarItem } from '../../src/components/calendar/calendar-mutations';
import { queryKeys } from '../../src/lib/query';

const ITEM_ID = CalendarItemId.parse('01BX5ZZKBKACTAV9WEVGEMMVS1');
const LAYER_ID = CalendarLayerId.parse('01BX5ZZKBKACTAV9WEVGEMMVN1');
const input = {
  intent: 'timebox',
  title: 'Deep work window',
  startsAt: '2026-07-13T17:00:00.000Z',
  endsAt: '2026-07-13T18:00:00.000Z',
} satisfies CalendarItemCreate;

/** Return the complete server item created from the mutation fixture. */
function createdItem(): CalendarItemOut {
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
    title: input.title,
    description: null,
    location: null,
    htmlLink: null,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
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
    createdAt: '2026-07-13T16:00:00.000Z',
    updatedAt: '2026-07-13T16:00:00.000Z',
  };
}

/** Create an isolated query cache for the hook under test. */
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
  itemsPost.mockReset().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(createdItem()),
  });
});

afterEach(() => {
  cleanup();
});

describe('useCreateCalendarItem', () => {
  it('invalidates every cached calendar range after a create settles', async () => {
    const { client, wrapper } = makeWrapper();
    const expandedRangeKey = queryKeys.calendarItems(
      '2026-07-09T00:00:00.000Z',
      '2026-07-18T00:00:00.000Z',
    );
    const compactRangeKey = queryKeys.calendarItems(
      '2026-07-12T00:00:00.000Z',
      '2026-07-15T00:00:00.000Z',
    );
    const emptyRange: CalendarItemsRangeOut = { layers: [], items: [] };
    client.setQueryData(expandedRangeKey, emptyRange);
    client.setQueryData(compactRangeKey, emptyRange);

    const { result } = renderHook(() => useCreateCalendarItem(), { wrapper });

    act(() => {
      result.current.mutate(input);
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(client.getQueryState(expandedRangeKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(compactRangeKey)?.isInvalidated).toBe(true);
  });
});
