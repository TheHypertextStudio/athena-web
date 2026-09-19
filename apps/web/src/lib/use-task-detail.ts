/**
 * Data hook for the task detail page: the task aggregate and its derived reads.
 *
 * @remarks
 * Returns the rich task, its team's workflow states, the viewer's capabilities, and the
 * description's entity mentions. The pickers' organization rosters are read by
 * `useTaskRosters`, and the Activity feed reads its own pages.
 *
 * All queries run through {@link useApiQuery} so they auto-refetch on window focus
 * and after any mutation without manual refresh.
 */
import { type TaskDetail } from '@docket/work/task-model';
import { type TaskNavigationSnapshot } from './contracts/entity-navigation';
import { TaskSubjectRef } from '@docket/work/subject-ref-contract';
import { type WorkflowState } from '@docket/work/workflow';
import type { QueryKey } from '@tanstack/react-query';
import { useMemo } from 'react';

import type { QueryFailureSource } from '@/components/feedback';

import { api } from './api';
import {
  taskDetailAggregateDef,
  terminalDetailFailure,
  type TerminalDetailFailure,
} from './detail-aggregate';
import { useEntityMentions, type EntityMentionsData } from './use-entity-mentions';
import { STALE, apiQueryOptions, queryKeys, useApiQuery } from './query';

/**
 * Typed query definition for a task's primary detail read — shared by task-list row prefetch, tab
 * titles, and the breadcrumb's parent read, so each warms or reads one cache entry.
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
  /** Permissions resolved by the aggregate, without an organization-role roster. */
  capabilities: { comment: boolean; contribute: boolean; assign: boolean; manage: boolean } | null;
  /** The authenticated actor who edits this Task's document. */
  currentActorId: string | null;
  /** The bounded snapshot that replaces the local navigation snapshot after reconciliation. */
  snapshot: TaskNavigationSnapshot | null;
  /** A deletion or access-revocation result that must evict cached Task data. */
  terminalFailure: TerminalDetailFailure | null;
  /** Description references the current viewer can access. */
  entityMentions: EntityMentionsData;
  /** The stable React Query key for the task detail — mutations invalidate against this. */
  detailKey: QueryKey;
  /** The stable React Query key for the unified Activity history. */
  activityKey: QueryKey;
  isPending: boolean;
  /** The task read itself, for presenting its failure and retrying it. */
  taskQuery: TaskReadState;
}

/** The parts of the task read a surface needs to present its failure. */
export type TaskReadState = QueryFailureSource & { readonly isError: boolean };

/** Which of the task page's optional reads are switched on. */
export interface TaskDetailOptions {
  /** Whether the aggregate read runs; off once the task is known to be gone. Defaults to on. */
  aggregateEnabled?: boolean;
  /**
   * Whether the Resources tab is showing, which is when the description's derived references are
   * read. Left out, the references are read as soon as the task is.
   */
  resourcesOpen?: boolean;
}

/**
 * Read the task aggregate and the slices derived from it.
 *
 * @param orgId - The active organization id.
 * @param taskId - The task being viewed.
 * @param options - Which optional reads are switched on.
 * @returns The data slices + query-state flags.
 */
export function useTaskDetail(
  orgId: string,
  taskId: string,
  options: TaskDetailOptions = {},
): TaskDetailData {
  const subject = TaskSubjectRef.parse({ subjectType: 'task', subjectId: taskId });
  const detailKey = useMemo<QueryKey>(
    () => queryKeys.taskAggregate(orgId, taskId),
    [orgId, taskId],
  );
  const activityKey = useMemo<QueryKey>(
    () => queryKeys.taskActivity(orgId, taskId),
    [orgId, taskId],
  );
  const entityMentions = useEntityMentions(orgId, subject, options.resourcesOpen);

  const taskQ = useApiQuery({
    ...taskDetailAggregateDef(orgId, taskId),
    enabled: options.aggregateEnabled ?? true,
  });

  return {
    task: taskQ.data?.defaultView.task ?? null,
    workflowStates: taskQ.data?.references.workflowStates ?? null,
    capabilities: taskQ.data?.capabilities ?? null,
    currentActorId: taskQ.data?.viewer.actorId ?? null,
    snapshot: taskQ.data?.snapshot ?? null,
    terminalFailure: terminalDetailFailure(taskQ.error),
    entityMentions,
    detailKey,
    activityKey,
    isPending: taskQ.isPending,
    taskQuery: taskQ,
  };
}
