'use client';

/**
 * Focused task data shared by the rail companion and immersive Focus mode.
 *
 * @remarks
 * Focus needs only the task itself and the owning team's workflow. Keeping this boundary smaller
 * than the full task-detail hook avoids loading rosters, comments, sessions, and activity into a
 * surface whose job is to protect attention.
 */
import type { TaskDetail, WorkflowState } from '@docket/types';

import { api } from '@/lib/api';
import { userErrorMessage } from '@/lib/problem';
import { apiQueryOptions, queryKeys, STALE, useApiQuery } from '@/lib/query';
import { taskDetailDef } from '@/lib/use-task-detail';

/** The small task snapshot Focus is allowed to render. */
export interface FocusTaskData {
  readonly task: TaskDetail | null;
  readonly workflowState: WorkflowState | null;
  readonly workflowStates: readonly WorkflowState[];
  readonly isPending: boolean;
  readonly error: string | null;
}

/**
 * Read the active timer's anchored task and workflow label.
 *
 * @param organizationId - The task's owning workspace, or null for an unanchored session.
 * @param taskId - The anchored task, or null for an unanchored session.
 * @returns Focus-sized task context with loading and safe error state.
 */
export function useFocusTask(organizationId: string | null, taskId: string | null): FocusTaskData {
  const enabled = Boolean(organizationId && taskId);
  const taskQ = useApiQuery({
    ...taskDetailDef(organizationId ?? '', taskId ?? ''),
    enabled,
  });
  const task = taskQ.data ?? null;
  const teamId = task?.teamId ?? null;
  const teamQ = useApiQuery(
    apiQueryOptions(
      [...queryKeys.team(organizationId ?? '', teamId ?? ''), 'workflow'],
      () =>
        api.v1.orgs[':orgId'].teams[':teamId'].$get({
          param: { orgId: organizationId ?? '', teamId: teamId ?? '' },
        }),
      'Could not load the workflow.',
      { enabled: Boolean(organizationId && teamId), staleTime: STALE.static },
    ),
  );

  return {
    task,
    workflowState: teamQ.data?.workflowStates.find((state) => state.key === task?.state) ?? null,
    workflowStates: teamQ.data?.workflowStates ?? [],
    isPending: enabled && (taskQ.isPending || (Boolean(teamId) && teamQ.isPending)),
    error: taskQ.isError
      ? userErrorMessage(taskQ.error, 'Could not load task details.')
      : teamQ.isError
        ? userErrorMessage(teamQ.error, 'Could not load the workflow.')
        : null,
  };
}
