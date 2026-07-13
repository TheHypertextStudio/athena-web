import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { JSX, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_A = '01BX5ZZKBKACTAV9WEVGEMMVA1';
const ORG_B = '01BX5ZZKBKACTAV9WEVGEMMVB1';
const ACTOR_A = '01BX5ZZKBKACTAV9WEVGEMMVA2';
const ACTOR_B = '01BX5ZZKBKACTAV9WEVGEMMVB2';
const ITEM_A = '01BX5ZZKBKACTAV9WEVGEMMVA3';
const LAYER_A = '01BX5ZZKBKACTAV9WEVGEMMVA4';

const { membersGet, schedulesGet } = vi.hoisted(() => ({
  membersGet: vi.fn(),
  schedulesGet: vi.fn(),
}));

vi.mock('../../src/components/active-org', () => ({
  useActiveOrg: () => ({
    orgs: [
      { id: ORG_A, name: 'Alpha', slug: 'alpha', avatar: null, isPersonal: false },
      { id: ORG_B, name: 'Beta', slug: 'beta', avatar: null, isPersonal: false },
    ],
  }),
}));

vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        ':orgId': {
          members: { $get: membersGet },
          calendar: { schedules: { $get: schedulesGet } },
        },
      },
    },
  },
}));

import { useCalendarPeopleAxis } from '../../src/app/(app)/calendar/use-calendar-people-axis';

/** A typed-enough mock Hono response for the shared query unwrap layer. */
function okResponse(body: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

/** One active member response consumed by the comparison picker. */
function member(actorId: string, displayName: string) {
  return { actorId, displayName, status: 'active' };
}

/** One permission-filtered comparison response. */
function comparison(actorId: string, displayName: string, withDetails = false) {
  return {
    start: '2026-07-13T00:00:00Z',
    end: '2026-07-14T00:00:00Z',
    people: [
      {
        actorId,
        displayName,
        avatar: null,
        timezone: 'UTC',
        items: withDetails
          ? [
              {
                access: 'details',
                itemId: ITEM_A,
                layerId: LAYER_A,
                kind: 'native_event',
                title: 'Alpha planning',
                startsAt: '2026-07-13T09:00:00Z',
                endsAt: '2026-07-13T10:00:00Z',
                allDayStartDate: null,
                allDayEndDate: null,
              },
            ]
          : [],
      },
    ],
  };
}

/** Fresh QueryClient wrapper for one hook contract. */
function makeWrapper(): (props: { children: ReactNode }) => JSX.Element {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  membersGet.mockReset();
  schedulesGet.mockReset();
});

afterEach(cleanup);

describe('useCalendarPeopleAxis workspace boundaries', () => {
  it('clears Alpha placeholders before selecting and rendering deferred Beta data', async () => {
    let resolveBetaMembers: ((response: ReturnType<typeof okResponse>) => void) | undefined;
    membersGet.mockImplementation(({ param }: { param: { orgId: string } }) =>
      param.orgId === ORG_A
        ? Promise.resolve(okResponse({ items: [member(ACTOR_A, 'Ada')] }))
        : new Promise((resolve) => {
            resolveBetaMembers = resolve;
          }),
    );
    schedulesGet.mockImplementation(
      ({ param, query }: { param: { orgId: string }; query: { actorIds: string[] } }) =>
        Promise.resolve(
          okResponse(
            param.orgId === ORG_A
              ? comparison(ACTOR_A, 'Ada', true)
              : comparison(query.actorIds[0] ?? ACTOR_B, 'Grace'),
          ),
        ),
    );

    const { result } = renderHook(() => useCalendarPeopleAxis('people', '2026-07-13', 'UTC'), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.lanes[0]?.label).toBe('Ada');
    });
    expect(result.current.detailByItemId.has(ITEM_A)).toBe(true);

    act(() => {
      result.current.selectWorkspace(ORG_B);
    });

    await waitFor(() => {
      expect(result.current.comparisonOrgId).toBe(ORG_B);
    });
    expect(result.current.activeMembers).toEqual([]);
    expect(result.current.selectedActorIds).toEqual([]);
    expect(result.current.lanes).toEqual([]);
    expect(result.current.detailByItemId.size).toBe(0);
    expect(schedulesGet).not.toHaveBeenCalledWith(
      expect.objectContaining({
        param: { orgId: ORG_B },
        query: expect.objectContaining({ actorIds: [ACTOR_A] }),
      }),
    );

    act(() => {
      resolveBetaMembers?.(okResponse({ items: [member(ACTOR_B, 'Grace')] }));
    });

    await waitFor(() => {
      expect(result.current.selectedActorIds).toEqual([ACTOR_B]);
      expect(result.current.lanes[0]?.label).toBe('Grace');
    });
    expect(schedulesGet).toHaveBeenCalledWith(
      expect.objectContaining({
        param: { orgId: ORG_B },
        query: expect.objectContaining({ actorIds: [ACTOR_B] }),
      }),
    );
  });
});
