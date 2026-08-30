import {
  DailyPlanItemId,
  type HubTodayOut,
  type HubTodayPlanItem,
  type HubTodaySuggestion,
  OrganizationId,
  TaskId,
} from '@docket/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { queryKeys } from '../../src/lib/query';
import { useTodayActions } from '../../src/app/(app)/today/use-today-actions';
import { assertDefined } from '@docket/test-utils';

const completePost = vi.hoisted(() => vi.fn());
const deletePlan = vi.hoisted(() => vi.fn());
const addPlan = vi.hoisted(() => vi.fn());
const patchPlan = vi.hoisted(() => vi.fn());
const startTimer = vi.hoisted(() => vi.fn());

vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      hub: { today: { items: { ':planItemId': { complete: { $post: completePost } } } } },
      'daily-plan': { ':id': { $delete: deletePlan, $patch: patchPlan }, $post: addPlan },
    },
  },
}));

vi.mock('../../src/components/time-tracking/use-timer', () => ({
  useTimerControls: () => ({ start: startTimer }),
}));

const DATE = '2026-08-13';
const ORG = OrganizationId.parse('01JQ000000000000000000000A');
const TASK_IDS: Readonly<Record<string, string>> = {
  now: '01JQ000000000000000000000B',
  after: '01JQ000000000000000000000C',
  suggested: '01JQ000000000000000000000D',
};
const PLAN_IDS: Readonly<Record<string, string>> = {
  now: '01JQ000000000000000000000E',
  after: '01JQ000000000000000000000F',
  suggested: '01JQ000000000000000000000G',
};

function response(body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function item(id: string, position: number): HubTodayPlanItem {
  return {
    id: TaskId.parse(TASK_IDS[id]),
    organizationId: ORG,
    title: `Task ${id}`,
    summary: null,
    state: 'todo',
    stateType: 'unstarted',
    priority: 'medium',
    assigneeId: null,
    projectId: null,
    dueDate: null,
    planItemId: DailyPlanItemId.parse(PLAN_IDS[id]),
    planStatus: 'planned',
    sort: position * 10,
    position,
    estimateMinutes: 30,
    timeboxStartsAt: null,
    timeboxEndsAt: null,
    blocked: false,
    dependencyImpact: 0,
    reason: null,
  };
}

function today(now: HubTodayPlanItem, after: HubTodayPlanItem): HubTodayOut {
  return {
    date: DATE,
    planState: 'active',
    brief: { text: 'Your next two moves are ready.', href: null, attentionCount: 0 },
    plan: [now, after],
    focus: { now, after },
    statusCards: [],
    suggestions: [],
    calendar: [
      {
        taskId: now.id,
        organizationId: now.organizationId,
        startsAt: '2026-08-13T09:00:00.000Z',
        endsAt: '2026-08-13T09:30:00.000Z',
      },
    ],
    needsAttention: { approvals: [], blocked: [], dueToday: [], inbox: 0 },
  };
}

function setup(initial: HubTodayOut): {
  client: QueryClient;
  wrapper: (props: PropsWithChildren) => React.JSX.Element;
} {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(queryKeys.today(DATE), initial);
  return {
    client,
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  };
}

beforeEach(() => {
  completePost.mockReset().mockResolvedValue(response());
  deletePlan.mockReset().mockResolvedValue(response());
  addPlan.mockReset().mockResolvedValue(response());
  patchPlan.mockReset().mockResolvedValue(response());
  startTimer.mockReset().mockResolvedValue(undefined);
});

describe('useTodayActions', () => {
  it('optimistically advances focus and removes the completed calendar block', async () => {
    const now = item('now', 0);
    const after = item('after', 1);
    const { client, wrapper } = setup(today(now, after));
    const { result } = renderHook(() => useTodayActions(DATE), { wrapper });

    act(() => {
      result.current.complete(now);
    });

    await waitFor(() => {
      expect(completePost).toHaveBeenCalledWith({ param: { planItemId: now.planItemId } });
    });
    const optimistic = client.getQueryData<HubTodayOut>(queryKeys.today(DATE));
    expect(optimistic?.plan.map((entry) => entry.id)).toEqual([after.id]);
    expect(optimistic?.focus.now?.id).toBe(after.id);
    expect(optimistic?.focus.after).toBeNull();
    expect(optimistic?.calendar).toEqual([]);
  });

  it('keeps a plan active when completion leaves only blocked planned work', async () => {
    const now = item('now', 0);
    const blocked = { ...item('after', 1), blocked: true };
    const initial = today(now, blocked);
    initial.focus = { now, after: null };
    const { client, wrapper } = setup(initial);
    const { result } = renderHook(() => useTodayActions(DATE), { wrapper });

    act(() => {
      result.current.complete(now);
    });

    await waitFor(() => {
      expect(completePost).toHaveBeenCalled();
    });
    const optimistic = client.getQueryData<HubTodayOut>(queryKeys.today(DATE));
    expect(optimistic?.planState).toBe('active');
    expect(optimistic?.focus).toEqual({ now: null, after: null });
  });

  it('removes only the mutated plan row when the same task appears twice', async () => {
    const now = item('now', 0);
    const duplicate = {
      ...now,
      planItemId: item('after', 1).planItemId,
      position: 1,
      sort: 10,
      reason: null,
    };
    const initial = today(now, duplicate);
    initial.plan = [now, duplicate];
    initial.focus = { now, after: duplicate };
    const { client, wrapper } = setup(initial);
    const { result } = renderHook(() => useTodayActions(DATE), { wrapper });

    act(() => {
      result.current.defer(now);
    });

    await waitFor(() => {
      expect(deletePlan).toHaveBeenCalled();
    });
    const optimistic = client.getQueryData<HubTodayOut>(queryKeys.today(DATE));
    expect(optimistic?.plan).toEqual([duplicate]);
    expect(optimistic?.focus.now?.planItemId).toBe(duplicate.planItemId);
  });

  it('promotes only the selected plan row when duplicate rows reference one task', async () => {
    const now = item('now', 0);
    const duplicate = {
      ...now,
      planItemId: item('after', 1).planItemId,
      position: 1,
      sort: 10,
      reason: null,
    };
    const initial = today(now, duplicate);
    initial.plan = [now, duplicate];
    initial.focus = { now, after: duplicate };
    const { client, wrapper } = setup(initial);
    const { result } = renderHook(() => useTodayActions(DATE), { wrapper });

    act(() => {
      result.current.promote(duplicate, now.sort);
    });

    await waitFor(() => {
      expect(patchPlan).toHaveBeenCalled();
    });
    const optimistic = client.getQueryData<HubTodayOut>(queryKeys.today(DATE));
    expect(optimistic?.focus.now?.planItemId).toBe(duplicate.planItemId);
    expect(optimistic?.plan[1]?.planItemId).toBe(now.planItemId);
  });

  it('adds a momentum suggestion before starting the shared timer', async () => {
    const now = item('now', 0);
    const after = item('after', 1);
    const { wrapper } = setup(today(now, after));
    const suggestion = {
      ...item('suggested', 2),
      estimateMinutes: 20,
      dependencyImpact: 0,
      reason: 'Fits the time left today',
    } as HubTodaySuggestion;
    const { result } = renderHook(() => useTodayActions(DATE), { wrapper });

    act(() => {
      result.current.start(suggestion);
    });

    await waitFor(() => {
      expect(startTimer).toHaveBeenCalledWith({
        taskId: suggestion.id,
        organizationId: suggestion.organizationId,
        label: suggestion.title,
      });
    });
    expect(addPlan.mock.invocationCallOrder[0]).toBeLessThan(
      assertDefined(startTimer.mock.invocationCallOrder[0]),
    );
    expect(addPlan).toHaveBeenCalledWith({
      json: {
        refOrganizationId: suggestion.organizationId,
        refTaskId: suggestion.id,
        date: DATE,
        sort: -1,
      },
    });
  });

  it('promotes After this ahead of Now with one plan write and optimistic feedback', async () => {
    const now = item('now', 4);
    const after = item('after', 5);
    const { client, wrapper } = setup(today(now, after));
    const { result } = renderHook(() => useTodayActions(DATE), { wrapper });

    act(() => {
      result.current.promote(after, now.sort);
    });

    await waitFor(() => {
      expect(patchPlan).toHaveBeenCalledWith({
        param: { id: after.planItemId },
        json: { sort: 39 },
      });
    });
    expect(client.getQueryData<HubTodayOut>(queryKeys.today(DATE))?.focus.now?.id).toBe(after.id);
  });

  it('writes a timebox through the shared Agenda mutation path', async () => {
    const now = item('now', 0);
    const after = item('after', 1);
    const { client, wrapper } = setup(today(now, after));
    const { result } = renderHook(() => useTodayActions(DATE), { wrapper });
    const startsAt = '2026-08-13T16:00:00.000Z';
    const endsAt = '2026-08-13T16:30:00.000Z';

    await act(async () => {
      await result.current.timebox(now, startsAt, endsAt);
    });

    expect(patchPlan).toHaveBeenCalledWith({
      param: { id: now.planItemId },
      json: { timeboxStartsAt: startsAt, timeboxEndsAt: endsAt },
    });
    expect(
      client.getQueryData<HubTodayOut>(queryKeys.today(DATE))?.focus.now?.timeboxStartsAt,
    ).toBe(startsAt);
  });

  it('surfaces an application-owned error when the shared timer cannot start', async () => {
    startTimer.mockRejectedValueOnce(new Error('provider internals'));
    const now = item('now', 0);
    const after = item('after', 1);
    const { wrapper } = setup(today(now, after));
    const suggestion = {
      ...item('suggested', 2),
      estimateMinutes: 20,
      dependencyImpact: 0,
      reason: 'Fits the time left today',
    } as HubTodaySuggestion;
    const { result } = renderHook(() => useTodayActions(DATE), { wrapper });

    act(() => {
      result.current.start(suggestion);
    });

    await waitFor(() => {
      expect(result.current.error).toBe('Added to Today, but tracking did not start.');
    });
  });
});
