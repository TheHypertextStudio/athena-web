/**
 * Data hook for the task detail page — encapsulates all parallel queries.
 *
 * @remarks
 * Returns a stable snapshot of every data slice the task detail surface needs:
 * the rich task + its team's workflow states, the org rosters (projects, programs,
 * members, agents, milestones, cycles, roles), the task's comment stream, and the
 * activity from the most-recent agent session bound to the task.
 *
 * All queries run through {@link useApiQuery} so they auto-refetch on window focus
 * and after any mutation without manual refresh.
 */
import type {
  AgentOut,
  AgentSessionOut,
  CommentOut,
  CycleOut,
  MemberOut,
  MilestoneOut,
  ProgramOut,
  ProjectOut,
  RoleOut,
  SessionActivityOut,
  TaskDetail,
  WorkflowState,
} from '@docket/types';
import type { QueryKey } from '@tanstack/react-query';
import { useMemo } from 'react';

import { api } from './api';
import { STALE, apiQueryOptions, queryKeys, useApiQuery, useLiveApiQuery } from './query';

/** Focus-only poll interval (ms) for a task's bound agent-session activity stream. */
const TASK_ACTIVITY_POLL_MS = 4_000;

/** All data slices exposed by {@link useTaskDetail}. */
export interface TaskDetailData {
  task: TaskDetail | null;
  workflowStates: readonly WorkflowState[] | null;
  projects: readonly ProjectOut[];
  programs: readonly ProgramOut[];
  members: readonly MemberOut[];
  agents: readonly AgentOut[];
  milestones: readonly MilestoneOut[];
  cycles: readonly CycleOut[];
  roles: readonly RoleOut[];
  comments: readonly CommentOut[];
  activities: readonly SessionActivityOut[];
  taskSession: AgentSessionOut | null;
  /** The stable React Query key for the task detail — mutations invalidate against this. */
  detailKey: QueryKey;
  /** The stable React Query key for the comment stream. */
  commentsKey: QueryKey;
  isPending: boolean;
  isError: boolean;
  error: string | null;
}

/**
 * Parallel-fetch all data slices needed by the task detail page.
 *
 * @param orgId - The active organization id.
 * @param taskId - The task being viewed.
 * @returns All data slices + query-state flags.
 */
export function useTaskDetail(orgId: string, taskId: string): TaskDetailData {
  const detailKey = useMemo<QueryKey>(() => queryKeys.task(orgId, taskId), [orgId, taskId]);
  const commentsKey = useMemo<QueryKey>(() => [...detailKey, 'comments'], [detailKey]);

  const taskQ = useApiQuery(
    apiQueryOptions(
      detailKey,
      () => api.v1.orgs[':orgId'].tasks[':id'].$get({ param: { orgId, id: taskId } }),
      'Could not load this task.',
    ),
  );
  const task = taskQ.data ?? null;
  const teamId = task?.teamId ?? null;

  const teamQ = useApiQuery(
    apiQueryOptions(
      [...queryKeys.team(orgId, teamId ?? ''), 'workflow'],
      () => api.v1.orgs[':orgId'].teams[':teamId'].$get({ param: { orgId, teamId: teamId ?? '' } }),
      'Could not load the workflow.',
      { enabled: Boolean(teamId) },
    ),
  );

  const projectsQ = useApiQuery(
    apiQueryOptions(
      queryKeys.projects(orgId),
      () => api.v1.orgs[':orgId'].projects.$get({ param: { orgId } }),
      'Could not load projects.',
    ),
  );
  const programsQ = useApiQuery(
    apiQueryOptions(
      queryKeys.programs(orgId),
      () => api.v1.orgs[':orgId'].programs.$get({ param: { orgId } }),
      'Could not load programs.',
    ),
  );
  const membersQ = useApiQuery(
    apiQueryOptions(
      queryKeys.members(orgId),
      () => api.v1.orgs[':orgId'].members.$get({ param: { orgId } }),
      'Could not load members.',
    ),
  );
  const agentsQ = useApiQuery(
    apiQueryOptions(
      ['org', orgId, 'agents'],
      () => api.v1.orgs[':orgId'].agents.$get({ param: { orgId } }),
      'Could not load agents.',
    ),
  );
  const milestonesQ = useApiQuery(
    apiQueryOptions(
      ['org', orgId, 'milestones'],
      () => api.v1.orgs[':orgId'].milestones.$get({ param: { orgId }, query: {} }),
      'Could not load milestones.',
    ),
  );
  const cyclesQ = useApiQuery(
    apiQueryOptions(
      queryKeys.cycles(orgId),
      () => api.v1.orgs[':orgId'].cycles.$get({ param: { orgId } }),
      'Could not load cycles.',
    ),
  );
  const rolesQ = useApiQuery(
    apiQueryOptions(
      queryKeys.roles(orgId),
      () => api.v1.orgs[':orgId'].roles.$get({ param: { orgId } }),
      'Could not load roles.',
    ),
  );

  const commentsQ = useApiQuery(
    apiQueryOptions(
      commentsKey,
      () =>
        api.v1.orgs[':orgId'].comments.$get({
          param: { orgId },
          query: { subjectType: 'task', subjectId: taskId },
        }),
      'Could not load comments.',
    ),
  );

  const sessionQ = useApiQuery(
    apiQueryOptions(
      [...detailKey, 'session'],
      () => api.v1.orgs[':orgId'].sessions.$get({ param: { orgId }, query: {} }),
      'Could not load sessions.',
      { staleTime: STALE.volatile },
    ),
  );
  const taskSession = sessionQ.data?.items.find((s) => s.taskId === taskId) ?? null;

  // The bound session's activity stream polls on a short focus-only interval so an agent's progress
  // shows live; the poll is gated by `enabled` so idle tasks (no session) never fetch.
  const activityQ = useLiveApiQuery(
    apiQueryOptions(
      [...detailKey, 'activity', taskSession?.id ?? ''],
      () =>
        api.v1.orgs[':orgId'].sessions[':id'].activity.$get({
          param: { orgId, id: taskSession?.id ?? '' },
        }),
      'Could not load activity.',
      { enabled: Boolean(taskSession) },
    ),
    TASK_ACTIVITY_POLL_MS,
  );

  return {
    task,
    workflowStates: teamQ.data?.workflowStates ?? null,
    projects: projectsQ.data?.items ?? [],
    programs: programsQ.data?.items ?? [],
    members: membersQ.data?.items ?? [],
    agents: agentsQ.data?.items ?? [],
    milestones: milestonesQ.data?.items ?? [],
    cycles: cyclesQ.data?.items ?? [],
    roles: rolesQ.data?.items ?? [],
    comments: commentsQ.data?.items ?? [],
    activities: activityQ.data?.items ?? [],
    taskSession,
    detailKey,
    commentsKey,
    isPending: taskQ.isPending,
    isError: taskQ.isError,
    error: taskQ.isError ? taskQ.error.message : null,
  };
}
