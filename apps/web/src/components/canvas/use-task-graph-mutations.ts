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
import { dependencyEdgeId, type GraphOut, type TaskGraphEdge } from '@docket/types';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/lib/api';
import { userErrorMessage } from '@/lib/problem';
import { optimisticPatch, queryKeys, unwrap, useApiMutation } from '@/lib/query';

import { type TaskGraphScope, taskGraphScopeKey } from './scope';

/**
 * A completed edit the user can still take back, surfaced in the canvas's bottom-center strip.
 *
 * @remarks
 * Removing a dependency is a destructive edit reached by a single click on a small control, so it
 * needs a way back. A confirmation dialog would be the wrong shape here — this is a
 * direct-manipulation canvas, and a modal in the middle of it interrupts the gesture it is meant
 * to protect. Offering the reversal *after* the fact keeps the edit fast and still recoverable.
 */
export interface GraphUndo {
  /**
   * Application-owned label for what happened, in the past tense ("Dependency removed").
   *
   * @remarks
   * Deliberately not called `message`: this is copy this module writes, never a server or
   * exception string, and the source policy that keeps provider text out of the UI reads a
   * rendered `.message` as exactly that.
   */
  label: string;
  /** Put it back. */
  undo: () => void;
}

/** How long the undo offer stays on screen before it lapses. */
const UNDO_WINDOW_MS = 6000;

/** The edit operations + transient error, returned by {@link useTaskGraphMutations}. */
export interface TaskGraphMutations {
  /** Create a `blocking → blocked` dependency edge. */
  addDependency: (blockingTaskId: string, blockedTaskId: string) => void;
  /** Remove a dependency edge (direction-agnostic; pass its endpoints). */
  removeDependency: (sourceTaskId: string, targetTaskId: string) => void;
  /** Flip a dependency: drop `source → target` and add `target → source`. */
  reverseDependency: (sourceTaskId: string, targetTaskId: string) => void;
  /** Set a task's workflow state. */
  setState: (taskId: string, state: string) => void;
  /** Create a subtask under a parent, adding a child node + subtask edge. */
  createSubtask: (parentTaskId: string, title: string) => void;
  /** The last write error (cycle / duplicate / permission), or null. */
  error: string | null;
  /** Dismiss the current error. */
  clearError: () => void;
  /** The most recent reversible edit, or null once taken back or lapsed. */
  undo: GraphUndo | null;
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
  const [undo, setUndo] = useState<GraphUndo | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // One live offer at a time: a second removal replaces the first rather than stacking strips.
  const offerUndo = useCallback((next: GraphUndo) => {
    if (undoTimer.current !== null) clearTimeout(undoTimer.current);
    setUndo(next);
    undoTimer.current = setTimeout(() => {
      undoTimer.current = null;
      setUndo(null);
    }, UNDO_WINDOW_MS);
  }, []);

  const clearUndo = useCallback(() => {
    if (undoTimer.current !== null) clearTimeout(undoTimer.current);
    undoTimer.current = null;
    setUndo(null);
  }, []);

  useEffect(
    () => () => {
      if (undoTimer.current !== null) clearTimeout(undoTimer.current);
    },
    [],
  );

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
        const id = dependencyEdgeId(blockingTaskId, blockedTaskId);
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
      setError(userErrorMessage(err, 'Could not add the dependency.'));
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
      const id = dependencyEdgeId(sourceTaskId, targetTaskId);
      return optimisticPatch<GraphOut>(queryClient, scopeKey, (prev) => ({
        ...prev,
        edges: prev.edges.filter((e) => e.id !== id),
      }));
    },
    onError: (err, _vars, ctx) => {
      ctx?.rollback();
      setError(userErrorMessage(err, 'Could not remove the dependency.'));
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
      setError(userErrorMessage(err, 'Could not update the status.'));
    },
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.task(orgId, vars.taskId) });
    },
    invalidateKeys,
  });

  // Create-subtask has no optimistic patch (the server assigns the new id); invalidation reveals it.
  const createSubtaskMutation = useApiMutation<unknown, { parentTaskId: string; title: string }>({
    mutationFn: ({ parentTaskId, title }) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].tasks[':id'].subtasks.$post({
            param: { orgId, id: parentTaskId },
            json: { title },
          }),
        'Could not create the subtask.',
      ),
    onMutate: () => {
      setError(null);
    },
    onError: (err) => {
      setError(userErrorMessage(err, 'Could not create the subtask.'));
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
      offerUndo({
        label: 'Dependency removed',
        undo: () => {
          clearUndo();
          // The removed edge ran `source → target`, i.e. source was the blocker.
          addMutation.mutate({ blockingTaskId: sourceTaskId, blockedTaskId: targetTaskId });
        },
      });
    },
    [removeMutation, addMutation, offerUndo, clearUndo],
  );
  const reverseDependency = useCallback(
    (sourceTaskId: string, targetTaskId: string) => {
      removeMutation.mutate({ sourceTaskId, targetTaskId });
      addMutation.mutate({ blockingTaskId: targetTaskId, blockedTaskId: sourceTaskId });
      offerUndo({
        label: 'Dependency reversed',
        undo: () => {
          clearUndo();
          removeMutation.mutate({ sourceTaskId: targetTaskId, targetTaskId: sourceTaskId });
          addMutation.mutate({ blockingTaskId: sourceTaskId, blockedTaskId: targetTaskId });
        },
      });
    },
    [removeMutation, addMutation, offerUndo, clearUndo],
  );
  const setStateFn = useCallback(
    (taskId: string, state: string) => {
      stateMutation.mutate({ taskId, state });
    },
    [stateMutation],
  );
  const createSubtask = useCallback(
    (parentTaskId: string, title: string) => {
      createSubtaskMutation.mutate({ parentTaskId, title });
    },
    [createSubtaskMutation],
  );
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    addDependency,
    removeDependency,
    reverseDependency,
    setState: setStateFn,
    createSubtask,
    error,
    clearError,
    undo,
  };
}
