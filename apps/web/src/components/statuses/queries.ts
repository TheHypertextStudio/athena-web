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
} from '@docket/work/work-status-contract';
import { useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { apiQueryOptions, queryKeys, STALE, unwrap, useApiMutation } from '@/lib/query';
import { invalidateWorkTargetQueries } from '@/lib/work-target-invalidation';

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
 * Status metadata that every status write can change.
 *
 * @remarks
 * The affected work collection refreshes through {@link useStatusTargetInvalidation}; this key
 * covers the workspace and team status-set reads that share the metadata.
 */
function statusMetadataKeys(orgId: string): readonly (readonly unknown[])[] {
  return [queryKeys.statusSets(orgId)];
}

function useStatusTargetInvalidation(orgId: string): (target: WorkStatusEntityType) => void {
  const queryClient = useQueryClient();
  return (target) => {
    void invalidateWorkTargetQueries(queryClient, {
      target,
      ownerOrganizationId: orgId,
    });
  };
}

type StatusUpdateMutation = WorkStatusUpdate & {
  statusId: string;
  entityType: WorkStatusEntityType;
};

interface StatusDeleteMutation {
  statusId: string;
  remapTo: string;
  entityType: WorkStatusEntityType;
}

/** Add a status to one of the workspace's sets. */
export function useCreateStatus(orgId: string) {
  const invalidateTarget = useStatusTargetInvalidation(orgId);
  return useApiMutation({
    mutationFn: (input: WorkStatusCreate) =>
      unwrap(
        () => api.v1.orgs[':orgId'].statuses.$post({ param: { orgId }, json: input }),
        'Could not add the status.',
      ),
    invalidateKeys: statusMetadataKeys(orgId),
    onSettled: (_data, _error, input) => {
      invalidateTarget(input.entityType);
    },
  });
}

/** Rename a status, rewrite what it means, move its category, or make it the default. */
export function useUpdateStatus(orgId: string) {
  const invalidateTarget = useStatusTargetInvalidation(orgId);
  return useApiMutation({
    mutationFn: ({ statusId, entityType: _entityType, ...patch }: StatusUpdateMutation) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].statuses[':statusId'].$patch({
            param: { orgId, statusId },
            json: patch,
          }),
        'Could not save the status.',
      ),
    invalidateKeys: statusMetadataKeys(orgId),
    onSettled: (_updated, _error, input) => {
      invalidateTarget(input.entityType);
    },
  });
}

/** Set the order a status set reads in. */
export function useReorderStatuses(orgId: string) {
  const invalidateTarget = useStatusTargetInvalidation(orgId);
  return useApiMutation({
    mutationFn: (input: WorkStatusReorder) =>
      unwrap(
        () => api.v1.orgs[':orgId'].statuses.reorder.$post({ param: { orgId }, json: input }),
        'Could not reorder the statuses.',
      ),
    invalidateKeys: statusMetadataKeys(orgId),
    onSettled: (_data, _error, input) => {
      invalidateTarget(input.entityType);
    },
  });
}

/** Delete a status, moving the work on it to the replacement. */
export function useDeleteStatus(orgId: string) {
  const invalidateTarget = useStatusTargetInvalidation(orgId);
  return useApiMutation({
    mutationFn: ({ statusId, remapTo }: StatusDeleteMutation) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].statuses[':statusId'].$delete({
            param: { orgId, statusId },
            query: { remapTo },
          }),
        'Could not delete the status.',
      ),
    invalidateKeys: statusMetadataKeys(orgId),
    onSettled: (_deleted, _error, input) => {
      invalidateTarget(input.entityType);
    },
  });
}

/** Give a team its own task statuses, copied from the workspace's. */
export function useForkTeamStatuses(orgId: string) {
  const invalidateTarget = useStatusTargetInvalidation(orgId);
  return useApiMutation({
    mutationFn: (teamId: string) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].teams[':teamId'].statuses.fork.$post({ param: { orgId, teamId } }),
        'Could not customize the statuses for this team.',
      ),
    invalidateKeys: statusMetadataKeys(orgId),
    onSettled: () => {
      invalidateTarget('task');
    },
  });
}

/** Return a team to the workspace's task statuses. */
export function useResetTeamStatuses(orgId: string) {
  const invalidateTarget = useStatusTargetInvalidation(orgId);
  return useApiMutation({
    mutationFn: (teamId: string) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].teams[':teamId'].statuses.fork.$delete({
            param: { orgId, teamId },
          }),
        'Could not return this team to the workspace statuses.',
      ),
    invalidateKeys: statusMetadataKeys(orgId),
    onSettled: () => {
      invalidateTarget('task');
    },
  });
}

/** The kinds of work a workspace defines statuses for, in the order the settings page shows them. */
export const STATUS_ENTITY_ORDER: readonly WorkStatusEntityType[] = [
  'task',
  'project',
  'program',
  'initiative',
];
