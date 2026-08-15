/**
 * Reads and writes for a workspace's status sets.
 *
 * @remarks
 * Modelled on the label queries next door, for the same reason: a status is vocabulary the whole
 * workspace reads, so a write to one changes how rows nobody edited render. The invalidation set
 * reflects that rather than only refreshing the status read.
 */
import type {
  WorkStatusCreate,
  WorkStatusEntityType,
  WorkStatusReorder,
  WorkStatusUpdate,
} from '@docket/types';

import { api } from '@/lib/api';
import { apiQueryOptions, queryKeys, STALE, unwrap, useApiMutation } from '@/lib/query';

/**
 * Every status set in the workspace, resolved for a team when one is given.
 *
 * @remarks
 * `STALE.static` because a status set is vocabulary: it changes on a settings edit and nowhere
 * else, and every write here invalidates it explicitly. That also means it survives into the
 * persisted cache, so a cold offline start still renders real status names.
 *
 * @param orgId - The workspace.
 * @param teamId - The team whose task statuses to resolve, when one is in scope.
 * @returns query options for the workspace's status sets.
 */
export function statusSetsDef(orgId: string, teamId?: string) {
  return apiQueryOptions(
    queryKeys.statusSets(orgId, teamId),
    () =>
      api.v1.orgs[':orgId'].statuses.$get({
        param: { orgId },
        query: teamId === undefined ? {} : { teamId },
      }),
    'Could not load your statuses.',
    { enabled: orgId !== '', staleTime: STALE.static },
  );
}

/**
 * Everything a status write can change.
 *
 * @remarks
 * Renaming or recategorizing a status changes how every task, project, program, and initiative
 * carrying it renders — rows nobody edited. Invalidating only the status read would leave those
 * stale until something else happened to refetch them.
 */
function statusWriteKeys(orgId: string): readonly (readonly unknown[])[] {
  return [
    queryKeys.statusSets(orgId),
    queryKeys.tasks(orgId),
    queryKeys.projects(orgId),
    queryKeys.programs(orgId),
    queryKeys.initiatives(orgId),
  ];
}

/** Add a status to one of the workspace's sets. */
export function useCreateStatus(orgId: string) {
  return useApiMutation({
    mutationFn: (input: WorkStatusCreate) =>
      unwrap(
        () => api.v1.orgs[':orgId'].statuses.$post({ param: { orgId }, json: input }),
        'Could not add the status.',
      ),
    invalidateKeys: statusWriteKeys(orgId),
  });
}

/** Rename a status, rewrite what it means, move its category, or make it the default. */
export function useUpdateStatus(orgId: string) {
  return useApiMutation({
    mutationFn: ({ statusId, ...patch }: WorkStatusUpdate & { statusId: string }) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].statuses[':statusId'].$patch({
            param: { orgId, statusId },
            json: patch,
          }),
        'Could not save the status.',
      ),
    invalidateKeys: statusWriteKeys(orgId),
  });
}

/** Set the order a status set reads in. */
export function useReorderStatuses(orgId: string) {
  return useApiMutation({
    mutationFn: (input: WorkStatusReorder) =>
      unwrap(
        () => api.v1.orgs[':orgId'].statuses.reorder.$post({ param: { orgId }, json: input }),
        'Could not reorder the statuses.',
      ),
    invalidateKeys: statusWriteKeys(orgId),
  });
}

/** Delete a status, moving the work on it to the replacement. */
export function useDeleteStatus(orgId: string) {
  return useApiMutation({
    mutationFn: ({ statusId, remapTo }: { statusId: string; remapTo: string }) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].statuses[':statusId'].$delete({
            param: { orgId, statusId },
            query: { remapTo },
          }),
        'Could not delete the status.',
      ),
    invalidateKeys: statusWriteKeys(orgId),
  });
}

/** Give a team its own task statuses, copied from the workspace's. */
export function useForkTeamStatuses(orgId: string) {
  return useApiMutation({
    mutationFn: (teamId: string) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].teams[':teamId'].statuses.fork.$post({ param: { orgId, teamId } }),
        'Could not customize the statuses for this team.',
      ),
    invalidateKeys: statusWriteKeys(orgId),
  });
}

/** Return a team to the workspace's task statuses. */
export function useResetTeamStatuses(orgId: string) {
  return useApiMutation({
    mutationFn: (teamId: string) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].teams[':teamId'].statuses.fork.$delete({
            param: { orgId, teamId },
          }),
        'Could not return this team to the workspace statuses.',
      ),
    invalidateKeys: statusWriteKeys(orgId),
  });
}

/** The kinds of work a workspace defines statuses for, in the order the settings page shows them. */
export const STATUS_ENTITY_ORDER: readonly WorkStatusEntityType[] = [
  'task',
  'project',
  'program',
  'initiative',
];
