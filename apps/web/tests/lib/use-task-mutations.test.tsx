/**
 * Optimistic-write behaviour for {@link useTaskMutations}.
 *
 * @remarks
 * Every task write in Docket is optimistic: the person changing a status, a priority, an assignee,
 * a due date or a subtask checkbox sees the new value immediately and the request settles behind
 * them. That only works if the failure path is equally disciplined, so each mutation is held to two
 * claims here:
 *
 * 1. the cache carries the new value **before** the mutation promise settles, and
 * 2. a forced failure restores the previous value **and** surfaces application-owned copy.
 *
 * The second claim is checked against a deliberately hostile rejection — a message shaped like a
 * driver/transport leak — because the rule is not merely "show an error", it is that no provider or
 * exception text ever reaches the screen. `unwrap` is the boundary that enforces it, so the
 * mutations are exercised through it rather than around it.
 */
import { OrganizationId, type TaskDetail, type TaskDetailAggregate, TaskId } from '@docket/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { JSX, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { objectCommandsPost, statePost, taskPatch } = vi.hoisted(() => ({
  objectCommandsPost: vi.fn(),
  statePost: vi.fn(),
  taskPatch: vi.fn(),
}));

vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        ':orgId': {
          'object-commands': { $post: objectCommandsPost },
          tasks: {
            ':id': {
              state: { $post: statePost },
              $patch: taskPatch,
              $delete: vi.fn(),
              subtasks: { $post: vi.fn() },
            },
          },
          comments: { $post: vi.fn() },
        },
      },
    },
  },
}));

import { queryKeys } from '../../src/lib/query';
import { useTaskMutations } from '../../src/lib/use-task-mutations';
import { QueuedOfflineWriteError } from '../../src/components/pwa/offline-write';

const ORG_ID = OrganizationId.parse('01BX5ZZKBKACTAV9WEVGEMMVRZ');
const TASK_ID = TaskId.parse('01BX5ZZKBKACTAV9WEVGEMMVS1');
const SUBTASK_ID = TaskId.parse('01BX5ZZKBKACTAV9WEVGEMMVS2');
const ASSIGNEE_ID = '01BX5ZZKBKACTAV9WEVGEMMVS3';

/**
 * A message shaped like raw transport/driver output.
 *
 * @remarks
 * If any assertion below ever finds this string on the surfaced error, the app is leaking provider
 * text into UI copy — the precise failure the `UserFacingError` boundary exists to prevent.
 */
const LEAKY_REJECTION = 'ECONNREFUSED 10.0.0.4:5432 — pg pool exhausted (driver stack follows)';

/** The task the cache holds before any of these writes run. */
function baseDetail(): TaskDetail {
  // Cast rather than parse: these tests exercise cache reads/writes, and only the fields touched by
  // the mutations under test carry meaning. A full valid TaskDetail would add noise, not coverage.
  return {
    id: TASK_ID,
    title: 'Draft the launch note',
    state: 'todo',
    priority: 'low',
    assigneeId: null,
    dueDate: null,
    blocking: [],
    blockedBy: [],
    subtasks: [{ id: SUBTASK_ID, title: 'Collect quotes', state: 'todo', projectId: null }],
  } as unknown as TaskDetail;
}

/** A typed mock Hono response for the `unwrap` layer. */
function okResponse<T>(body: T) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

/** A successful replay-safe Task title command response. */
function titleCommandResponse(title: string) {
  return okResponse({
    appliedIds: [TASK_ID],
    conflictingIds: [],
    deniedIds: [],
    receipt: {
      commandId: 'returned-command',
      objectKind: 'task',
      action: 'replace_property',
      entries: [
        {
          kind: 'object',
          objectId: TASK_ID,
          property: 'title',
          before: 'Draft the launch note',
          after: title,
        },
      ],
    },
  });
}

/** A promise plus the handles to settle it, so "before it resolves" is observable. */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeHarness(): {
  client: QueryClient;
  wrapper: (props: { children: ReactNode }) => JSX.Element;
  detailKey: readonly unknown[];
} {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const detailKey = queryKeys.task(ORG_ID, TASK_ID);
  client.setQueryData<TaskDetailAggregate>(detailKey, {
    defaultView: { task: baseDetail() },
  } as unknown as TaskDetailAggregate);
  const wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper, detailKey };
}

/** Mount the hook against a fresh cache seeded with {@link baseDetail}. */
function mountMutations() {
  const { client, wrapper, detailKey } = makeHarness();
  // The comment stream hangs off the detail key, exactly as `use-task-detail` derives it.
  const commentsKey = [...detailKey, 'comments'];
  const { result } = renderHook(() => useTaskMutations(ORG_ID, TASK_ID, detailKey, commentsKey), {
    wrapper,
  });
  const read = (): TaskDetail | undefined =>
    client.getQueryData<TaskDetailAggregate>(detailKey)?.defaultView.task;
  return { client, detailKey, result, read };
}

beforeEach(() => {
  objectCommandsPost.mockReset();
  statePost.mockReset();
  taskPatch.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('useTaskMutations — task status', () => {
  it('shows the new status before the request settles', async () => {
    const pending = deferred<ReturnType<typeof okResponse>>();
    statePost.mockReturnValue(pending.promise);
    const { result, read } = mountMutations();

    act(() => {
      void result.current.setState('in_progress');
    });

    await waitFor(() => {
      expect(read()?.state).toBe('in_progress');
    });
    // The request has not answered yet — the UI is ahead of the server, which is the point.
    expect(statePost).toHaveBeenCalledTimes(1);

    pending.resolve(okResponse({ ...baseDetail(), state: 'in_progress' }));
    await waitFor(() => {
      expect(result.current.statusPending).toBe(false);
    });
  });

  it('reverts to the previous status and surfaces application-owned copy on failure', async () => {
    statePost.mockRejectedValue(new Error(LEAKY_REJECTION));
    const { result, read } = mountMutations();

    await act(async () => {
      await result.current.setState('done').catch(() => undefined);
    });

    await waitFor(() => {
      expect(read()?.state).toBe('todo');
    });
    expect(result.current.actionError).toBe('Could not update the status.');
    expect(result.current.actionError).not.toContain('ECONNREFUSED');
    expect(result.current.actionError).not.toContain('pg pool');
  });
});

describe('useTaskMutations — task priority', () => {
  it('shows the new priority before the request settles', async () => {
    const pending = deferred<ReturnType<typeof okResponse>>();
    taskPatch.mockReturnValue(pending.promise);
    const { result, read } = mountMutations();

    act(() => {
      void result.current.setPriority('urgent');
    });

    await waitFor(() => {
      expect(read()?.priority).toBe('urgent');
    });

    pending.resolve(okResponse({ ...baseDetail(), priority: 'urgent' }));
    await waitFor(() => {
      expect(result.current.priorityPending).toBe(false);
    });
  });

  it('reverts to the previous priority and surfaces application-owned copy on failure', async () => {
    taskPatch.mockRejectedValue(new Error(LEAKY_REJECTION));
    const { result, read } = mountMutations();

    await act(async () => {
      await result.current.setPriority('urgent').catch(() => undefined);
    });

    await waitFor(() => {
      expect(read()?.priority).toBe('low');
    });
    expect(result.current.actionError).toBe('Could not update the priority.');
    expect(result.current.actionError).not.toContain('ECONNREFUSED');
  });
});

describe('useTaskMutations — task title', () => {
  it('sends title edits through one replay-safe object command', async () => {
    const renamed = 'Publish the launch note';
    taskPatch.mockResolvedValue(okResponse({ ...baseDetail(), title: renamed }));
    objectCommandsPost.mockResolvedValue(titleCommandResponse(renamed));
    const { result, read } = mountMutations();

    act(() => {
      result.current.patchTask({ title: renamed });
    });

    await waitFor(() => {
      expect(read()?.title).toBe(renamed);
    });
    await waitFor(() => {
      expect(objectCommandsPost).toHaveBeenCalledTimes(1);
    });
    expect(taskPatch).not.toHaveBeenCalled();
    const [request, options] = objectCommandsPost.mock.calls[0] as [
      {
        param: { orgId: string };
        json: {
          commandId: string;
          objectKind: string;
          objectIds: string[];
          operation: { type: string; property: string; value: string };
        };
      },
      { headers: { 'Idempotency-Key': string } },
    ];
    expect(request).toMatchObject({
      param: { orgId: ORG_ID },
      json: {
        objectKind: 'task',
        objectIds: [TASK_ID],
        operation: { type: 'replace_property', property: 'title', value: renamed },
      },
    });
    expect(request.json.commandId).not.toBe('');
    expect(options.headers['Idempotency-Key']).toBe(request.json.commandId);
  });

  it('keeps an offline-queued title visible and surfaces the saved-on-device copy', async () => {
    const renamed = 'Publish the launch note offline';
    objectCommandsPost.mockRejectedValue(new QueuedOfflineWriteError('queued-title-command'));
    const { result, read } = mountMutations();

    act(() => {
      result.current.patchTask({ title: renamed });
    });

    await waitFor(() => {
      expect(read()?.title).toBe(renamed);
    });
    await waitFor(() => {
      expect(result.current.actionError).toBe(
        "Saved on this device. Docket will sync it as soon as you're back online.",
      );
    });
    expect(taskPatch).not.toHaveBeenCalled();
  });

  it('keeps mixed title patches on the Task PATCH route', async () => {
    const renamed = 'Publish the launch note';
    const dueDate = '2026-09-01';
    taskPatch.mockResolvedValue(okResponse({ ...baseDetail(), title: renamed, dueDate }));
    const { result, read } = mountMutations();

    act(() => {
      result.current.patchTask({ title: renamed, dueDate });
    });

    await waitFor(() => {
      expect(read()).toMatchObject({ title: renamed, dueDate });
    });
    await waitFor(() => {
      expect(taskPatch).toHaveBeenCalledTimes(1);
    });
    expect(objectCommandsPost).not.toHaveBeenCalled();
    expect(taskPatch).toHaveBeenCalledWith({
      param: { orgId: ORG_ID, id: TASK_ID },
      json: { title: renamed, dueDate },
    });
  });

  it('clears a failed title command after a later ordinary patch succeeds', async () => {
    objectCommandsPost.mockRejectedValue(new Error(LEAKY_REJECTION));
    taskPatch.mockResolvedValue(okResponse({ ...baseDetail(), dueDate: '2026-09-01' }));
    const { result } = mountMutations();

    act(() => {
      result.current.patchTask({ title: 'This rename will fail' });
    });
    await waitFor(() => {
      expect(result.current.actionError).toBe('Could not update the task.');
    });

    act(() => {
      result.current.patchTask({ dueDate: '2026-09-01' });
    });
    await waitFor(() => {
      expect(result.current.actionError).toBeNull();
    });
  });

  it('clears a failed ordinary patch after a later title command succeeds', async () => {
    taskPatch.mockRejectedValue(new Error(LEAKY_REJECTION));
    objectCommandsPost.mockResolvedValue(titleCommandResponse('Publish the launch note'));
    const { result } = mountMutations();

    act(() => {
      result.current.patchTask({ dueDate: '2026-09-01' });
    });
    await waitFor(() => {
      expect(result.current.actionError).toBe('Could not update the task.');
    });

    act(() => {
      result.current.patchTask({ title: 'Publish the launch note' });
    });
    await waitFor(() => {
      expect(result.current.actionError).toBeNull();
    });
  });
});

describe('useTaskMutations — assignee and dates', () => {
  it('shows a new assignee before the request settles', async () => {
    const pending = deferred<ReturnType<typeof okResponse>>();
    taskPatch.mockReturnValue(pending.promise);
    const { result, read } = mountMutations();

    act(() => {
      result.current.patchTask({ assigneeId: ASSIGNEE_ID });
    });

    await waitFor(() => {
      expect(read()?.assigneeId).toBe(ASSIGNEE_ID);
    });

    pending.resolve(okResponse({ ...baseDetail(), assigneeId: ASSIGNEE_ID }));
    await waitFor(() => {
      expect(result.current.propsPending).toBe(false);
    });
  });

  it('shows a new due date before the request settles', async () => {
    const pending = deferred<ReturnType<typeof okResponse>>();
    taskPatch.mockReturnValue(pending.promise);
    const { result, read } = mountMutations();

    act(() => {
      result.current.patchTask({ dueDate: '2026-09-01' });
    });

    await waitFor(() => {
      expect(read()?.dueDate).toBe('2026-09-01');
    });

    pending.resolve(okResponse({ ...baseDetail(), dueDate: '2026-09-01' }));
    await waitFor(() => {
      expect(result.current.propsPending).toBe(false);
    });
  });

  it('reverts assignee and due date together and surfaces application-owned copy on failure', async () => {
    taskPatch.mockRejectedValue(new Error(LEAKY_REJECTION));
    const { result, read } = mountMutations();

    act(() => {
      result.current.patchTask({ assigneeId: ASSIGNEE_ID, dueDate: '2026-09-01' });
    });

    await waitFor(() => {
      expect(result.current.actionError).not.toBeNull();
    });
    // A partial rollback would be worse than none: the whole patch is one edit, so it reverts as one.
    expect(read()?.assigneeId).toBeNull();
    expect(read()?.dueDate).toBeNull();
    expect(result.current.actionError).toBe('Could not update the task.');
    expect(result.current.actionError).not.toContain('ECONNREFUSED');
  });
});

describe('useTaskMutations — subtask completion', () => {
  it('checks the subtask off before the request settles', async () => {
    const pending = deferred<ReturnType<typeof okResponse>>();
    statePost.mockReturnValue(pending.promise);
    const { result, read } = mountMutations();

    act(() => {
      void result.current.toggleSubtask(SUBTASK_ID, true);
    });

    await waitFor(() => {
      expect(read()?.subtasks[0]?.state).toBe('done');
    });

    pending.resolve(okResponse(baseDetail()));
    await waitFor(() => {
      expect(statePost).toHaveBeenCalledTimes(1);
    });
  });

  it('unchecks the subtask again and surfaces application-owned copy on failure', async () => {
    statePost.mockRejectedValue(new Error(LEAKY_REJECTION));
    const { result, read } = mountMutations();

    await act(async () => {
      await result.current.toggleSubtask(SUBTASK_ID, true).catch(() => undefined);
    });

    await waitFor(() => {
      expect(read()?.subtasks[0]?.state).toBe('todo');
    });
    expect(result.current.actionError).toBe('Could not update the subtask.');
    expect(result.current.actionError).not.toContain('ECONNREFUSED');
  });
});
