/**
 * Mutation hook for the task detail page — all writes in one place.
 *
 * @remarks
 * Encapsulates the state, priority, patch, subtask, and comment mutations along with
 * their optimistic cache writes. Returns stable callbacks the page wires into its
 * interactive affordances.
 */
import {
  ActorId,
  type CommentOut,
  CycleId,
  LabelId,
  MilestoneId,
  type Priority,
  ProgramId,
  ProjectId,
  type TaskArchived,
  type TaskDetail,
  type TaskOut,
} from '@docket/types';
import type { QueryKey } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { useStatusRegistry } from '@/components/statuses/status-registry';

import { api } from './api';
import { userErrorMessage, UserFacingError } from './problem';
import { queryKeys, unwrap, useApiMutation } from './query';

/** Fields accepted by the task patch mutation. All are optional; `null` clears the field. */
export interface TaskPatch {
  /** New title. Non-empty; titles cannot be cleared. */
  title?: string | undefined;
  /**
   * New description body, or `''` to empty it.
   *
   * @remarks
   * The task detail's description editor patches through here. It must be listed both on this
   * interface *and* in the mutation's request body, which is an explicit field whitelist: a field
   * present on the type but missing from the body compiles, saves nothing, and still shows the
   * editor's own "saved" state — a silent no-op is worse than a type error.
   */
  description?: string | undefined;
  assigneeId?: string | null | undefined;
  projectId?: string | null | undefined;
  programId?: string | null | undefined;
  milestoneId?: string | null | undefined;
  cycleId?: string | null | undefined;
  /** New point estimate, or `null` to clear it. */
  estimate?: number | null | undefined;
  /**
   * The anticipated start date as a bare `YYYY-MM-DD` calendar day, or `null` to clear it.
   *
   * @remarks
   * Distinct from {@link TaskPatch.dueDate}: this is when the work is expected to *begin*, which is
   * what makes a task schedulable rather than merely deadlined. The column is separate in the
   * database and separate in `TaskUpdate`, so the two never overwrite each other. The API validates
   * this as `z.iso.date()` and rejects a full datetime with a 422 — send the day only, never an
   * instant.
   */
  startDate?: string | null | undefined;
  dueDate?: string | null | undefined;
  /**
   * The task's complete label set, replacing whatever it carried.
   *
   * @remarks
   * Replace-set, not merge: send every label the task should end up with, and `[]` to clear it.
   * The server collapses any exclusive-group collision on the way in, so a picker can send both
   * members of a single-choice group and get the one the user clicked last.
   */
  labels?: readonly string[] | undefined;
}

/** Stable mutation callbacks + pending/error state returned by {@link useTaskMutations}. */
export interface TaskMutations {
  setState: (stateKey: string) => Promise<void>;
  setPriority: (priority: Priority) => Promise<void>;
  patchTask: (patch: TaskPatch) => void;
  addSubtask: (title: string) => Promise<void>;
  toggleSubtask: (subtaskId: string, done: boolean) => Promise<void>;
  addComment: (body: string) => Promise<void>;
  /**
   * Archive (soft-delete) the task. Fires the DELETE mutation and invalidates the org task list;
   * the caller supplies `onSuccess` to close its confirm dialog and navigate away.
   */
  deleteTask: (options?: { onSuccess?: (() => void) | undefined }) => void;
  actionError: string | null;
  propsPending: boolean;
  statusPending: boolean;
  priorityPending: boolean;
  /** Whether the delete/archive request is in flight (disables the confirm affordance). */
  deletePending: boolean;
  /**
   * User-facing message for a failed delete/archive, or `null` when there is none. Surfaced inside
   * the confirm dialog so the failure stays visible while the dialog remains open; kept out of
   * {@link actionError} to avoid double-rendering the same failure in the page header.
   */
  deleteError: string | null;
  /** Clears any prior delete failure so a reopened confirm dialog never shows a stale message. */
  resetDelete: () => void;
}

/**
 * All write operations for the task detail page.
 *
 * @param orgId - The active organization id.
 * @param taskId - The task being mutated.
 * @param detailKey - The React Query cache key for the task detail (for optimistic writes).
 * @param commentsKey - The React Query cache key for the comment stream.
 */
export function useTaskMutations(
  orgId: string,
  taskId: string,
  detailKey: QueryKey,
  commentsKey: QueryKey,
): TaskMutations {
  const queryClient = useQueryClient();
  const statuses = useStatusRegistry();

  // The subtask checkbox writes a status *key*, and the keys it used to write were the literals
  // `done` and `todo` — which name nothing in a workspace that renamed its stages. Ticking the box
  // means "this is finished", so it writes the first completed status of the workspace's own set,
  // and unticking it returns the subtask to wherever new work starts.
  const toggleTarget = useCallback(
    (done: boolean): string | null => {
      const target = done
        ? statuses.firstOfCategory('task', 'completed')
        : statuses.defaultOf('task');
      return target?.key ?? null;
    },
    [statuses],
  );

  const writeDetail = useCallback(
    (patch: Partial<TaskDetail>): TaskDetail | undefined => {
      const previous = queryClient.getQueryData<TaskDetail>(detailKey);
      queryClient.setQueryData<TaskDetail>(detailKey, (current) =>
        current ? { ...current, ...patch } : current,
      );
      return previous;
    },
    [queryClient, detailKey],
  );

  const adoptTaskOut = useCallback(
    (updated: TaskOut): void => {
      queryClient.setQueryData<TaskDetail>(detailKey, (current) =>
        current
          ? {
              ...current,
              ...updated,
              blocking: current.blocking,
              blockedBy: current.blockedBy,
              subtasks: current.subtasks,
            }
          : current,
      );
    },
    [queryClient, detailKey],
  );

  const stateMutation = useApiMutation<TaskOut, string, { previous?: TaskDetail | undefined }>({
    mutationFn: (stateKey) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].tasks[':id'].state.$post({
            param: { orgId, id: taskId },
            json: { state: stateKey },
          }),
        'Could not update the status.',
      ),
    onMutate: async (stateKey) => {
      await queryClient.cancelQueries({ queryKey: detailKey });
      return { previous: writeDetail({ state: stateKey }) };
    },
    onError: (_err, _stateKey, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(detailKey, ctx.previous);
    },
    onSuccess: (updated) => {
      adoptTaskOut(updated);
    },
    invalidateKeys: [detailKey, queryKeys.tasks(orgId)],
  });

  const priorityMutation = useApiMutation<TaskOut, Priority, { previous?: TaskDetail | undefined }>(
    {
      mutationFn: (priority) =>
        unwrap(
          () =>
            api.v1.orgs[':orgId'].tasks[':id'].$patch({
              param: { orgId, id: taskId },
              json: { priority },
            }),
          'Could not update the priority.',
        ),
      onMutate: async (priority) => {
        await queryClient.cancelQueries({ queryKey: detailKey });
        return { previous: writeDetail({ priority }) };
      },
      onError: (_err, _priority, ctx) => {
        if (ctx?.previous) queryClient.setQueryData(detailKey, ctx.previous);
      },
      onSuccess: (updated) => {
        adoptTaskOut(updated);
      },
      invalidateKeys: [detailKey, queryKeys.tasks(orgId)],
    },
  );

  const patchMutation = useApiMutation<TaskOut, TaskPatch, { previous?: TaskDetail | undefined }>({
    mutationFn: (patch) => {
      const body = {
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.assigneeId !== undefined
          ? { assigneeId: patch.assigneeId === null ? null : ActorId.parse(patch.assigneeId) }
          : {}),
        ...(patch.projectId !== undefined
          ? { projectId: patch.projectId === null ? null : ProjectId.parse(patch.projectId) }
          : {}),
        ...(patch.programId !== undefined
          ? { programId: patch.programId === null ? null : ProgramId.parse(patch.programId) }
          : {}),
        ...(patch.milestoneId !== undefined
          ? {
              milestoneId: patch.milestoneId === null ? null : MilestoneId.parse(patch.milestoneId),
            }
          : {}),
        ...(patch.cycleId !== undefined
          ? { cycleId: patch.cycleId === null ? null : CycleId.parse(patch.cycleId) }
          : {}),
        ...(patch.estimate !== undefined ? { estimate: patch.estimate } : {}),
        ...(patch.startDate !== undefined ? { startDate: patch.startDate } : {}),
        ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate } : {}),
        ...(patch.labels !== undefined
          ? { labels: patch.labels.map((id) => LabelId.parse(id)) }
          : {}),
      };
      return unwrap(
        () =>
          api.v1.orgs[':orgId'].tasks[':id'].$patch({
            param: { orgId, id: taskId },
            json: body,
          }),
        'Could not update the task.',
      );
    },
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: detailKey });
      // `labels` carries ids on the patch but full label records on the cached detail;
      // `writeDetail` blindly spreads its argument onto the cache, so the key must actually be
      // absent from the object here (not just from its type) or the optimistic write stamps ids
      // in where label records belong.
      const { labels, ...detailPatch } = patch;
      return { previous: writeDetail(detailPatch as Partial<TaskDetail>) };
    },
    onError: (_err, _patch, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(detailKey, ctx.previous);
    },
    onSuccess: (updated) => {
      adoptTaskOut(updated);
    },
    // The Resources tab's derived sections are a projection of this record's prose, and the query
    // cache survives a reload — so without this, adding a mention to the description leaves that
    // tab showing the pre-edit answer until the staleness tier happens to expire.
    invalidateKeys: [
      detailKey,
      queryKeys.tasks(orgId),
      queryKeys.entityMentions(orgId, 'task', taskId),
    ],
  });

  const addSubtaskMutation = useApiMutation<TaskOut, string>({
    mutationFn: (title) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].tasks[':id'].subtasks.$post({
            param: { orgId, id: taskId },
            json: { title },
          }),
        'Could not add the subtask.',
      ),
    invalidateKeys: [detailKey, queryKeys.tasks(orgId)],
  });

  const toggleSubtaskMutation = useApiMutation<
    TaskOut,
    { subtaskId: string; done: boolean },
    { previous?: TaskDetail | undefined }
  >({
    mutationFn: ({ subtaskId, done }) => {
      const state = toggleTarget(done);
      // Nothing to write to before the workspace's statuses arrive; the caller's error surface
      // says so in the app's own words rather than leaking a thrown message.
      if (state === null) throw new UserFacingError('Could not update the subtask.');
      return unwrap(
        () =>
          api.v1.orgs[':orgId'].tasks[':id'].state.$post({
            param: { orgId, id: subtaskId },
            json: { state },
          }),
        'Could not update the subtask.',
      );
    },
    onMutate: async ({ subtaskId, done }) => {
      await queryClient.cancelQueries({ queryKey: detailKey });
      const previous = queryClient.getQueryData<TaskDetail>(detailKey);
      const state = toggleTarget(done);
      queryClient.setQueryData<TaskDetail>(detailKey, (current) =>
        current && state !== null
          ? {
              ...current,
              subtasks: current.subtasks.map((s) => (s.id === subtaskId ? { ...s, state } : s)),
            }
          : current,
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(detailKey, ctx.previous);
    },
    invalidateKeys: [detailKey, queryKeys.tasks(orgId)],
  });

  const commentMutation = useApiMutation<CommentOut, string>({
    mutationFn: (body) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].comments.$post({
            param: { orgId },
            json: { subjectType: 'task', subjectId: taskId, body },
          }),
        'Could not post the comment.',
      ),
    invalidateKeys: [commentsKey],
  });

  const deleteMutation = useApiMutation<TaskArchived, undefined>({
    mutationFn: () =>
      unwrap(
        () => api.v1.orgs[':orgId'].tasks[':id'].$delete({ param: { orgId, id: taskId } }),
        'Could not delete this task.',
      ),
    invalidateKeys: [queryKeys.tasks(orgId)],
  });

  const setState = useCallback(
    (stateKey: string): Promise<void> => stateMutation.mutateAsync(stateKey).then(() => undefined),
    [stateMutation],
  );
  const setPriority = useCallback(
    (priority: Priority): Promise<void> =>
      priorityMutation.mutateAsync(priority).then(() => undefined),
    [priorityMutation],
  );
  const patchTask = useCallback(
    (patch: TaskPatch): void => {
      patchMutation.mutate(patch);
    },
    [patchMutation],
  );
  const addSubtask = useCallback(
    (title: string): Promise<void> => addSubtaskMutation.mutateAsync(title).then(() => undefined),
    [addSubtaskMutation],
  );
  const toggleSubtask = useCallback(
    (subtaskId: string, done: boolean): Promise<void> =>
      toggleSubtaskMutation.mutateAsync({ subtaskId, done }).then(() => undefined),
    [toggleSubtaskMutation],
  );
  const addComment = useCallback(
    (body: string): Promise<void> => commentMutation.mutateAsync(body).then(() => undefined),
    [commentMutation],
  );
  const deleteTask = useCallback(
    (options?: { onSuccess?: (() => void) | undefined }): void => {
      deleteMutation.mutate(
        undefined,
        options?.onSuccess ? { onSuccess: options.onSuccess } : undefined,
      );
    },
    [deleteMutation],
  );
  const resetDelete = useCallback((): void => {
    deleteMutation.reset();
  }, [deleteMutation]);

  const actionError = patchMutation.error
    ? userErrorMessage(patchMutation.error, 'Could not update this task.')
    : stateMutation.error
      ? userErrorMessage(stateMutation.error, 'Could not change the task state.')
      : priorityMutation.error
        ? userErrorMessage(priorityMutation.error, 'Could not change the task priority.')
        : addSubtaskMutation.error
          ? userErrorMessage(addSubtaskMutation.error, 'Could not add that subtask.')
          : toggleSubtaskMutation.error
            ? userErrorMessage(toggleSubtaskMutation.error, 'Could not update that subtask.')
            : commentMutation.error
              ? userErrorMessage(commentMutation.error, 'Could not post that comment.')
              : null;

  const deleteError = deleteMutation.error
    ? userErrorMessage(deleteMutation.error, 'Could not delete this task.')
    : null;

  return {
    setState,
    setPriority,
    patchTask,
    addSubtask,
    toggleSubtask,
    addComment,
    deleteTask,
    resetDelete,
    actionError,
    propsPending: patchMutation.isPending,
    statusPending: stateMutation.isPending,
    priorityPending: priorityMutation.isPending,
    deletePending: deleteMutation.isPending,
    deleteError,
  };
}
