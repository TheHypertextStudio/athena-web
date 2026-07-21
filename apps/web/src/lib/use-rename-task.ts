'use client';

/**
 * `useRenameTask` — a small seam for renaming any task from a list surface.
 *
 * @remarks
 * Detail pages patch their own task through {@link useTaskMutations}; list rows instead need to
 * rename an arbitrary task by id and refresh whatever list they belong to. This wraps the same
 * `tasks/:id` PATCH (title only) and invalidates the caller's list keys on settle, so every task
 * list can wire inline rename with one line. The server enforces `contribute`; the caller gates the
 * affordance with its own capability check.
 */
import type { QueryKey } from '@tanstack/react-query';
import type { TaskOut } from '@docket/types';

import { api } from '@/lib/api';
import { unwrap, useApiMutation } from '@/lib/query';

/**
 * A rename callback for tasks in a list.
 *
 * @param orgId - The active org id.
 * @param invalidateKeys - The list query keys to refetch after a rename settles.
 * @returns `(taskId, title) => void` — renames the task and reconciles the caller's lists.
 */
export function useRenameTask(
  orgId: string,
  invalidateKeys: readonly QueryKey[],
): (taskId: string, title: string) => void {
  const mutation = useApiMutation<TaskOut, { taskId: string; title: string }>({
    mutationFn: ({ taskId, title }) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].tasks[':id'].$patch({
            param: { orgId, id: taskId },
            json: { title },
          }),
        'Could not rename the task.',
      ),
    invalidateKeys,
  });
  return (taskId: string, title: string): void => {
    mutation.mutate({ taskId, title });
  };
}
