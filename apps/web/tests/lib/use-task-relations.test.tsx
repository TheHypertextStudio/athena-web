/**
 * The task page's relationship writes: blockers, blocked tasks, related tasks, subtasks, parent.
 *
 * @remarks
 * Each write must land on screen before the server answers, reach the right endpoint in the right
 * direction, and put the screen back when the server refuses — with a classified notice rather
 * than the server's own words. Hierarchy moves must offer Undo.
 */
import '@testing-library/jest-dom/vitest';

import { OrganizationId } from '@docket/identity-access/ids';
import { Toaster, dismissAllNotices } from '@docket/ui/components';
import { TaskId } from '@docket/work/ids';
import type { TaskDetail, TaskRef } from '@docket/work/task-model';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, screen, waitFor } from '@testing-library/react';
import type { JSX, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TaskDetailAggregate } from '../../src/lib/contracts/detail-aggregate';
import { okResponse, problemResponse } from '../support/query';

const { dependencyPost, dependencyDelete, taskPatch, reparentPost } = vi.hoisted(() => ({
  dependencyPost: vi.fn(),
  dependencyDelete: vi.fn(),
  taskPatch: vi.fn(),
  reparentPost: vi.fn(),
}));

vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        ':orgId': {
          tasks: {
            reparent: { $post: reparentPost },
            ':id': {
              $patch: taskPatch,
              dependencies: { $post: dependencyPost, ':depId': { $delete: dependencyDelete } },
            },
          },
        },
      },
    },
  },
}));

const { queryKeys } = await import('../../src/lib/query');
const { useTaskRelations } = await import('../../src/lib/use-task-relations');

const ORG_ID = OrganizationId.parse('01BX5ZZKBKACTAV9WEVGEMMVRZ');
const TASK_ID = TaskId.parse('01BX5ZZKBKACTAV9WEVGEMMVS1');

/** A task reference other than the page's own. */
function ref(suffix: string, title: string): TaskRef {
  return { id: TaskId.parse(`01BX5ZZKBKACTAV9WEVGEMMV${suffix}`), title, state: 'todo' };
}

const BLOCKER = ref('B1', 'Write the brief');
const DEPENDENT = ref('B2', 'Publish the brief');
const RELATED = ref('B3', 'Brief template');
const CHILD = ref('B4', 'Collect quotes');

function baseDetail(): TaskDetail {
  return {
    id: TASK_ID,
    title: 'Draft the launch note',
    state: 'todo',
    parentTaskId: null,
    blocking: [DEPENDENT],
    blockedBy: [],
    relatedTasks: [],
    subtasks: [CHILD],
  } as unknown as TaskDetail;
}

/** A promise that never settles, so the screen can be read before the server answers. */
function pending(): Promise<never> {
  return new Promise<never>(() => undefined);
}

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const detailKey = queryKeys.task(ORG_ID, TASK_ID);
  client.setQueryData<TaskDetailAggregate>(detailKey, {
    snapshot: {},
    defaultView: { task: baseDetail() },
  } as unknown as TaskDetailAggregate);
  const wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
    <QueryClientProvider client={client}>
      {children}
      <Toaster />
    </QueryClientProvider>
  );
  const { result } = renderHook(() => useTaskRelations(ORG_ID, TASK_ID, detailKey), { wrapper });
  const read = (): TaskDetail | undefined =>
    client.getQueryData<TaskDetailAggregate>(detailKey)?.defaultView.task;
  return { result, read };
}

beforeEach(() => {
  dependencyPost.mockReset();
  dependencyDelete.mockReset();
  taskPatch.mockReset();
  reparentPost.mockReset();
});

afterEach(() => {
  dismissAllNotices();
  cleanup();
});

describe('useTaskRelations — dependencies', () => {
  it('lists a new blocker at once and asks for it as the blocking side', async () => {
    dependencyPost.mockReturnValue(pending());
    const { result, read } = mount();

    act(() => {
      result.current.addDependency('blockedBy', BLOCKER);
    });

    await waitFor(() => {
      expect(read()?.blockedBy.map((task) => task.id)).toEqual([BLOCKER.id]);
    });
    expect(dependencyPost).toHaveBeenCalledWith({
      param: { orgId: ORG_ID, id: TASK_ID },
      json: { blockingTaskId: BLOCKER.id },
    });
  });

  it('asks for a blocked task as the blocked side', async () => {
    dependencyPost.mockReturnValue(pending());
    const { result } = mount();

    act(() => {
      result.current.addDependency('blocking', RELATED);
    });

    await waitFor(() => {
      expect(dependencyPost).toHaveBeenCalledWith(
        expect.objectContaining({ json: { blockedTaskId: RELATED.id } }),
      );
    });
  });

  it('takes back a refused link and says why in its own words', async () => {
    const leak = 'cycle via 01BX… at depth 4 (pg serialization)';
    dependencyPost.mockResolvedValue(problemResponse(leak, 409, 'dependency_cycle'));
    const { result, read } = mount();

    act(() => {
      result.current.addDependency('blockedBy', BLOCKER);
    });

    const notice = await screen.findByRole('alert');
    expect(notice.textContent).not.toContain('pg serialization');
    expect(read()?.blockedBy).toEqual([]);
  });

  it('removes a dependency from whichever side it is on', async () => {
    dependencyDelete.mockReturnValue(pending());
    const { result, read } = mount();

    act(() => {
      result.current.removeDependency(DEPENDENT.id);
    });

    await waitFor(() => {
      expect(read()?.blocking).toEqual([]);
    });
    expect(dependencyDelete).toHaveBeenCalledWith({
      param: { orgId: ORG_ID, id: TASK_ID, depId: DEPENDENT.id },
    });
  });
});

describe('useTaskRelations — related tasks', () => {
  it('sends the whole related set with the new task added, and removes it the same way', async () => {
    taskPatch.mockResolvedValue(okResponse({ id: TASK_ID }));
    const { result, read } = mount();

    act(() => {
      result.current.addRelated(RELATED);
    });
    await waitFor(() => {
      expect(read()?.relatedTasks.map((task) => task.id)).toEqual([RELATED.id]);
    });
    expect(taskPatch).toHaveBeenCalledWith({
      param: { orgId: ORG_ID, id: TASK_ID },
      json: { relatedTaskIds: [RELATED.id] },
    });

    act(() => {
      result.current.removeRelated(RELATED.id);
    });
    await waitFor(() => {
      expect(taskPatch).toHaveBeenLastCalledWith(
        expect.objectContaining({ json: { relatedTaskIds: [] } }),
      );
    });
  });
});

describe('useTaskRelations — hierarchy', () => {
  it('detaches a subtask at once and offers to undo the move', async () => {
    reparentPost.mockResolvedValue(
      okResponse({
        moves: [{ taskId: CHILD.id, parentTaskId: null, previousParentTaskId: TASK_ID }],
      }),
    );
    const { result, read } = mount();

    act(() => {
      result.current.detachSubtask(CHILD.id);
    });

    await waitFor(() => {
      expect(read()?.subtasks).toEqual([]);
    });
    expect(reparentPost).toHaveBeenCalledWith({
      param: { orgId: ORG_ID },
      json: { moves: [{ taskId: CHILD.id, parentTaskId: null }], preserveSelectedSubtrees: true },
    });
    expect(await screen.findByRole('button', { name: 'Undo' })).toBeInTheDocument();
  });

  it('attaches an existing task under this one and lists it at once', async () => {
    reparentPost.mockReturnValue(pending());
    const { result, read } = mount();

    act(() => {
      result.current.attachSubtask(RELATED);
    });

    await waitFor(() => {
      expect(read()?.subtasks.map((task) => task.id)).toEqual([CHILD.id, RELATED.id]);
    });
    expect(reparentPost).toHaveBeenCalledWith(
      expect.objectContaining({
        json: expect.objectContaining({ moves: [{ taskId: RELATED.id, parentTaskId: TASK_ID }] }),
      }),
    );
  });

  it('files this task under a parent, and back to the top level', async () => {
    reparentPost.mockReturnValue(pending());
    const { result } = mount();

    act(() => {
      result.current.setParent(BLOCKER.id);
    });
    await waitFor(() => {
      expect(reparentPost).toHaveBeenCalledWith(
        expect.objectContaining({
          json: expect.objectContaining({ moves: [{ taskId: TASK_ID, parentTaskId: BLOCKER.id }] }),
        }),
      );
    });

    act(() => {
      result.current.setParent(null);
    });
    await waitFor(() => {
      expect(reparentPost).toHaveBeenLastCalledWith(
        expect.objectContaining({
          json: expect.objectContaining({ moves: [{ taskId: TASK_ID, parentTaskId: null }] }),
        }),
      );
    });
  });
});
