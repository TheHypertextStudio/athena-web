'use client';

/** Task creation retained outside the canvas undo and redo history. */
import { useCallback, useState } from 'react';

import { api } from '@/lib/api';
import { userErrorMessage } from '@/lib/problem';
import { queryKeys, unwrap, useApiMutation } from '@/lib/query';

import { type TaskGraphScope } from './scope';

/** Task creation controls and application-owned error feedback. */
export interface TaskGraphCreation {
  /** Create a subtask under a parent and refresh every graph scope. */
  readonly createSubtask: (parentTaskId: string, title: string) => void;
  /** Current application-owned creation error. */
  readonly error: string | null;
  /** Dismiss the current error. */
  readonly clearError: () => void;
}

/**
 * Bind Task creation to the graph while leaving edits to object-command history.
 *
 * @param scope - Current graph scope and owning workspace.
 * @returns Subtask creation and its local failure state.
 */
export function useTaskGraphCreation(scope: TaskGraphScope): TaskGraphCreation {
  const { orgId } = scope;
  const [error, setError] = useState<string | null>(null);
  const mutation = useApiMutation<unknown, { parentTaskId: string; title: string }>({
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
    onError: (cause) => {
      setError(userErrorMessage(cause, 'Could not create the subtask.'));
    },
    invalidateKeys: [['org', orgId, 'task-graph'], queryKeys.tasks(orgId)],
  });
  const createSubtask = useCallback(
    (parentTaskId: string, title: string): void => {
      mutation.mutate({ parentTaskId, title });
    },
    [mutation],
  );
  const clearError = useCallback((): void => {
    setError(null);
  }, []);
  return { createSubtask, error, clearError };
}
