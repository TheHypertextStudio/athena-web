'use client';

/**
 * Every relationship write the task page makes: blockers, blocked tasks, related tasks, subtasks
 * attached or detached, and the task's own parent.
 *
 * @remarks
 * Each write lands on screen before the server answers. Dependency and related-task writes patch
 * the task's detail cache with {@link optimisticPatch} and roll it back on failure; hierarchy
 * writes go through the shared {@link useTaskHierarchyMutation}, whose optimistic patch and
 * six-second Undo every other hierarchy gesture already uses. That Undo is surfaced as a notice, so
 * detaching the wrong subtask is one click to reverse. Failures reach the person through the query
 * layer's classified notices, which branch on the Problem code (a dependency loop, a duplicate
 * link) rather than on one sentence per operation.
 */
import { notify } from '@docket/ui/components';
import { TaskId } from '@docket/work/ids';
import type { TaskDetail, TaskRef } from '@docket/work/task-model';
import { type QueryKey, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo } from 'react';

import { useTaskHierarchyMutation } from '@/components/tasks/use-task-hierarchy-mutation';

import { api } from './api';
import type { TaskDetailAggregate } from './contracts/detail-aggregate';
import { optimisticPatch, queryKeys, unwrap, useApiMutation } from './query';
import { withoutRef, withRef } from './task-refs';
import { useRenameTask } from './use-rename-task';
import { patchTaskAggregate } from './use-task-mutations';

/** Which side of a dependency the other task takes. */
type DependencyDirection = 'blockedBy' | 'blocking';

/**
 * How another task can be linked to this one.
 *
 * - `blockedBy`: the other task blocks this one.
 * - `blocking`: this task blocks the other one.
 * - `related`: linked without direction.
 * - `subtask`: the other task is filed under this one.
 * - `parent`: this task is filed under the other one.
 */
export type TaskLink = DependencyDirection | 'related' | 'subtask' | 'parent';

/** The relationship writes for one task. */
export interface TaskRelationWrites {
  /** Link `other` to this task as `kind`. */
  readonly link: (kind: TaskLink, other: TaskRef) => void;
  /** Remove the `kind` link to `otherId`. The other task itself is never changed otherwise. */
  readonly unlink: (kind: TaskLink, otherId: string) => void;
  /** Rename a linked task in place, then re-read this task so the new title shows. */
  readonly rename: (taskId: string, title: string) => void;
}

/** A failed write's way back to the cache as it was. */
interface Rollback {
  readonly rollback: () => void;
}

/** What a dependency write carries. */
interface DependencyVariables {
  readonly direction: DependencyDirection;
  readonly other: TaskRef;
}

/** Where a relation hook writes: the task, and the cache entry the page reads it from. */
interface RelationTarget {
  readonly orgId: string;
  readonly taskId: string;
  readonly detailKey: QueryKey;
}

/** Optimistically patch the task inside its detail cache entry. */
function useDetailPatch(
  detailKey: QueryKey,
): (apply: (task: TaskDetail) => TaskDetail) => Rollback {
  const queryClient = useQueryClient();
  return useCallback(
    (apply) =>
      optimisticPatch<TaskDetailAggregate | undefined>(queryClient, detailKey, (current) =>
        patchTaskAggregate(current, apply),
      ),
    [detailKey, queryClient],
  );
}

/** The keys a relationship write refreshes: every task read, and every dependency graph. */
function relationKeys(orgId: string): QueryKey[] {
  return [queryKeys.tasks(orgId), queryKeys.taskGraphs(orgId)];
}

/** Add and remove dependency edges in either direction. */
function useDependencyWrites({ orgId, taskId, detailKey }: RelationTarget) {
  const patch = useDetailPatch(detailKey);
  const add = useApiMutation<unknown, DependencyVariables, Rollback>({
    mutationFn: ({ direction, other }) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].tasks[':id'].dependencies.$post({
            param: { orgId, id: taskId },
            json:
              direction === 'blockedBy'
                ? { blockingTaskId: TaskId.parse(other.id) }
                : { blockedTaskId: TaskId.parse(other.id) },
          }),
        'Could not add the dependency.',
      ),
    onMutate: ({ direction, other }) =>
      patch((task) => ({ ...task, [direction]: withRef(task[direction], other) })),
    onError: (_error, _variables, context) => context?.rollback(),
    invalidateKeys: relationKeys(orgId),
    failureTitle: 'Could not add the dependency.',
  });
  const remove = useApiMutation<unknown, string, Rollback>({
    mutationFn: (otherId) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].tasks[':id'].dependencies[':depId'].$delete({
            param: { orgId, id: taskId, depId: otherId },
          }),
        'Could not remove the dependency.',
      ),
    onMutate: (otherId) =>
      patch((task) => ({
        ...task,
        blockedBy: withoutRef(task.blockedBy, otherId),
        blocking: withoutRef(task.blocking, otherId),
      })),
    onError: (_error, _otherId, context) => context?.rollback(),
    invalidateKeys: relationKeys(orgId),
    failureTitle: 'Could not remove the dependency.',
  });
  return { add: add.mutate, remove: remove.mutate };
}

/** Add or remove one related task; the whole related set is sent. */
function useRelatedWrites({ orgId, taskId, detailKey }: RelationTarget) {
  const queryClient = useQueryClient();
  const patch = useDetailPatch(detailKey);
  const { mutate } = useApiMutation<unknown, readonly TaskRef[], Rollback>({
    mutationFn: (related) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].tasks[':id'].$patch({
            param: { orgId, id: taskId },
            json: { relatedTaskIds: related.map((ref) => TaskId.parse(ref.id)) },
          }),
        'Could not update the related tasks.',
      ),
    onMutate: (related) => patch((task) => ({ ...task, relatedTasks: [...related] })),
    onError: (_error, _related, context) => context?.rollback(),
    invalidateKeys: relationKeys(orgId),
    failureTitle: 'Could not update the related tasks.',
  });
  return useCallback(
    (edit: (related: readonly TaskRef[]) => TaskRef[]): void => {
      const cached = queryClient.getQueryData<TaskDetailAggregate>(detailKey);
      mutate(edit(cached?.defaultView.task.relatedTasks ?? []));
    },
    [detailKey, mutate, queryClient],
  );
}

/** Move tasks in the hierarchy, offering each move's Undo as a notice. */
function useHierarchyWrites({ orgId, taskId }: RelationTarget) {
  const { reparent, undo } = useTaskHierarchyMutation();
  useEffect(() => {
    if (undo === null) return;
    notify({
      title: undo.label,
      action: { label: 'Undo', onSelect: undo.undo },
      dedupeKey: `task-hierarchy-undo:${taskId}`,
    });
  }, [taskId, undo]);
  return useCallback(
    (moved: string, parentTaskId: string | null): void => {
      reparent({
        organizationId: orgId,
        moves: [{ taskId: moved, parentTaskId }],
        preserveSelectedSubtrees: true,
      });
    },
    [orgId, reparent],
  );
}

/**
 * The relationship writes for the task on screen.
 *
 * @param orgId - The task's organization.
 * @param taskId - The task being edited.
 * @param detailKey - The task detail cache key, patched optimistically.
 * @returns `link`, `unlink`, and `rename`, stable across renders.
 */
export function useTaskRelations(
  orgId: string,
  taskId: string,
  detailKey: QueryKey,
): TaskRelationWrites {
  const target: RelationTarget = { orgId, taskId, detailKey };
  const dependency = useDependencyWrites(target);
  const editRelated = useRelatedWrites(target);
  const move = useHierarchyWrites(target);
  const patch = useDetailPatch(detailKey);
  const rename = useRenameTask(orgId, [detailKey]);

  return useMemo<TaskRelationWrites>(
    () => ({
      link: (kind, other) => {
        switch (kind) {
          case 'blockedBy':
          case 'blocking':
            dependency.add({ direction: kind, other });
            return;
          case 'related':
            editRelated((related) => withRef(related, other));
            return;
          case 'subtask':
            patch((task) => ({ ...task, subtasks: withRef(task.subtasks, other) }));
            move(other.id, taskId);
            return;
          case 'parent':
            move(taskId, other.id);
        }
      },
      unlink: (kind, otherId) => {
        switch (kind) {
          case 'blockedBy':
          case 'blocking':
            dependency.remove(otherId);
            return;
          case 'related':
            editRelated((related) => withoutRef(related, otherId));
            return;
          case 'subtask':
            patch((task) => ({ ...task, subtasks: withoutRef(task.subtasks, otherId) }));
            move(otherId, null);
            return;
          case 'parent':
            move(taskId, null);
        }
      },
      rename,
    }),
    [dependency.add, dependency.remove, editRelated, move, patch, rename, taskId],
  );
}
