import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PlanDraftOut } from '@docket/work/plan-draft-contract';

const calls = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
  commit: vi.fn(),
}));

vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      me: {
        plans: {
          ':id': {
            $get: calls.get,
            $patch: calls.patch,
            commit: { $post: calls.commit },
            archive: { $post: vi.fn() },
          },
          $post: vi.fn(),
        },
      },
    },
  },
}));

vi.mock('../../src/lib/athena/chat-defs', () => ({
  useOrgChatThread: () => ({ data: undefined }),
}));

import { latestPlanActionId, usePlanOps } from '../../src/lib/plan-draft/defs';
import { queryKeys } from '../../src/lib/query';
import { makeQueryWrapper, okResponse, problemResponse } from '../support/query';

function plan(revision: number, title = 'Spring'): PlanDraftOut {
  return {
    id: 'plan_1',
    organizationId: 'org_1' as PlanDraftOut['organizationId'],
    sessionId: null,
    rootInitiativeId: null,
    title,
    status: 'active',
    revision,
    document: {
      nodes: [
        {
          ref: 'init',
          kind: 'initiative',
          parentRef: null,
          initiativeRefs: [],
          initiativeIds: [],
          fields: { title: 'Spring campaign' },
          templateId: null,
          status: 'draft',
          objectId: null,
        },
      ],
      edges: [],
    },
    objects: {},
    createdAt: '2026-09-05T00:00:00.000Z',
    updatedAt: '2026-09-05T00:00:00.000Z',
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('usePlanOps', () => {
  it('applies a batch optimistically against the cached revision and keeps the server answer', async () => {
    const { client, wrapper } = makeQueryWrapper();
    client.setQueryData(queryKeys.plan('plan_1'), plan(2));
    let resolvePatch: (value: unknown) => void = () => undefined;
    calls.patch.mockReturnValueOnce(
      new Promise((resolve) => {
        resolvePatch = resolve;
      }),
    );
    const { result } = renderHook(() => usePlanOps('plan_1'), { wrapper });

    let applied: Promise<PlanDraftOut | null> = Promise.resolve(null);
    act(() => {
      applied = result.current.apply([
        { op: 'set_fields', ref: 'init', fields: { summary: 'Raise $120k' } },
      ]);
    });
    await waitFor(() => {
      const cached = client.getQueryData<PlanDraftOut>(queryKeys.plan('plan_1'));
      expect(cached?.document.nodes[0]?.fields.summary).toBe('Raise $120k');
    });
    expect(calls.patch).toHaveBeenCalledWith({
      param: { id: 'plan_1' },
      json: {
        revision: 2,
        ops: [{ op: 'set_fields', ref: 'init', fields: { summary: 'Raise $120k' } }],
      },
    });

    resolvePatch(okResponse(plan(3, 'Renamed by server')));
    await expect(applied).resolves.toMatchObject({ revision: 3 });
    expect(client.getQueryData<PlanDraftOut>(queryKeys.plan('plan_1'))?.title).toBe(
      'Renamed by server',
    );
  });

  it('rebases once on a stale revision by reading the plan again', async () => {
    const { client, wrapper } = makeQueryWrapper();
    client.setQueryData(queryKeys.plan('plan_1'), plan(2));
    calls.patch
      .mockResolvedValueOnce(problemResponse('stale', 412, 'precondition_failed'))
      .mockResolvedValueOnce(okResponse(plan(6)));
    calls.get.mockResolvedValueOnce(okResponse(plan(5)));
    const { result } = renderHook(() => usePlanOps('plan_1'), { wrapper });

    let applied: PlanDraftOut | null = null;
    await act(async () => {
      applied = await result.current.apply([{ op: 'set_title', title: 'Late' }]);
    });
    expect(applied).toMatchObject({ revision: 6 });
    expect(calls.patch).toHaveBeenCalledTimes(2);
    expect(calls.patch.mock.calls[1]?.[0]).toMatchObject({ json: { revision: 5 } });
    expect(result.current.error).toBeNull();
  });

  it('surfaces application copy when the server refuses the batch outright', async () => {
    const { client, wrapper } = makeQueryWrapper();
    client.setQueryData(queryKeys.plan('plan_1'), plan(2));
    calls.patch.mockResolvedValueOnce(problemResponse('nope', 422, 'validation_error'));
    const { result } = renderHook(() => usePlanOps('plan_1'), { wrapper });

    let applied: PlanDraftOut | null = plan(0);
    await act(async () => {
      applied = await result.current.apply([{ op: 'remove_node', ref: 'init' }]);
    });
    expect(applied).toBeNull();
    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });
    expect(result.current.error).not.toContain('nope');
    act(() => {
      result.current.clearError();
    });
    expect(result.current.error).toBeNull();
  });

  it('does not apply a template batch ahead of the server', async () => {
    const { client, wrapper } = makeQueryWrapper();
    client.setQueryData(queryKeys.plan('plan_1'), plan(2));
    calls.patch.mockResolvedValueOnce(okResponse(plan(3)));
    const { result } = renderHook(() => usePlanOps('plan_1'), { wrapper });
    await act(async () => {
      await result.current.apply([
        { op: 'apply_template', ref: 'init', templateId: 'tpl_1' as never },
      ]);
    });
    expect(client.getQueryData<PlanDraftOut>(queryKeys.plan('plan_1'))?.revision).toBe(3);
  });
});

describe('latestPlanActionId', () => {
  it('finds the newest plan-tool action and ignores other activities', () => {
    const activities = [
      { id: 'a1', type: 'action', body: { action: { kind: 'plan_draft' } } },
      { id: 'a2', type: 'response', body: { text: 'hi' } },
      { id: 'a3', type: 'action', body: { action: { kind: 'capture' } } },
      { id: 'a4', type: 'action', body: { action: { kind: 'plan_commit' } } },
      { id: 'a5', type: 'action', body: { action: { kind: 'update' } } },
    ] as never;
    expect(latestPlanActionId(activities)).toBe('a4');
    expect(latestPlanActionId([])).toBeNull();
  });
});
