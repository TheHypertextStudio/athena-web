'use client';

/**
 * Expanding a task's description from authorized context, and undoing it.
 *
 * @remarks
 * The state is shared by two places that are far apart on the page: the overflow menu starts an
 * expansion, and the strip under the description reports it and offers the one undo. So the page
 * holds it once and hands it to both. A failed request reaches the person as a notice, raised by
 * the mutation layer, so neither place renders failure text of its own.
 */
import type { TaskDetail } from '@docket/work/task-model';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { api } from '@/lib/api';
import { queryKeys, unwrap, useApiMutation } from '@/lib/query';

/** What the expansion controls and the undo strip read. */
export interface DescriptionExpansion {
  /** Whether an expansion or an undo is in flight. */
  readonly pending: boolean;
  /** The outcome of the last expansion or undo, or `null` when there is nothing to report. */
  readonly notice: string | null;
  /** The token that reverses the last expansion, or `null` when there is none to reverse. */
  readonly undoToken: string | null;
  /** Rewrite the description from authorized context. */
  readonly expand: () => void;
  /** Reverse the last expansion. */
  readonly undo: () => void;
}

/**
 * Hold the expansion state for one task.
 *
 * @param orgId - The workspace the task belongs to.
 * @param taskId - The task whose description is expanded.
 * @returns the state and the two actions.
 */
export function useDescriptionExpansion(orgId: string, taskId: string): DescriptionExpansion {
  const queryClient = useQueryClient();
  const [undoToken, setUndoToken] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const invalidateKeys = [
    queryKeys.task(orgId, taskId),
    queryKeys.tasks(orgId),
    queryKeys.taskActivity(orgId, taskId),
    queryKeys.entityMentions(orgId, 'task', taskId),
  ];
  const expandMutation = useApiMutation({
    mutationFn: () =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].tasks[':id'].expand.$post({
            param: { orgId, id: taskId },
            json: {},
          }),
        'Could not expand the description.',
      ),
    invalidateKeys,
  });
  const undoMutation = useApiMutation({
    mutationFn: (token: string) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].tasks[':id'].expand.undo.$post({
            param: { orgId, id: taskId },
            json: { undoToken: token },
          }),
        'Could not undo the expansion.',
      ),
    invalidateKeys,
  });

  return {
    pending: expandMutation.isPending || undoMutation.isPending,
    notice,
    undoToken,
    expand: () => {
      setNotice(null);
      expandMutation.mutate(undefined, {
        onSuccess: (result) => {
          queryClient.setQueryData<TaskDetail>(queryKeys.task(orgId, taskId), result.task);
          setUndoToken(result.undoToken);
          setNotice(result.undoToken ? 'Description expanded.' : 'No changes needed.');
        },
      });
    },
    undo: () => {
      if (undoToken === null) return;
      setNotice(null);
      undoMutation.mutate(undoToken, {
        onSuccess: (result) => {
          queryClient.setQueryData<TaskDetail>(queryKeys.task(orgId, taskId), result.task);
          setUndoToken(null);
          setNotice('Expansion undone.');
        },
      });
    },
  };
}
