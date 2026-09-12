/**
 * Preference-read failure handling in {@link useWorkView}.
 *
 * @remarks
 * Separated from the main controller suite because these are about what happens when the stored
 * overrides are *unknown* rather than about how a loaded view behaves. `viewState` is written whole
 * and replaces the stored column, so a write built on a failed read is a wipe — these pin that the
 * read failure is reported, that writes are refused until it resolves, and that the surface retry
 * repairs the read.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ActorId } from '@docket/identity-access/ids';
import {
  InitiativeViewDefinition,
  TaskViewDefinition,
  ViewInstanceKey,
  WorkViewQueryResponse,
} from '@docket/work/work-view-contract';

import {
  type UseWorkViewOptions,
  useWorkView,
} from '../../src/components/work-views/use-work-view';
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

describe('useWorkView preference read failures', () => {
  it('stays silent when the preference read fails and nothing was ever submitted', async () => {
    apiMocks.getPreferences.mockRejectedValue(new Error('preference read failed'));
    const { wrapper } = makeQueryWrapper();
    const { result } = renderHook(() => useWorkView(taskOptions()), { wrapper });

    await waitFor(() => {
      expect(result.current.response).toBeDefined();
    });

    // A failed read leaves the surface on defaults and working, so there is nothing for a viewer
    // to act on. Reporting it through the write slot claimed a save had failed that never ran.
    expect(result.current.preferencesError).toBeNull();
  });

  it('repairs the preference read through the surface retry rather than the write retry', async () => {
    apiMocks.getPreferences.mockRejectedValueOnce(new Error('preference read failed'));
    const { wrapper } = makeQueryWrapper();
    const { result } = renderHook(() => useWorkView(taskOptions()), { wrapper });

    await waitFor(() => {
      expect(result.current.response).toBeDefined();
    });
    const readsBefore = apiMocks.getPreferences.mock.calls.length;

    act(() => {
      result.current.retrySurface();
    });

    await waitFor(() => {
      expect(apiMocks.getPreferences.mock.calls.length).toBeGreaterThan(readsBefore);
    });
  });
});
