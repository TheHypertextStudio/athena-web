'use client';

/** Optimistic, atomic task hierarchy writes shared by menus, lists, and the Task graph. */
import type { TaskReparentBatchOut } from '@docket/work/task-model';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/lib/api';
import { userErrorMessage } from '@/lib/problem';
import { queryKeys, unwrap, useApiMutation } from '@/lib/query';
import { useParentReopenOffer } from '@/lib/use-parent-reopen-offer';

/** One task-parent assignment. */
export interface TaskHierarchyMove {
  readonly taskId: string;
  readonly parentTaskId: string | null;
}

/** Input accepted by every task hierarchy gesture. */
export interface TaskHierarchyMutationInput {
  readonly organizationId: string;
  readonly moves: readonly TaskHierarchyMove[];
  readonly preserveSelectedSubtrees: boolean;
}

/** A transient reversal offered after a successful hierarchy change. */
export interface TaskHierarchyUndo {
  readonly label: string;
  readonly undo: () => void;
}

/** The shared task hierarchy mutation controller. */
export interface TaskHierarchyMutationController {
  readonly reparent: (input: TaskHierarchyMutationInput) => void;
  readonly isPending: boolean;
  readonly error: string | null;
  readonly clearError: () => void;
  readonly undo: TaskHierarchyUndo | null;
}

interface InternalVariables extends TaskHierarchyMutationInput {
  readonly offerUndo: boolean;
}

interface CacheSnapshot {
  readonly entries: readonly {
    readonly queryKey: readonly unknown[];
    readonly data: unknown;
  }[];
  readonly rollback: () => void;
}

const UNDO_WINDOW_MS = 6000;

/** The id of `record` when it is a task row this move reparents, else `null`. */
function movedTaskRowId(
  record: Record<string, unknown>,
  parents: ReadonlyMap<string, string | null>,
): string | null {
  const id = record['id'];
  return typeof id === 'string' && parents.has(id) && 'parentTaskId' in record ? id : null;
}

/**
 * Patch the parent field wherever a cached task graph or task row carries it.
 *
 * @remarks
 * Only a record that already has a `parentTaskId` field is a task row. Other records share a task's
 * id without being one — the task page's navigation snapshot is keyed by it — and their schemas
 * reject a field they do not declare, so adding one would break the page reading them.
 */
function patchHierarchyData(data: unknown, parents: ReadonlyMap<string, string | null>): unknown {
  if (data === null || typeof data !== 'object') return data;
  if (Array.isArray(data)) return data.map((item) => patchHierarchyData(item, parents));

  const record = data as Record<string, unknown>;
  let next: Record<string, unknown> = record;
  const id = movedTaskRowId(record, parents);
  if (id !== null) next = { ...next, parentTaskId: parents.get(id) ?? null };
  for (const [key, value] of Object.entries(next)) {
    if (key === 'edges') continue;
    const patched = patchHierarchyData(value, parents);
    if (patched !== value) {
      if (next === record) next = { ...record };
      next[key] = patched;
    }
  }
  return next;
}

/** Apply one compound optimistic patch across every task-list/detail and graph scope cache. */
function optimisticHierarchyPatch(
  queryClient: ReturnType<typeof useQueryClient>,
  organizationId: string,
  moves: readonly TaskHierarchyMove[],
): CacheSnapshot {
  const prefixes = [
    queryKeys.tasks(organizationId),
    ['org', organizationId, 'task-graph'],
  ] as const;
  const queries = prefixes.flatMap((queryKey) => queryClient.getQueryCache().findAll({ queryKey }));
  const seen = new Set<string>();
  const entries: { queryKey: readonly unknown[]; data: unknown }[] = [];
  const parents = new Map(moves.map(({ taskId, parentTaskId }) => [taskId, parentTaskId]));

  for (const query of queries) {
    const serialized = JSON.stringify(query.queryKey);
    if (seen.has(serialized)) continue;
    seen.add(serialized);
    const data = query.state.data;
    if (data === undefined) continue;
    entries.push({ queryKey: query.queryKey, data });
    queryClient.setQueryData(query.queryKey, patchHierarchyData(data, parents));
  }

  return {
    entries,
    rollback: () => {
      for (const entry of entries) queryClient.setQueryData(entry.queryKey, entry.data);
    },
  };
}

/** The parents a batch of moves files tasks under; a move to the top level has none. */
function landingParents(moves: readonly TaskHierarchyMove[]): string[] {
  return moves.flatMap(({ parentTaskId }) => (parentTaskId === null ? [] : [parentTaskId]));
}

/** Build the atomic hierarchy mutation and six-second Undo treatment. */
export function useTaskHierarchyMutation(): TaskHierarchyMutationController {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [undo, setUndo] = useState<TaskHierarchyUndo | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const offerReopen = useParentReopenOffer();

  const clearUndo = useCallback(() => {
    if (undoTimer.current !== null) clearTimeout(undoTimer.current);
    undoTimer.current = null;
    setUndo(null);
  }, []);

  useEffect(() => clearUndo, [clearUndo]);

  const mutation = useApiMutation<TaskReparentBatchOut, InternalVariables, CacheSnapshot>({
    mutationFn: ({ organizationId, moves, preserveSelectedSubtrees }) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].tasks.reparent.$post({
            param: { orgId: organizationId },
            json: { moves: [...moves], preserveSelectedSubtrees },
          }),
        'Could not change the task hierarchy.',
      ),
    onMutate: ({ organizationId, moves }) => {
      setError(null);
      return optimisticHierarchyPatch(queryClient, organizationId, moves);
    },
    onError: (caught, _variables, snapshot) => {
      snapshot?.rollback();
      setError(userErrorMessage(caught, 'Could not change the task hierarchy.'));
    },
    onSuccess: (result, variables) => {
      if (!variables.offerUndo || result.moves.length === 0) return;
      offerReopen(variables.organizationId, landingParents(variables.moves));
      clearUndo();
      const label = result.moves.length === 1 ? 'Task moved' : `${result.moves.length} tasks moved`;
      const previous = result.moves.map(({ taskId, previousParentTaskId }) => ({
        taskId,
        parentTaskId: previousParentTaskId,
      }));
      setUndo({
        label,
        undo: () => {
          clearUndo();
          mutation.mutate({
            organizationId: variables.organizationId,
            moves: previous,
            preserveSelectedSubtrees: false,
            offerUndo: false,
          });
        },
      });
      undoTimer.current = setTimeout(clearUndo, UNDO_WINDOW_MS);
    },
    onSettled: (_data, _error, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks(variables.organizationId) });
      void queryClient.invalidateQueries({
        queryKey: ['org', variables.organizationId, 'task-graph'],
      });
    },
  });
  const mutate = mutation.mutate;
  const reparent = useCallback(
    (input: TaskHierarchyMutationInput) => {
      mutate({ ...input, offerUndo: true });
    },
    [mutate],
  );

  return {
    reparent,
    isPending: mutation.isPending,
    error,
    clearError: useCallback(() => {
      setError(null);
    }, []),
    undo,
  };
}
