'use client';

/**
 * Offer to reopen a finished parent once open work lands under it.
 *
 * @remarks
 * Adding a subtask, attaching an existing task, or nesting one by drag can put open work under a
 * task that is already done or canceled. When the workspace completed that parent itself (its
 * "complete parents from their subtasks" setting), the server reopens it in the same write. A
 * parent a person closed stays closed, because that was a deliberate choice: this hook reads the
 * parent again after the write and, when it is still closed with open subtasks, shows a notice
 * naming it with a Reopen action. Reopening moves it to the team's first in-progress status, or to
 * where new work starts when the team has none.
 */
import { notify } from '@docket/ui/components';
import { isTerminalCategory } from '@docket/work/work-status-contract';
import type { TaskDetail } from '@docket/work/task-model';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { useStatusRegistry } from '@/components/statuses/status-registry';

import { api } from './api';
import { queryKeys, unwrap, useApiMutation } from './query';
import { taskDetailDef } from './use-task-detail';

/** What a reopen writes: the parent, and the status it moves to. */
interface ReopenVariables {
  readonly orgId: string;
  readonly taskId: string;
  readonly state: string;
}

/**
 * Check parents after a write that may have put open work under them.
 *
 * @returns `offer(orgId, parentIds)`: reads each parent and offers Reopen for any that is still
 *   closed with an open subtask. Stable across renders.
 */
export function useParentReopenOffer(): (orgId: string, parentIds: readonly string[]) => void {
  const queryClient = useQueryClient();
  const statuses = useStatusRegistry();
  const { mutate: reopen } = useApiMutation<unknown, ReopenVariables>({
    mutationFn: ({ orgId, taskId, state }) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].tasks[':id'].state.$post({
            param: { orgId, id: taskId },
            json: { state },
          }),
        'Could not reopen the task.',
      ),
    failureTitle: 'Could not reopen the task.',
    onSuccess: (_result, { orgId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks(orgId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.taskGraphs(orgId) });
    },
  });

  const closedWithOpenWork = useCallback(
    (parent: TaskDetail): 'done' | 'canceled' | null => {
      const category = statuses.categoryOf('task', parent.state, parent.teamId);
      if (!isTerminalCategory(category)) return null;
      const open = parent.subtasks.some(
        (subtask) => !isTerminalCategory(statuses.categoryOf('task', subtask.state, parent.teamId)),
      );
      if (!open) return null;
      return category === 'canceled' ? 'canceled' : 'done';
    },
    [statuses],
  );

  return useCallback(
    (orgId, parentIds) => {
      for (const parentId of new Set(parentIds)) {
        void queryClient
          .fetchQuery({ ...taskDetailDef(orgId, parentId), staleTime: 0 })
          .then((parent) => {
            const closed = closedWithOpenWork(parent);
            if (closed === null) return;
            const target =
              statuses.firstOfCategory('task', 'started', parent.teamId) ??
              statuses.defaultOf('task', parent.teamId);
            if (!target) return;
            notify({
              title: `“${parent.title}” is ${closed}`,
              action: {
                label: 'Reopen',
                onSelect: () => {
                  reopen({ orgId, taskId: parent.id, state: target.key });
                },
              },
              dedupeKey: `parent-reopen:${parent.id}`,
            });
          })
          // A parent that cannot be read (removed, or no longer visible) has nothing to offer.
          .catch(() => undefined);
      }
    },
    [closedWithOpenWork, queryClient, reopen, statuses],
  );
}
