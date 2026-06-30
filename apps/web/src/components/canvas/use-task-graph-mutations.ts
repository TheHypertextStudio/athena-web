'use client';

/**
 * `components/canvas/use-task-graph-mutations` — live edits to the dependency graph.
 *
 * @remarks
 * Wraps the existing (read-only-until-now) dependency + state endpoints in optimistic mutations so
 * the canvas can be edited in place: drag to add a `blocks` edge, delete an edge, change a task's
 * state. Each write optimistically patches the *current scope's* `taskGraph` cache (so the canvas
 * reacts instantly) and invalidates the coarse `['org', orgId, 'task-graph']` key plus the edited
 * task's detail key, so every embed and the task page reconcile with the server. Server rejections
 * (cycle/duplicate/self) roll the optimistic patch back and surface a readable `error`.
 */
import type { GraphOut, TaskGraphEdge } from '@docket/types';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import { api } from '@/lib/api';
import { optimisticPatch, queryKeys, unwrap, useApiMutation } from '@/lib/query';

import { type TaskGraphScope, taskGraphScopeKey } from './scope';

/** The edit operations + transient error, returned by {@link useTaskGraphMutations}. */
export interface TaskGraphMutations {
  /** Create a `blocking → blocked` dependency edge. */
  addDependency: (blockingTaskId: string, blockedTaskId: string) => void;
  /** Remove a dependency edge (direction-agnostic; pass its endpoints). */
  removeDependency: (sourceTaskId: string, targetTaskId: string) => void;
  /** Set a task's workflow state. */
  setState: (taskId: string, state: string) => void;
  /** The last write error (cycle / duplicate / permission), or null. */
  error: string | null;
  /** Dismiss the current error. */
  clearError: () => void;
}

/** Coarse key that invalidates every scope variant of the graph at once. */
function coarseGraphKey(orgId: string): readonly string[] {
  return ['org', orgId, 'task-graph'];
}

/**
 * Build optimistic, cache-reconciling mutations for the dependency graph at `scope`.
 *
 * @param scope - The scope whose cache entry to patch optimistically.
 * @returns the {@link TaskGraphMutations}.
 */
export function useTaskGraphMutations(scope: TaskGraphScope): TaskGraphMutations {
  const { orgId } = scope;
  const queryClient = useQueryClient();
  const scopeKey = queryKeys.taskGraph(orgId, taskGraphScopeKey(scope));
  const [error, setError] = useState<string | null>(null);

  const invalidateKeys = [coarseGraphKey(orgId)] as const;

  const addMutation = useApiMutation<
    unknown,
    { blockingTaskId: string; blockedTaskId: string },
    { rollback: () => void }
  >({
    mutationFn: ({ blockingTaskId, blockedTaskId }) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].tasks[':id'].dependencies.$post({
            param: { orgId, id: blockedTaskId },
            json: { blockingTaskId },
          }),
        'Could not add the dependency.',
      ),
    onMutate: ({ blockingTaskId, blockedTaskId }) => {
      setError(null);
      return optimisticPatch<GraphOut>(queryClient, scopeKey, (prev) => {
        const id = `dep:${blockingTaskId}:${blockedTaskId}`;
        if (prev.edges.some((e) => e.id === id)) return prev;
        const edge: TaskGraphEdge = {
          id,
          source: blockingTaskId,
          target: blockedTaskId,
          kind: 'dependency',
        } as TaskGraphEdge;
        return { ...prev, edges: [...prev.edges, edge] };
      });
    },
    onError: (err, _vars, ctx) => {
      ctx?.rollback();
      setError(err.message || 'Could not add the dependency.');
    },
    invalidateKeys,
  });

  const removeMutation = useApiMutation<
    unknown,
    { sourceTaskId: string; targetTaskId: string },
    { rollback: () => void }
  >({
    mutationFn: ({ sourceTaskId, targetTaskId }) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].tasks[':id'].dependencies[':depId'].$delete({
            param: { orgId, id: sourceTaskId, depId: targetTaskId },
          }),
        'Could not remove the dependency.',
      ),
    onMutate: ({ sourceTaskId, targetTaskId }) => {
      setError(null);
      const id = `dep:${sourceTaskId}:${targetTaskId}`;
      return optimisticPatch<GraphOut>(queryClient, scopeKey, (prev) => ({
        ...prev,
        edges: prev.edges.filter((e) => e.id !== id),
      }));
    },
    onError: (err, _vars, ctx) => {
      ctx?.rollback();
      setError(err.message || 'Could not remove the dependency.');
    },
    invalidateKeys,
  });

  const stateMutation = useApiMutation<
    unknown,
    { taskId: string; state: string },
    { rollback: () => void }
  >({
    mutationFn: ({ taskId, state }) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].tasks[':id'].state.$post({
            param: { orgId, id: taskId },
            json: { state },
          }),
        'Could not update the status.',
      ),
    onMutate: ({ taskId, state }) => {
      setError(null);
      return optimisticPatch<GraphOut>(queryClient, scopeKey, (prev) => ({
        ...prev,
        nodes: prev.nodes.map((n) => (n.id === taskId ? { ...n, state } : n)),
      }));
    },
    onError: (err, vars, ctx) => {
      ctx?.rollback();
      setError(err.message || 'Could not update the status.');
    },
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.task(orgId, vars.taskId) });
    },
    invalidateKeys,
  });

  const addDependency = useCallback(
    (blockingTaskId: string, blockedTaskId: string) => {
      addMutation.mutate({ blockingTaskId, blockedTaskId });
    },
    [addMutation],
  );
  const removeDependency = useCallback(
    (sourceTaskId: string, targetTaskId: string) => {
      removeMutation.mutate({ sourceTaskId, targetTaskId });
    },
    [removeMutation],
  );
  const setStateFn = useCallback(
    (taskId: string, state: string) => {
      stateMutation.mutate({ taskId, state });
    },
    [stateMutation],
  );
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    addDependency,
    removeDependency,
    setState: setStateFn,
    error,
    clearError,
  };
}
