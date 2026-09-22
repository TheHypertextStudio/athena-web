'use client';

/**
 * Every relationship write the task page makes: blockers, blocked tasks, related tasks, subtasks
 * attached or detached, and the task's own parent.
 *
 * @remarks
 * Each write lands on screen before the server answers. Dependency and related-task writes patch
 * the task's detail cache here and roll it back on failure; hierarchy writes go through the shared
 * {@link useTaskHierarchyMutation}, whose optimistic patch and six-second Undo every other
 * hierarchy gesture already uses. That Undo is surfaced as a notice, so detaching the wrong
 * subtask is one click to reverse. Failures reach the person through the query layer's classified
 * notices, which branch on the Problem code (a dependency loop, a duplicate link) rather than on
 * one sentence per operation.
 */
import { notify } from '@docket/ui/components';
import { TaskId } from '@docket/work/ids';
import type { TaskDetail, TaskRef } from '@docket/work/task-model';
import { type QueryKey, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo } from 'react';

import { useTaskHierarchyMutation } from '@/components/tasks/use-task-hierarchy-mutation';

import { api } from './api';
import type { TaskDetailAggregate } from './contracts/detail-aggregate';
import { queryKeys, unwrap, useApiMutation } from './query';
import { patchTaskAggregate } from './use-task-mutations';

/** Which side of a dependency the other task takes. */
export type DependencyDirection = 'blockedBy' | 'blocking';

/** The relationship writes for one task. */
export interface TaskRelations {
  /** Link `other` as blocking this task (`blockedBy`) or blocked by it (`blocking`). */
  readonly addDependency: (direction: DependencyDirection, other: TaskRef) => void;
  /** Remove the dependency between this task and `otherId`, whichever side it is on. */
  readonly removeDependency: (otherId: string) => void;
  readonly addRelated: (other: TaskRef) => void;
  readonly removeRelated: (otherId: string) => void;
  /** Make an existing task a subtask of this one. */
  readonly attachSubtask: (child: TaskRef) => void;
  /** Move a subtask back to the top level. */
  readonly detachSubtask: (childId: string) => void;
  /** File this task under `parentTaskId`, or move it to the top level with `null`. */
  readonly setParent: (parentTaskId: string | null) => void;
  /** Whether any relationship write is in flight. */
  readonly pending: boolean;
}

/** The cache snapshot a failed write restores. */
interface Rollback {
  readonly previous?: TaskDetailAggregate | undefined;
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

/** Optimistic writes to the task's detail cache, and the way to take one back. */
interface DetailCache {
  readonly write: (apply: (task: TaskDetail) => TaskDetail) => Promise<Rollback>;
  readonly restore: (rollback: Rollback | undefined) => void;
  readonly read: () => TaskDetail | undefined;
}

/** Drop `id` from a relation list. */
function without(list: readonly TaskRef[], id: string): TaskRef[] {
  return list.filter((ref) => ref.id !== id);
}

/** Append `ref` to a relation list unless it is already there. */
function withRef(list: readonly TaskRef[], ref: TaskRef): TaskRef[] {
  return list.some((existing) => existing.id === ref.id) ? [...list] : [...list, ref];
}

/** Read and optimistically patch the task's detail cache entry. */
function useDetailCache(detailKey: QueryKey): DetailCache {
  const queryClient = useQueryClient();
  return useMemo(
    () => ({
      write: async (apply) => {
        await queryClient.cancelQueries({ queryKey: detailKey });
        const previous = queryClient.getQueryData<TaskDetailAggregate>(detailKey);
        queryClient.setQueryData<TaskDetailAggregate>(detailKey, (current) =>
          patchTaskAggregate(current, apply),
        );
        return { previous };
      },
      restore: (rollback) => {
        if (rollback?.previous) queryClient.setQueryData(detailKey, rollback.previous);
      },
      read: () => queryClient.getQueryData<TaskDetailAggregate>(detailKey)?.defaultView.task,
    }),
    [detailKey, queryClient],
  );
}

/** Add and remove dependency edges in either direction. */
function useDependencyWrites({ orgId, taskId, detailKey }: RelationTarget, cache: DetailCache) {
  const invalidateKeys = [detailKey, queryKeys.tasks(orgId)];
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
      cache.write((task) => ({ ...task, [direction]: withRef(task[direction], other) })),
    onError: (_error, _variables, rollback) => {
      cache.restore(rollback);
    },
    invalidateKeys,
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
      cache.write((task) => ({
        ...task,
        blockedBy: without(task.blockedBy, otherId),
        blocking: without(task.blocking, otherId),
      })),
    onError: (_error, _otherId, rollback) => {
      cache.restore(rollback);
    },
    invalidateKeys,
    failureTitle: 'Could not remove the dependency.',
  });
  return { add, remove };
}

/** Replace the task's related set, one task in or out at a time. */
function useRelatedWrites({ orgId, taskId, detailKey }: RelationTarget, cache: DetailCache) {
  return useApiMutation<unknown, readonly TaskRef[], Rollback>({
    mutationFn: (related) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].tasks[':id'].$patch({
            param: { orgId, id: taskId },
            json: { relatedTaskIds: related.map((ref) => TaskId.parse(ref.id)) },
          }),
        'Could not update the related tasks.',
      ),
    onMutate: (related) => cache.write((task) => ({ ...task, relatedTasks: [...related] })),
    onError: (_error, _related, rollback) => {
      cache.restore(rollback);
    },
    invalidateKeys: [detailKey, queryKeys.tasks(orgId)],
    failureTitle: 'Could not update the related tasks.',
  });
}

/** Move tasks in the hierarchy, offering each move's Undo as a notice. */
function useHierarchyWrites({ orgId, taskId }: RelationTarget) {
  const { reparent, undo, isPending } = useTaskHierarchyMutation();
  useEffect(() => {
    if (undo === null) return;
    notify({
      title: undo.label,
      action: { label: 'Undo', onSelect: undo.undo },
      dedupeKey: `task-hierarchy-undo:${taskId}`,
    });
  }, [taskId, undo]);
  const move = useCallback(
    (moved: string, parentTaskId: string | null): void => {
      reparent({
        organizationId: orgId,
        moves: [{ taskId: moved, parentTaskId }],
        preserveSelectedSubtrees: true,
      });
    },
    [orgId, reparent],
  );
  return { move, isPending };
}

/**
 * The relationship writes for the task on screen.
 *
 * @param orgId - The task's organization.
 * @param taskId - The task being edited.
 * @param detailKey - The task detail cache key, patched optimistically.
 * @returns the writes and their pending state.
 */
export function useTaskRelations(
  orgId: string,
  taskId: string,
  detailKey: QueryKey,
): TaskRelations {
  const target: RelationTarget = { orgId, taskId, detailKey };
  const cache = useDetailCache(detailKey);
  const dependencies = useDependencyWrites(target, cache);
  const related = useRelatedWrites(target, cache);
  const hierarchy = useHierarchyWrites(target);
  const { mutate: addDependency } = dependencies.add;
  const { mutate: removeDependency } = dependencies.remove;
  const { mutate: setRelated } = related;
  const { move } = hierarchy;

  return useMemo(
    () => ({
      addDependency: (direction, other) => {
        addDependency({ direction, other });
      },
      removeDependency: (otherId) => {
        removeDependency(otherId);
      },
      addRelated: (other) => {
        setRelated(withRef(cache.read()?.relatedTasks ?? [], other));
      },
      removeRelated: (otherId) => {
        setRelated(without(cache.read()?.relatedTasks ?? [], otherId));
      },
      attachSubtask: (child) => {
        void cache.write((task) => ({ ...task, subtasks: withRef(task.subtasks, child) }));
        move(child.id, taskId);
      },
      detachSubtask: (childId) => {
        void cache.write((task) => ({ ...task, subtasks: without(task.subtasks, childId) }));
        move(childId, null);
      },
      setParent: (parentTaskId) => {
        move(taskId, parentTaskId);
      },
      pending:
        dependencies.add.isPending ||
        dependencies.remove.isPending ||
        related.isPending ||
        hierarchy.isPending,
    }),
    [
      addDependency,
      cache,
      dependencies.add.isPending,
      dependencies.remove.isPending,
      hierarchy.isPending,
      move,
      related.isPending,
      removeDependency,
      setRelated,
      taskId,
    ],
  );
}
