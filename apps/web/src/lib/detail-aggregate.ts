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
import { apiQueryOptions, queryKeys } from './query';

/** Aggregate content stays fresh for two minutes without retaining an inactive page indefinitely. */
const DETAIL_AGGREGATE_STALE_MS = 120_000;

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
