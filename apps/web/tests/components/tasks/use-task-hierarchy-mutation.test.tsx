/** `@docket/web` — shared optimistic task hierarchy mutation tests. */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTaskHierarchyMutation } from '@/components/tasks/use-task-hierarchy-mutation';
import { queryKeys } from '@/lib/query';
import { makeQueryWrapper, okResponse, problemResponse } from '../../support/query';

const { REPARENT } = vi.hoisted(() => ({ REPARENT: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        ':orgId': {
          tasks: { reparent: { $post: REPARENT } },
        },
      },
    },
  },
}));

const ORG = 'org_1';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useTaskHierarchyMutation', () => {
  it('patches task detail, list, and every graph scope as one optimistic unit', async () => {
    let resolveWrite!: (value: ReturnType<typeof okResponse>) => void;
    REPARENT.mockReturnValue(new Promise((resolve) => (resolveWrite = resolve)));
    const { client, wrapper } = makeQueryWrapper();
    client.setQueryData(queryKeys.tasks(ORG), {
      items: [
        { id: 'a', parentTaskId: null },
        { id: 'b', parentTaskId: null },
      ],
    });
    client.setQueryData(queryKeys.task(ORG, 'a'), { id: 'a', parentTaskId: null });
    client.setQueryData(queryKeys.taskGraph(ORG, 'org'), {
      nodes: [{ id: 'a', parentTaskId: null }],
      edges: [],
    });
    client.setQueryData(queryKeys.taskGraph(ORG, 'project:p1'), {
      nodes: [{ id: 'a', parentTaskId: null }],
      edges: [],
    });
    const { result } = renderHook(() => useTaskHierarchyMutation(), { wrapper });

    act(() => {
      result.current.reparent({
        organizationId: ORG,
        moves: [{ taskId: 'a', parentTaskId: 'b' }],
        preserveSelectedSubtrees: true,
      });
    });

    await waitFor(() => {
      expect(client.getQueryData<{ parentTaskId: string }>(queryKeys.task(ORG, 'a'))).toMatchObject(
        { parentTaskId: 'b' },
      );
    });
    expect(
      client.getQueryData<{ items: { parentTaskId: string }[] }>(queryKeys.tasks(ORG)),
    ).toMatchObject({ items: [{ parentTaskId: 'b' }, { parentTaskId: null }] });
    for (const scope of ['org', 'project:p1']) {
      expect(
        client.getQueryData<{ nodes: { parentTaskId: string }[] }>(queryKeys.taskGraph(ORG, scope)),
      ).toMatchObject({ nodes: [{ parentTaskId: 'b' }] });
    }

    resolveWrite(
      okResponse({
        moves: [{ taskId: 'a', previousParentTaskId: null, parentTaskId: 'b' }],
      }),
    );
  });

  it('rolls every optimistic cache entry back when the atomic write fails', async () => {
    REPARENT.mockResolvedValue(problemResponse('internal database detail'));
    const { client, wrapper } = makeQueryWrapper();
    client.setQueryData(queryKeys.tasks(ORG), { items: [{ id: 'a', parentTaskId: null }] });
    client.setQueryData(queryKeys.taskGraph(ORG, 'org'), {
      nodes: [{ id: 'a', parentTaskId: null }],
      edges: [],
    });
    const { result } = renderHook(() => useTaskHierarchyMutation(), { wrapper });

    act(() => {
      result.current.reparent({
        organizationId: ORG,
        moves: [{ taskId: 'a', parentTaskId: 'b' }],
        preserveSelectedSubtrees: false,
      });
    });

    await waitFor(() => {
      expect(result.current.error).toBe('Could not change the task hierarchy.');
    });
    expect(client.getQueryData(queryKeys.tasks(ORG))).toMatchObject({
      items: [{ id: 'a', parentTaskId: null }],
    });
    expect(client.getQueryData(queryKeys.taskGraph(ORG, 'org'))).toMatchObject({
      nodes: [{ id: 'a', parentTaskId: null }],
    });
  });

  it('undoes multiple roots with their different previous parents and disables subtree reduction', async () => {
    REPARENT.mockResolvedValueOnce(
      okResponse({
        moves: [
          { taskId: 'a', previousParentTaskId: 'old-a', parentTaskId: 'target' },
          { taskId: 'b', previousParentTaskId: null, parentTaskId: 'target' },
        ],
      }),
    );
    REPARENT.mockResolvedValueOnce(okResponse({ moves: [] }));
    const { wrapper } = makeQueryWrapper();
    const { result } = renderHook(() => useTaskHierarchyMutation(), { wrapper });

    act(() => {
      result.current.reparent({
        organizationId: ORG,
        moves: [
          { taskId: 'a', parentTaskId: 'target' },
          { taskId: 'b', parentTaskId: 'target' },
        ],
        preserveSelectedSubtrees: true,
      });
    });
    await waitFor(() => {
      expect(result.current.undo?.label).toBe('2 tasks moved');
    });
    act(() => result.current.undo?.undo());

    await waitFor(() => {
      expect(REPARENT).toHaveBeenCalledTimes(2);
    });
    expect(REPARENT.mock.calls[1]?.[0]).toEqual({
      param: { orgId: ORG },
      json: {
        moves: [
          { taskId: 'a', parentTaskId: 'old-a' },
          { taskId: 'b', parentTaskId: null },
        ],
        preserveSelectedSubtrees: false,
      },
    });
  });
});
