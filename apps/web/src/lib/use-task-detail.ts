/**
 * Data hook for the task detail page — encapsulates all parallel queries.
 *
 * @remarks
 * Returns a stable snapshot of every data slice the task detail surface needs:
 * the rich task + its team's workflow states, picker rosters loaded only when their
 * own editor opens, the task's comment stream, and the activity from the most-recent
 * agent session bound to the task.
 *
 * All queries run through {@link useApiQuery} so they auto-refetch on window focus
 * and after any mutation without manual refresh.
 */
import {
  type AgentOut,
  type AgentSessionOut,
  type CommentOut,
  type CycleOut,
  type MemberOut,
  type MilestoneOut,
  type ProgramOut,
  type ProjectOut,
  type SessionActivityOut,
  type TaskDetail,
  type TaskNavigationSnapshot,
  TaskSubjectRef,
  type WorkflowState,
} from '@docket/types';
import type { QueryKey } from '@tanstack/react-query';
import { useMemo } from 'react';

import { api } from './api';
import {
  taskDetailAggregateDef,
  terminalDetailFailure,
  type TerminalDetailFailure,
} from './detail-aggregate';
import { userErrorMessage } from './problem';
import { STALE, apiQueryOptions, queryKeys, useApiQuery, useLiveApiQuery } from './query';

/** Focus-only poll interval (ms) for a task's bound agent-session activity stream. */
const TASK_ACTIVITY_POLL_MS = 4_000;

/**
 * Typed query definition for a task's primary detail read — shared by {@link useTaskDetail} and
 * task-list row prefetch, so a hovered row warms the exact cache entry the detail opens from.
 */
export function taskDetailDef(orgId: string, taskId: string) {
  return apiQueryOptions(
    queryKeys.task(orgId, taskId),
    () => api.v1.orgs[':orgId'].tasks[':id'].$get({ param: { orgId, id: taskId } }),
    'Could not load this task.',
    { staleTime: STALE.volatile },
  );
}

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
  comments: readonly CommentOut[];
  activities: readonly SessionActivityOut[];
  taskSession: AgentSessionOut | null;
  /** Permissions resolved by the aggregate, without an organization-role roster. */
  capabilities: { comment: boolean; contribute: boolean; assign: boolean; manage: boolean } | null;
  /** The authenticated actor who edits this Task's document. */
  currentActorId: string | null;
  /** The bounded snapshot that replaces the local navigation snapshot after reconciliation. */
  snapshot: TaskNavigationSnapshot | null;
  /** A deletion or access-revocation result that must evict cached Task data. */
  terminalFailure: TerminalDetailFailure | null;
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
export function useTaskDetail(
  orgId: string,
  taskId: string,
  options: {
    aggregateEnabled?: boolean;
    activityOpen?: boolean;
    membersOpen?: boolean;
    projectsOpen?: boolean;
    programsOpen?: boolean;
    milestonesOpen?: boolean;
    cyclesOpen?: boolean;
  } = {},
): TaskDetailData {
  const subject = TaskSubjectRef.parse({ subjectType: 'task', subjectId: taskId });
  const detailKey = useMemo<QueryKey>(
    () => queryKeys.taskAggregate(orgId, taskId),
    [orgId, taskId],
  );
  const commentsKey = useMemo<QueryKey>(() => [...detailKey, 'comments'], [detailKey]);

  const taskQ = useApiQuery({
    ...taskDetailAggregateDef(orgId, taskId),
    enabled: options.aggregateEnabled ?? true,
  });
  const task = taskQ.data?.defaultView.task ?? null;
  // Picker rosters change rarely within a session, so an opened editor keeps its own static
  // result. The first detail paint never opens an organization roster by accident.
  const projectsQ = useApiQuery(
    apiQueryOptions(
      queryKeys.projects(orgId),
      () => api.v1.orgs[':orgId'].projects.$get({ param: { orgId }, query: {} }),
      'Could not load projects.',
      { enabled: options.projectsOpen ?? false, staleTime: STALE.static },
    ),
  );
  const programsQ = useApiQuery(
    apiQueryOptions(
      queryKeys.programs(orgId),
      () => api.v1.orgs[':orgId'].programs.$get({ param: { orgId }, query: {} }),
      'Could not load programs.',
      { enabled: options.programsOpen ?? false, staleTime: STALE.static },
    ),
  );
  const membersQ = useApiQuery(
    apiQueryOptions(
      queryKeys.members(orgId),
      () => api.v1.orgs[':orgId'].members.$get({ param: { orgId } }),
      'Could not load members.',
      { enabled: options.membersOpen ?? false, staleTime: STALE.static },
    ),
  );
  const agentsQ = useApiQuery(
    apiQueryOptions(
      ['org', orgId, 'agents'],
      () => api.v1.orgs[':orgId'].agents.$get({ param: { orgId } }),
      'Could not load agents.',
      { enabled: options.activityOpen ?? false, staleTime: STALE.static },
    ),
  );
  const milestonesQ = useApiQuery(
    apiQueryOptions(
      ['org', orgId, 'milestones'],
      () => api.v1.orgs[':orgId'].milestones.$get({ param: { orgId }, query: {} }),
      'Could not load milestones.',
      { enabled: options.milestonesOpen ?? false, staleTime: STALE.static },
    ),
  );
  const cyclesQ = useApiQuery(
    apiQueryOptions(
      queryKeys.cycles(orgId),
      () => api.v1.orgs[':orgId'].cycles.$get({ param: { orgId }, query: {} }),
      'Could not load cycles.',
      { enabled: options.cyclesOpen ?? false, staleTime: STALE.static },
    ),
  );
  const commentsQ = useApiQuery(
    apiQueryOptions(
      commentsKey,
      () =>
        api.v1.orgs[':orgId'].comments.$get({
          param: { orgId },
          query: subject,
        }),
      'Could not load comments.',
      { enabled: options.activityOpen ?? false },
    ),
  );

  const sessionQ = useApiQuery(
    apiQueryOptions(
      [...detailKey, 'session'],
      () => api.v1.orgs[':orgId'].sessions.$get({ param: { orgId }, query: {} }),
      'Could not load sessions.',
      { enabled: options.activityOpen ?? false, staleTime: STALE.volatile },
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
      { enabled: Boolean(options.activityOpen && taskSession) },
    ),
    TASK_ACTIVITY_POLL_MS,
  );

  return {
    task,
    workflowStates: taskQ.data?.references.workflowStates ?? null,
    projects: projectsQ.data?.items ?? [],
    programs: programsQ.data?.items ?? [],
    members: membersQ.data?.items ?? [],
    agents: agentsQ.data?.items ?? [],
    milestones: milestonesQ.data?.items ?? [],
    cycles: cyclesQ.data?.items ?? [],
    comments: commentsQ.data?.items ?? [],
    activities: activityQ.data?.items ?? [],
    taskSession,
    capabilities: taskQ.data?.capabilities ?? null,
    currentActorId: taskQ.data?.viewer.actorId ?? null,
    snapshot: taskQ.data?.snapshot ?? null,
    terminalFailure: terminalDetailFailure(taskQ.error),
    detailKey,
    commentsKey,
    isPending: taskQ.isPending,
    isError: taskQ.isError,
    error: taskQ.isError ? userErrorMessage(taskQ.error, 'Could not load this task.') : null,
  };
}
