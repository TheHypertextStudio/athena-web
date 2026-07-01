/**
 * Behavior tests for the agenda daily-plan mutation layer.
 *
 * @remarks
 * The agenda provider reads `queryKeys.agenda(date)` for rendered timeboxes and separately reads
 * `queryKeys.dailyPlan(date)` for plan item ids/status. These tests pin the write-layer contract:
 * edits must optimistically update the rendered agenda cache, not only the daily-plan metadata
 * cache, and a move must invalidate both the current day and target day so navigation reconciles.
 */
import {
  DailyPlanItemId,
  type AgendaOut,
  type DailyPlanItemOut,
  OrganizationId,
  TaskId,
} from '@docket/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { JSX, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { dailyPlanPatch, dailyPlanPost, dailyPlanDelete } = vi.hoisted(() => ({
  dailyPlanPatch: vi.fn(),
  dailyPlanPost: vi.fn(),
  dailyPlanDelete: vi.fn(),
}));

vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      'daily-plan': {
        $post: dailyPlanPost,
        ':id': {
          $patch: dailyPlanPatch,
          $delete: dailyPlanDelete,
        },
      },
    },
  },
}));

import type { AgendaEntry } from '../../src/components/agenda/agenda-context';
import { useAgendaPlanMutations } from '../../src/components/agenda/agenda-mutations';
import { queryKeys } from '../../src/lib/query';

const DAY = '2026-07-01';
const TARGET_DAY = '2026-07-02';
const ORG_ID = OrganizationId.parse('01BX5ZZKBKACTAV9WEVGEMMVRZ');
const TASK_ID = TaskId.parse('01ARZ3NDEKTSV4RRFFQ69G5FA0');
const PLAN_ITEM_ID = DailyPlanItemId.parse('01BX5ZZKBKACTAV9WEVGEMMVS1');
const OLD_START = '2026-07-01T16:00:00.000Z';
const OLD_END = '2026-07-01T17:00:00.000Z';
const NEW_START = '2026-07-01T18:00:00.000Z';
const NEW_END = '2026-07-01T19:00:00.000Z';

/** A typed mock Hono response for the mutation unwrap layer. */
function okResponse<T>(body: T) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

/** A planned task rendered on the agenda. */
function agendaEntry(): AgendaEntry {
  return {
    id: TASK_ID,
    source: 'task',
    taskId: TASK_ID,
    organizationId: ORG_ID,
    title: 'Draft launch memo',
    startsAt: OLD_START,
    endsAt: OLD_END,
    sort: 0,
    done: false,
    planItemId: PLAN_ITEM_ID,
  };
}

/** The daily-plan metadata cache the mutation layer updates alongside the rendered agenda. */
function dailyPlanItem(): DailyPlanItemOut {
  return {
    id: PLAN_ITEM_ID,
    refOrganizationId: ORG_ID,
    refTaskId: TASK_ID,
    date: DAY,
    sort: 0,
    status: 'planned',
    timeboxStartsAt: OLD_START,
    timeboxEndsAt: OLD_END,
    createdAt: '2026-07-01T00:00:00.000Z',
  };
}

/** The rendered agenda cache entry that should update immediately after a timebox edit. */
function agendaOut(): AgendaOut {
  return {
    date: DAY,
    entries: [
      {
        kind: 'task_timebox',
        taskId: TASK_ID,
        organizationId: ORG_ID,
        title: 'Draft launch memo',
        state: 'started',
        priority: 'medium',
        startsAt: OLD_START,
        endsAt: OLD_END,
      },
    ],
  };
}

/** A fresh QueryClient wrapper for hook tests. */
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
  dailyPlanPatch.mockReset().mockResolvedValue(okResponse({}));
  dailyPlanPost.mockReset().mockResolvedValue(okResponse({}));
  dailyPlanDelete.mockReset().mockResolvedValue(okResponse({}));
});

afterEach(() => {
  cleanup();
});

describe('useAgendaPlanMutations', () => {
  it('optimistically patches the rendered agenda cache when setting a timebox', async () => {
    const { client, wrapper } = makeWrapper();
    client.setQueryData(queryKeys.dailyPlan(DAY), { items: [dailyPlanItem()] });
    client.setQueryData(queryKeys.agenda(DAY), agendaOut());

    const { result } = renderHook(() => useAgendaPlanMutations(DAY), { wrapper });

    act(() => {
      result.current.setTimebox(agendaEntry(), NEW_START, NEW_END);
    });

    await waitFor(() => {
      expect(dailyPlanPatch).toHaveBeenCalled();
    });
    expect(dailyPlanPatch).toHaveBeenCalledWith({
      param: { id: PLAN_ITEM_ID },
      json: { timeboxStartsAt: NEW_START, timeboxEndsAt: NEW_END },
    });
    expect(client.getQueryData<AgendaOut>(queryKeys.agenda(DAY))?.entries).toEqual([
      expect.objectContaining({
        kind: 'task_timebox',
        taskId: TASK_ID,
        startsAt: NEW_START,
        endsAt: NEW_END,
      }),
    ]);
  });

  it('invalidates the target agenda day after moving a task', async () => {
    const { client, wrapper } = makeWrapper();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    client.setQueryData(queryKeys.dailyPlan(DAY), { items: [dailyPlanItem()] });
    client.setQueryData(queryKeys.agenda(DAY), agendaOut());

    const { result } = renderHook(() => useAgendaPlanMutations(DAY), { wrapper });

    act(() => {
      result.current.moveToDay(agendaEntry(), TARGET_DAY);
    });

    await waitFor(() => {
      expect(dailyPlanDelete).toHaveBeenCalled();
    });
    expect(dailyPlanPost).toHaveBeenCalledWith({
      json: {
        refOrganizationId: ORG_ID,
        refTaskId: TASK_ID,
        date: TARGET_DAY,
      },
    });
    expect(client.getQueryData<AgendaOut>(queryKeys.agenda(DAY))?.entries).toEqual([]);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.agenda(TARGET_DAY) });
  });
});
