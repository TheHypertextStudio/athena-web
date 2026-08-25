/**
 * Typed aggregate-detail query definitions for local-first entity routes.
 *
 * @remarks
 * A detail aggregate is the one critical reconciliation read after a locally seeded snapshot
 * paints. Its key is deliberately separate from the legacy detail keys while both transports
 * coexist, so the old multi-request payload cannot masquerade as the aggregate contract.
 */
import type {
  InitiativeDetailAggregate,
  ProgramDetailAggregate,
  ProjectDetailAggregate,
  TaskDetailAggregate,
} from '@docket/types';

import { api } from './api';
import { ApiRequestError, apiQueryOptions } from './query-core';
import { queryKeys } from './query-keys';

/** Aggregate content stays fresh for two minutes without retaining an inactive page indefinitely. */
const DETAIL_AGGREGATE_STALE_MS = 120_000;

/** The render source that may safely replace a detail route's primary document. */
export type AggregateLoadState = 'data' | 'loading' | 'error' | 'missing';

/** A server-confirmed detail failure that must evict cached entity data. */
export type TerminalDetailFailure = 'forbidden' | 'not-found';

/**
 * Classify server responses that prove a locally cached detail can no longer be shown.
 *
 * @param error - The failed aggregate request.
 * @returns The terminal failure, or null when a stale snapshot may remain visible.
 */
export function terminalDetailFailure(error: unknown): TerminalDetailFailure | null {
  if (!(error instanceof ApiRequestError)) return null;
  if (error.status === 403) return 'forbidden';
  if (error.status === 404) return 'not-found';
  return null;
}

/**
 * Decide which detail source stays visible while one aggregate request reconciles.
 *
 * Cached aggregate data always wins over a failed background refresh. A navigation snapshot can
 * name a destination, but it cannot render that destination's tabs or body. Only aggregate data
 * may render the entity document. Every unresolved route uses its layout-matched loading state.
 *
 * @param data - Cached aggregate data, if a successful read has occurred.
 * @param pending - Whether the first aggregate request is pending.
 * @param failed - Whether the most recent aggregate request failed.
 * @returns The only source the route may use for its primary content.
 */
export function aggregateLoadState(
  data: unknown,
  pending: boolean,
  failed: boolean,
): AggregateLoadState {
  if (data !== undefined) return 'data';
  if (pending) return 'loading';
  return failed ? 'error' : 'missing';
}

/** Read a Task's bounded initial detail content. */
export function taskDetailAggregateDef(orgId: string, taskId: string) {
  return apiQueryOptions<TaskDetailAggregate>(
    queryKeys.taskAggregate(orgId, taskId),
    () =>
      api.v1.orgs[':orgId'].tasks[':id']['aggregate-detail'].$get({
        param: { orgId, id: taskId },
      }),
    'Could not refresh this task.',
    { staleTime: DETAIL_AGGREGATE_STALE_MS },
  );
}

/** Read a Project's bounded initial detail content. */
export function projectDetailAggregateDef(orgId: string, projectId: string) {
  return apiQueryOptions<ProjectDetailAggregate>(
    queryKeys.projectAggregate(orgId, projectId),
    () =>
      api.v1.orgs[':orgId'].projects[':id']['aggregate-detail'].$get({
        param: { orgId, id: projectId },
      }),
    'Could not refresh this project.',
    { staleTime: DETAIL_AGGREGATE_STALE_MS },
  );
}

/** Read a Program's bounded initial detail content. */
export function programDetailAggregateDef(orgId: string, programId: string) {
  return apiQueryOptions<ProgramDetailAggregate>(
    queryKeys.programAggregate(orgId, programId),
    () =>
      api.v1.orgs[':orgId'].programs[':id']['aggregate-detail'].$get({
        param: { orgId, id: programId },
      }),
    'Could not refresh this program.',
    { staleTime: DETAIL_AGGREGATE_STALE_MS },
  );
}

/** Read an Initiative's bounded initial detail content. */
export function initiativeDetailAggregateDef(orgId: string, initiativeId: string) {
  return apiQueryOptions<InitiativeDetailAggregate>(
    queryKeys.initiativeAggregate(orgId, initiativeId),
    () =>
      api.v1.orgs[':orgId'].initiatives[':id']['aggregate-detail'].$get({
        param: { orgId, id: initiativeId },
      }),
    'Could not refresh this initiative.',
    { staleTime: DETAIL_AGGREGATE_STALE_MS },
  );
}
