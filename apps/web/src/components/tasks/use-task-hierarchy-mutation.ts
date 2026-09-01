'use client';

/** Optimistic, atomic task hierarchy writes shared by menus, lists, and the Task graph. */
import type { TaskReparentBatchOut } from '@docket/work/task-model';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/lib/api';
import { userErrorMessage } from '@/lib/problem';
import { queryKeys, unwrap, useApiMutation } from '@/lib/query';

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

/** Patch the parent field wherever a cached task graph or task row carries it. */
function patchHierarchyData(data: unknown, parents: ReadonlyMap<string, string | null>): unknown {
  if (data === null || typeof data !== 'object') return data;
  if (Array.isArray(data)) return data.map((item) => patchHierarchyData(item, parents));

  const record = data as Record<string, unknown>;
  let next: Record<string, unknown> = record;
  const id = typeof record['id'] === 'string' ? record['id'] : null;
  if (id !== null && parents.has(id)) {
    next = { ...next, parentTaskId: parents.get(id) ?? null };
  }
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

/** Build the atomic hierarchy mutation and six-second Undo treatment. */
export function useTaskHierarchyMutation(): TaskHierarchyMutationController {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [undo, setUndo] = useState<TaskHierarchyUndo | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
