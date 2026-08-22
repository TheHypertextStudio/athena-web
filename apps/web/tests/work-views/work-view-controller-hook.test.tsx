import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ActorId,
  InitiativeViewDefinition,
  PersonalWorkViewState,
  TeamId,
  TaskViewDefinition,
  TaskViewRow,
  ViewInstanceKey,
  WorkViewFacetResponse,
  WorkViewQueryResponse,
} from '@docket/types';

import {
  type UseWorkViewOptions,
  useWorkView,
} from '../../src/components/work-views/use-work-view';
import { queryKeys } from '../../src/lib/query';
import { makeQueryWrapper, okResponse } from '../support/query';

const apiMocks = vi.hoisted(() => ({
  getPreferences: vi.fn(),
  patchPreferences: vi.fn(),
  getDefault: vi.fn(),
  patchDefault: vi.fn(),
  query: vi.fn(),
  facets: vi.fn(),
  saveView: vi.fn(),
}));

vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      hub: {
        preferences: {
          $get: apiMocks.getPreferences,
          $patch: apiMocks.patchPreferences,
        },
      },
      orgs: {
        ':orgId': {
          'work-views': {
            defaults: {
              ':target': {
                $get: apiMocks.getDefault,
                $patch: apiMocks.patchDefault,
              },
            },
            query: { $post: apiMocks.query },
            facets: { $post: apiMocks.facets },
          },
          'saved-views': { $post: apiMocks.saveView },
        },
      },
    },
  },
}));

const actorId = ActorId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV');
const taskInstanceOne = ViewInstanceKey.parse('builtin:task:01ARZ3NDEKTSV4RRFFQ69G5FAA');
const taskInstanceTwo = ViewInstanceKey.parse('builtin:task:01ARZ3NDEKTSV4RRFFQ69G5FAB');
const initiativeInstance = ViewInstanceKey.parse('builtin:initiative:01ARZ3NDEKTSV4RRFFQ69G5FAC');

const taskDefinition = TaskViewDefinition.parse({
  version: 2,
  target: 'task',
  filter: {
    kind: 'predicate',
    field: 'dueDate',
    operator: 'before',
    operand: { kind: 'preset', value: 'next-week' },
  },
  arrangement: { groupBy: 'status', subGroupBy: null, orderBy: [] },
  presentation: {
    layout: 'list',
    properties: ['status', 'assignee'],
    density: 'compact',
    showEmptyGroups: false,
  },
});

const initiativeDefinition = InitiativeViewDefinition.parse({
  version: 2,
  target: 'initiative',
  filter: null,
  arrangement: { groupBy: 'status', subGroupBy: null, orderBy: [] },
  presentation: {
    layout: 'list',
    properties: ['status', 'health'],
    density: 'compact',
    showEmptyGroups: false,
  },
});

const flatTaskDefinition = TaskViewDefinition.parse({
  ...taskDefinition,
  filter: null,
  arrangement: { groupBy: null, subGroupBy: null, orderBy: [] },
});

function taskRow(index: number) {
  return TaskViewRow.parse({
    target: 'task',
    organizationId: '01ARZ3NDEKTSV4RRFFQ69G5FAD',
    id: `01ARZ3NDEKTSV4RRFFQ69${String(index).padStart(5, '0')}`,
    title: `Task ${String(index)}`,
    status: 'todo',
    priority: 'medium',
    assignee: null,
    delegate: null,
    team: '01ARZ3NDEKTSV4RRFFQ69G5FB0',
    project: null,
    program: null,
    cycle: null,
    milestone: null,
    parent: null,
    labels: [],
    creator: null,
    startDate: null,
    dueDate: null,
    createdAt: '2026-08-21T12:00:00.000Z',
    updatedAt: '2026-08-21T12:00:00.000Z',
    estimate: null,
    estimateMinutes: null,
    blocked: false,
    blocking: false,
    unfiled: true,
    archived: false,
    manualRank: `a${String(index)}`,
    isContext: false,
  });
}

function defaultResponse(target: 'task' | 'initiative') {
  return {
    target,
    definition: target === 'task' ? taskDefinition : initiativeDefinition,
    updatedBy: actorId,
    updatedAt: '2026-08-21T12:00:00.000Z',
  };
}

function queryResponse(target: 'task' | 'initiative', totalCount: number): WorkViewQueryResponse {
  return WorkViewQueryResponse.parse({
    target,
    rows: [],
    groups: [],
    totalCount,
    nextCursor: null,
    queryFingerprint: `sha256:${String(totalCount).padStart(16, '0')}`,
  });
}

function taskOptions(instanceKey = taskInstanceOne): UseWorkViewOptions<'task'> {
  return {
    organizationId: '01ARZ3NDEKTSV4RRFFQ69G5FAD',
    target: 'task',
    instanceKey,
    fallback: taskDefinition,
    context: { kind: 'organization' },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMocks.getPreferences.mockResolvedValue(
    okResponse({ timezone: 'America/Los_Angeles', viewState: [] }),
  );
  apiMocks.getDefault.mockImplementation(
    ({ param }: { param: { target: 'task' | 'initiative' } }) =>
      Promise.resolve(okResponse(defaultResponse(param.target))),
  );
  apiMocks.query.mockImplementation(({ json }: { json: { target: 'task' | 'initiative' } }) =>
    Promise.resolve(okResponse(queryResponse(json.target, 0))),
  );
  apiMocks.facets.mockResolvedValue(okResponse({ target: 'task', buckets: [], distinctCount: 0 }));
  apiMocks.patchPreferences.mockImplementation(({ json }: { json: { viewState: unknown[] } }) =>
    Promise.resolve(okResponse({ timezone: 'America/Los_Angeles', viewState: json.viewState })),
  );
});

describe('useWorkView instance and request identity', () => {
  it('does not expose a same-target response from the previous instance', async () => {
    const pending: ((value: ReturnType<typeof okResponse>) => void)[] = [];
    apiMocks.query.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
    const { wrapper } = makeQueryWrapper();
    const { result, rerender } = renderHook(({ options }) => useWorkView(options), {
      wrapper,
      initialProps: { options: taskOptions() },
    });

    await waitFor(() => {
      expect(pending).toHaveLength(1);
    });
    rerender({ options: taskOptions(taskInstanceTwo) });
    await waitFor(() => {
      expect(pending).toHaveLength(2);
    });
    await act(async () => {
      pending[0]?.(okResponse(queryResponse('task', 1)));
    });
    expect(result.current.response).toBeUndefined();
    await act(async () => {
      pending[1]?.(okResponse(queryResponse('task', 2)));
    });
    await waitFor(() => {
      expect(result.current.response?.totalCount).toBe(2);
    });
  });

  it('switches from Task to Initiative without retaining the old definition or response', async () => {
    type SwitchingOptions = UseWorkViewOptions<'task'> | UseWorkViewOptions<'initiative'>;
    const { wrapper } = makeQueryWrapper();
    const task = taskOptions();
    const initiative: SwitchingOptions = {
      organizationId: task.organizationId,
      target: 'initiative',
      instanceKey: initiativeInstance,
      fallback: initiativeDefinition,
      context: { kind: 'organization' },
    };
    const initialProps: { options: SwitchingOptions } = { options: task };
    const { result, rerender } = renderHook(
      ({ options }: { options: SwitchingOptions }) =>
        useWorkView(options as UseWorkViewOptions<'task'>),
      { wrapper, initialProps },
    );
    await waitFor(() => {
      expect(result.current.response?.target).toBe('task');
    });
    rerender({ options: initiative });
    expect(result.current.definition.target).toBe('initiative');
    expect(result.current.response).toBeUndefined();
    await waitFor(() => {
      expect(result.current.response?.target).toBe('initiative');
    });
  });

  it('refetches a symbolic-date query when the viewer timezone changes', async () => {
    const { client, wrapper } = makeQueryWrapper();
    const { result } = renderHook(() => useWorkView(taskOptions()), { wrapper });
    await waitFor(() => {
      expect(result.current.response).toBeDefined();
    });
    expect(apiMocks.query).toHaveBeenCalledTimes(1);

    act(() => {
      client.setQueryData(queryKeys.hubPreferences(), {
        timezone: 'America/Chicago',
        viewState: [],
      });
    });
    await waitFor(() => {
      expect(apiMocks.query).toHaveBeenCalledTimes(2);
    });
    expect(result.current.timezone).toBe('America/Chicago');
    expect(
      client
        .getQueryCache()
        .getAll()
        .some((query) => query.queryKey.includes('America/Chicago')),
    ).toBe(true);
  });
});

describe('useWorkView row pagination', () => {
  it('appends a validated root cursor page without replacing the first page', async () => {
    apiMocks.getDefault.mockResolvedValue(
      okResponse({ ...defaultResponse('task'), definition: flatTaskDefinition }),
    );
    apiMocks.query.mockImplementation(({ json }: { json: { target: 'task'; cursor?: string } }) =>
      Promise.resolve(
        okResponse(
          WorkViewQueryResponse.parse({
            target: 'task',
            rows: [taskRow(json.cursor ? 2 : 1)],
            groups: [],
            totalCount: 2,
            nextCursor: json.cursor ? null : 'page-2',
            queryFingerprint: 'sha256:0000000000000002',
          }),
        ),
      ),
    );
    const { wrapper } = makeQueryWrapper();
    const { result } = renderHook(() => useWorkView(taskOptions()), { wrapper });
    await waitFor(() => {
      expect(result.current.response?.rows).toHaveLength(1);
    });

    act(() => {
      result.current.loadMoreRows();
    });

    await waitFor(() => {
      expect(result.current.response?.rows.map((row) => row.title)).toEqual(['Task 1', 'Task 2']);
    });
    expect(result.current.response?.nextCursor).toBeNull();
  });
});

describe('useWorkView facet pagination', () => {
  it('hydrates actor and non-actor relation labels for active filters after reload', async () => {
    const teamId = TeamId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAE');
    const relationDefinition = TaskViewDefinition.parse({
      ...taskDefinition,
      filter: {
        kind: 'all',
        children: [
          {
            kind: 'predicate',
            field: 'assignee',
            operator: 'is',
            operand: { kind: 'actor', actorId },
          },
          { kind: 'predicate', field: 'team', operator: 'is', operand: teamId },
        ],
      },
    });
    apiMocks.getDefault.mockResolvedValue(
      okResponse({
        ...defaultResponse('task'),
        definition: relationDefinition,
      }),
    );
    apiMocks.facets.mockImplementation(({ json }: { json: { fields: string[] } }) => {
      const field = json.fields[0];
      return Promise.resolve(
        okResponse(
          WorkViewFacetResponse.parse({
            target: 'task',
            buckets: [
              field === 'assignee'
                ? {
                    field,
                    options: [
                      {
                        value: { kind: 'actor', actorId },
                        label: 'Alex Chen',
                        count: 1,
                      },
                    ],
                    emptyCount: 0,
                    nextCursor: null,
                  }
                : {
                    field: 'team',
                    options: [{ value: teamId, label: 'Platform', count: 1 }],
                    emptyCount: 0,
                    nextCursor: null,
                  },
            ],
            distinctCount: 1,
          }),
        ),
      );
    });
    const { wrapper } = makeQueryWrapper();
    const { result } = renderHook(() => useWorkView(taskOptions()), { wrapper });

    await waitFor(() => {
      expect(result.current.facetMetadataResponse?.buckets).toHaveLength(2);
    });
    const labels = result.current.facetMetadataResponse?.buckets.flatMap((bucket) =>
      bucket.options.map((option) => option.label),
    );
    expect(labels).toEqual(expect.arrayContaining(['Alex Chen', 'Platform']));
  });

  it('loads option 51 and resets pages when search changes', async () => {
    apiMocks.facets.mockImplementation(
      ({ json }: { json: { cursor?: string; search?: string } }) => {
        const response = WorkViewFacetResponse.parse({
          target: 'task',
          buckets: [
            {
              field: 'assignee',
              options: json.cursor
                ? [
                    {
                      value: { kind: 'actor', actorId },
                      label: 'Actor 51',
                      count: 0,
                    },
                  ]
                : Array.from({ length: json.search ? 1 : 50 }, (_, index) => ({
                    value: { kind: 'actor' as const, actorId },
                    label: json.search ? 'Search result' : `Actor ${String(index + 1)}`,
                    count: index,
                  })),
              emptyCount: 0,
              nextCursor: json.search || json.cursor ? null : 'page-2',
            },
          ],
          distinctCount: 51,
        });
        return Promise.resolve(okResponse(response));
      },
    );
    const { wrapper } = makeQueryWrapper();
    const { result } = renderHook(() => useWorkView(taskOptions()), { wrapper });
    await waitFor(() => {
      expect(result.current.response).toBeDefined();
    });

    act(() => {
      result.current.requestFacet('assignee', '');
    });
    await waitFor(() => {
      expect(result.current.facetHasMore).toBe(true);
    });
    expect(result.current.facetResponse?.buckets[0]?.options).toHaveLength(50);
    act(() => {
      result.current.loadMoreFacets();
    });
    await waitFor(() => {
      expect(result.current.facetResponse?.buckets[0]?.options).toHaveLength(51);
    });
    expect(result.current.facetResponse?.buckets[0]?.options.at(-1)?.label).toBe('Actor 51');

    act(() => {
      result.current.requestFacet('assignee', 'search');
    });
    await waitFor(() => {
      expect(result.current.facetResponse?.buckets[0]?.options[0]?.label).toBe('Search result');
    });
    expect(result.current.facetResponse?.buckets[0]?.options).toHaveLength(1);
    expect(apiMocks.facets).toHaveBeenLastCalledWith(
      expect.objectContaining({ json: expect.not.objectContaining({ cursor: expect.anything() }) }),
    );
  });
});

describe('useWorkView preference serialization', () => {
  it('hydrates and persists collapsed groups and hidden board columns', async () => {
    const personal = PersonalWorkViewState.parse({
      instanceKey: taskInstanceOne,
      target: 'task',
      arrangement: taskDefinition.arrangement,
      presentation: taskDefinition.presentation,
      collapsedGroups: ['todo'],
      hiddenBoardColumns: ['done'],
      favoriteViewIds: ['01ARZ3NDEKTSV4RRFFQ69G5FC0'],
      lastUsedLayout: 'list',
    });
    apiMocks.getPreferences.mockResolvedValue(
      okResponse({ timezone: 'America/Los_Angeles', viewState: [personal] }),
    );
    const { wrapper } = makeQueryWrapper();
    const { result } = renderHook(() => useWorkView(taskOptions()), { wrapper });
    await waitFor(() => {
      expect(result.current.response).toBeDefined();
    });
    expect(result.current.collapsedGroups).toEqual(new Set(['todo']));
    expect(result.current.hiddenBoardColumns).toEqual(new Set(['done']));
    expect(result.current.favoriteViewIds).toEqual(new Set(['01ARZ3NDEKTSV4RRFFQ69G5FC0']));

    act(() => {
      result.current.toggleHiddenBoardColumn('done');
    });

    await waitFor(() => {
      expect(result.current.hiddenBoardColumns.size).toBe(0);
    });
    expect(apiMocks.patchPreferences.mock.calls[0]?.[0].json.viewState[0]).toMatchObject({
      collapsedGroups: ['todo'],
      hiddenBoardColumns: [],
      favoriteViewIds: ['01ARZ3NDEKTSV4RRFFQ69G5FC0'],
    });
  });

  it('serializes edit then reset and leaves the reset as the final state', async () => {
    const resolvers: ((value: ReturnType<typeof okResponse>) => void)[] = [];
    apiMocks.patchPreferences.mockImplementation(
      () => new Promise((resolve) => resolvers.push(resolve)),
    );
    const { wrapper } = makeQueryWrapper();
    const { result } = renderHook(() => useWorkView(taskOptions()), { wrapper });
    await waitFor(() => {
      expect(result.current.response).toBeDefined();
    });
    const changed = TaskViewDefinition.parse({
      ...taskDefinition,
      arrangement: { ...taskDefinition.arrangement, groupBy: 'priority' },
    });

    act(() => {
      result.current.setDefinition(changed);
      result.current.resetPersonalOverride();
    });
    await waitFor(() => {
      expect(apiMocks.patchPreferences).toHaveBeenCalledTimes(1);
    });
    await act(async () => {
      resolvers[0]?.(okResponse({ timezone: 'America/Los_Angeles', viewState: [{}] }));
    });
    await waitFor(() => {
      expect(apiMocks.patchPreferences).toHaveBeenCalledTimes(2);
    });
    await act(async () => {
      resolvers[1]?.(okResponse({ timezone: 'America/Los_Angeles', viewState: [] }));
    });
    await waitFor(() => {
      expect(result.current.updatingPreferences).toBe(false);
    });
    expect(apiMocks.patchPreferences.mock.calls[1]?.[0].json.viewState).toEqual([]);
    expect(result.current.definition.arrangement.groupBy).toBe('status');
  });

  it('serializes reset then edit and leaves the edit as the final state', async () => {
    const resolvers: ((value: ReturnType<typeof okResponse>) => void)[] = [];
    apiMocks.patchPreferences.mockImplementation(
      () => new Promise((resolve) => resolvers.push(resolve)),
    );
    const { wrapper } = makeQueryWrapper();
    const { result } = renderHook(() => useWorkView(taskOptions()), { wrapper });
    await waitFor(() => {
      expect(result.current.response).toBeDefined();
    });
    const changed = TaskViewDefinition.parse({
      ...taskDefinition,
      arrangement: { ...taskDefinition.arrangement, groupBy: 'priority' },
    });

    act(() => {
      result.current.resetPersonalOverride();
      result.current.setDefinition(changed);
    });
    await waitFor(() => {
      expect(apiMocks.patchPreferences).toHaveBeenCalledTimes(1);
    });
    await act(async () => {
      resolvers[0]?.(okResponse({ timezone: 'America/Los_Angeles', viewState: [] }));
    });
    await waitFor(() => {
      expect(apiMocks.patchPreferences).toHaveBeenCalledTimes(2);
    });
    await act(async () => {
      const viewState = apiMocks.patchPreferences.mock.calls[1]?.[0].json.viewState;
      resolvers[1]?.(okResponse({ timezone: 'America/Los_Angeles', viewState }));
    });
    await waitFor(() => {
      expect(result.current.updatingPreferences).toBe(false);
    });
    expect(result.current.definition.arrangement.groupBy).toBe('priority');
    expect(apiMocks.patchPreferences.mock.calls[1]?.[0].json.viewState).toHaveLength(1);
  });

  it('restores the durable definition and reports owned copy after a failed edit', async () => {
    apiMocks.patchPreferences.mockRejectedValueOnce(new Error('attacker-controlled failure'));
    const { wrapper } = makeQueryWrapper();
    const { result } = renderHook(() => useWorkView(taskOptions()), { wrapper });
    await waitFor(() => {
      expect(result.current.response).toBeDefined();
    });
    const changed = TaskViewDefinition.parse({
      ...taskDefinition,
      arrangement: { ...taskDefinition.arrangement, groupBy: 'priority' },
    });

    act(() => {
      result.current.setDefinition(changed);
    });
    await waitFor(() => {
      expect(result.current.updatingPreferences).toBe(false);
    });
    await waitFor(() => {
      expect(result.current.definition.arrangement.groupBy).toBe('status');
    });
    expect(result.current.error).toMatchObject({
      message: 'Could not save your view preferences.',
    });
  });
});
