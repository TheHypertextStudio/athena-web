'use client';

/**
 * `lib/use-set-task-estimate` — write task time estimates from any list.
 *
 * @remarks
 * A list row has no task-detail cache to patch, and the lists that show a task's estimate read it
 * under different keys: the Tasks roster and task lists (`['org', id, 'tasks']`, refreshed with the
 * roster projections and peer tabs by {@link invalidateWorkTargetQueries}), cycle pages, a
 * program's and a project's work, and Home. A save of one or many tasks refreshes those reads once,
 * after every write has settled. A rejected write reaches the person through the mutation's
 * classified failure notice.
 */
import type { TaskOut } from '@docket/work/task-model';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { api } from '@/lib/api';
import { queryKeys, unwrap, useApiMutation } from '@/lib/query';
import { invalidateWorkTargetQueries } from '@/lib/work-target-invalidation';

/** One task an estimate is written to. */
export interface TaskEstimateTarget {
  /** The workspace that owns the task. */
  readonly organizationId: string;
  /** The task to change. */
  readonly taskId: string;
}

/** What one estimate write needs. */
interface SetTaskEstimateVariables extends TaskEstimateTarget {
  /** The new estimate in minutes, or `null` to clear it. */
  readonly estimateMinutes: number | null;
}

/** Writes one estimate to every target. */
export type SetTaskEstimates = (
  targets: readonly TaskEstimateTarget[],
  estimateMinutes: number | null,
) => void;

/** Copy naming the operation when a failure carries nothing more specific. */
const FAILURE_TITLE = "The time estimate didn't save.";

/** Whether a query key is a program's or a project's work read under a workspace. */
function isWorkRead(key: readonly unknown[], organizationId: string): boolean {
  const [scope, orgId, collection] = key;
  return (
    scope === 'org' &&
    orgId === organizationId &&
    (collection === 'programs' || collection === 'projects') &&
    (key.at(-1) === 'tasks' || key.at(-1) === 'work')
  );
}

/** Refresh every read that shows a workspace's task estimates. */
function refreshEstimateReads(queryClient: QueryClient, organizationId: string): void {
  void invalidateWorkTargetQueries(queryClient, {
    target: 'task',
    ownerOrganizationId: organizationId,
  });
  void queryClient.invalidateQueries({ queryKey: queryKeys.cycles(organizationId) });
  void queryClient.invalidateQueries({ queryKey: ['me', 'today'] });
  void queryClient.invalidateQueries({
    predicate: (query) => isWorkRead(query.queryKey, organizationId),
  });
}

/**
 * Write task time estimates.
 *
 * @returns `setEstimates`, which saves one estimate to each target and then refreshes the lists
 *   that show them once.
 */
export function useSetTaskEstimate(): SetTaskEstimates {
  const queryClient = useQueryClient();
  const { mutateAsync } = useApiMutation<TaskOut, SetTaskEstimateVariables>({
    mutationFn: ({ organizationId, taskId, estimateMinutes }) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].tasks[':id'].$patch({
            param: { orgId: organizationId, id: taskId },
            json: { estimateMinutes },
          }),
        FAILURE_TITLE,
      ),
    failureTitle: FAILURE_TITLE,
  });
  return useCallback(
    (targets, estimateMinutes) => {
      const writes = targets.map((target) => mutateAsync({ ...target, estimateMinutes }));
      void Promise.allSettled(writes).then(() => {
        for (const organizationId of new Set(targets.map((target) => target.organizationId))) {
          refreshEstimateReads(queryClient, organizationId);
        }
      });
    },
    [mutateAsync, queryClient],
  );
}
