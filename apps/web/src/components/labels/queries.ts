'use client';

/**
 * The one place labels are read and written from.
 *
 * @remarks
 * Labels are reached from more surfaces than almost anything else — every entity composer, every
 * detail panel, the settings page, the filter toolbar, and the command palette — so the data-layer
 * rule matters here more than usual: each surface imports a definition from this module rather
 * than reaching for `api.v1.*` itself.
 *
 * Every write invalidates label metadata plus each work target collection, because a label rename
 * or merge changes rows that were never themselves edited.
 *
 * @see `docs/engineering/specs/data-layer.md` for the query-definition standard.
 */
import type {
  LabelCreate,
  LabelGroupCreate,
  LabelGroupUpdate,
  LabelOut,
  LabelUpdate,
} from '@docket/types';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { apiQueryOptions, queryKeys, STALE, unwrap, useApiMutation } from '@/lib/query';
import { invalidateWorkTargetQueries } from '@/lib/work-target-invalidation';

const LABEL_WORK_TARGETS = ['task', 'project', 'program', 'initiative'] as const;

/** Every label in the org — the bare list pickers read. */
export function labelsDef(orgId: string) {
  return apiQueryOptions(
    queryKeys.labels(orgId),
    () => api.v1.orgs[':orgId'].labels.$get({ param: { orgId }, query: {} }),
    'Could not load your labels.',
    // A bounded, rarely-changing set that every composer opens against. Re-reading it per open
    // would be a request each time for data that has not moved; writes invalidate explicitly.
    { staleTime: STALE.static },
  );
}

/**
 * Every label plus its usage count — the settings page read.
 *
 * @remarks
 * Kept separate from {@link labelsDef} because the counts sweep five join tables. That is cheap
 * once on a settings page and wasteful on every picker open.
 */
export function labelsWithCountsDef(orgId: string) {
  return apiQueryOptions(
    queryKeys.labelsWithCounts(orgId),
    () => api.v1.orgs[':orgId'].labels.$get({ param: { orgId }, query: { withCounts: '1' } }),
    'Could not load your labels.',
  );
}

/** The org's label groups, ordered for display. */
export function labelGroupsDef(orgId: string) {
  return apiQueryOptions(
    queryKeys.labelGroups(orgId),
    () => api.v1.orgs[':orgId'].labels.groups.$get({ param: { orgId } }),
    'Could not load your label groups.',
    { staleTime: STALE.static },
  );
}

/**
 * Label and group metadata that every label write can change.
 *
 * @remarks
 * Work target collections refresh through {@link invalidateLabelWorkTargets}; these keys cover the
 * label pickers, settings counts, and group controls that share the same metadata.
 */
function labelMetadataKeys(orgId: string): readonly (readonly unknown[])[] {
  return [queryKeys.labels(orgId), queryKeys.labelsWithCounts(orgId), queryKeys.labelGroups(orgId)];
}

function invalidateLabelWorkTargets(queryClient: QueryClient, orgId: string): void {
  for (const target of LABEL_WORK_TARGETS) {
    void invalidateWorkTargetQueries(queryClient, {
      target,
      ownerOrganizationId: orgId,
    });
  }
}

/** Create a label. Always workspace-wide; narrowing to a team is a later curation step. */
export function useCreateLabel(orgId: string) {
  const queryClient = useQueryClient();
  return useApiMutation({
    mutationFn: (input: LabelCreate) =>
      unwrap(
        () => api.v1.orgs[':orgId'].labels.$post({ param: { orgId }, json: input }),
        'Could not create the label.',
      ),
    invalidateKeys: labelMetadataKeys(orgId),
    onSettled: () => {
      invalidateLabelWorkTargets(queryClient, orgId);
    },
  });
}

/** Rename, recolour, regroup, or re-scope a label. Needs `manage`. */
export function useUpdateLabel(orgId: string) {
  const queryClient = useQueryClient();
  return useApiMutation({
    mutationFn: ({ id, ...patch }: LabelUpdate & { id: string }) =>
      unwrap(
        () => api.v1.orgs[':orgId'].labels[':id'].$patch({ param: { orgId, id }, json: patch }),
        'Could not save the label.',
      ),
    invalidateKeys: labelMetadataKeys(orgId),
    onSettled: () => {
      invalidateLabelWorkTargets(queryClient, orgId);
    },
  });
}

/** Delete a label. Its attachments cascade away; no work is deleted. */
export function useDeleteLabel(orgId: string) {
  const queryClient = useQueryClient();
  return useApiMutation({
    mutationFn: (id: string) =>
      unwrap(
        () => api.v1.orgs[':orgId'].labels[':id'].$delete({ param: { orgId, id } }),
        'Could not delete the label.',
      ),
    invalidateKeys: labelMetadataKeys(orgId),
    onSettled: () => {
      invalidateLabelWorkTargets(queryClient, orgId);
    },
  });
}

/** Dissolve one label into another, moving every attachment onto the survivor. */
export function useMergeLabel(orgId: string) {
  const queryClient = useQueryClient();
  return useApiMutation({
    mutationFn: ({ id, intoId }: { id: string; intoId: string }) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].labels[':id'].merge.$post({
            param: { orgId, id },
            json: { intoId },
          }),
        'Could not merge the labels.',
      ),
    invalidateKeys: labelMetadataKeys(orgId),
    onSettled: () => {
      invalidateLabelWorkTargets(queryClient, orgId);
    },
  });
}

/** Create a label group — a named dimension whose members may be mutually exclusive. */
export function useCreateLabelGroup(orgId: string) {
  const queryClient = useQueryClient();
  return useApiMutation({
    mutationFn: (input: LabelGroupCreate) =>
      unwrap(
        () => api.v1.orgs[':orgId'].labels.groups.$post({ param: { orgId }, json: input }),
        'Could not create the group.',
      ),
    invalidateKeys: labelMetadataKeys(orgId),
    onSettled: () => {
      invalidateLabelWorkTargets(queryClient, orgId);
    },
  });
}

/** Rename a group or toggle its exclusivity. */
export function useUpdateLabelGroup(orgId: string) {
  const queryClient = useQueryClient();
  return useApiMutation({
    mutationFn: ({ id, ...patch }: LabelGroupUpdate & { id: string }) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].labels.groups[':id'].$patch({
            param: { orgId, id },
            json: patch,
          }),
        'Could not save the group.',
      ),
    invalidateKeys: labelMetadataKeys(orgId),
    onSettled: () => {
      invalidateLabelWorkTargets(queryClient, orgId);
    },
  });
}

/** Dissolve a group. Its labels survive and become ungrouped. */
export function useDeleteLabelGroup(orgId: string) {
  const queryClient = useQueryClient();
  return useApiMutation({
    mutationFn: (id: string) =>
      unwrap(
        () => api.v1.orgs[':orgId'].labels.groups[':id'].$delete({ param: { orgId, id } }),
        'Could not delete the group.',
      ),
    invalidateKeys: labelMetadataKeys(orgId),
    onSettled: () => {
      invalidateLabelWorkTargets(queryClient, orgId);
    },
  });
}

/** Normalize a label name for comparison: trimmed, whitespace-collapsed, case-folded. */
export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Find the label a name would collide with, ignoring one id.
 *
 * @remarks
 * The settings rename flow calls this to decide between saving and offering a merge. The DB
 * uniques are case-sensitive by decision, so `Bug` and `bug` both insert happily — which is why
 * the collision has to be caught by comparing normalized names rather than by waiting for a 409.
 *
 * @param labels - Every label in the org.
 * @param name - The proposed name.
 * @param exceptId - The label being renamed, which cannot collide with itself.
 * @returns The colliding label, or undefined.
 */
export function findNameCollision(
  labels: readonly LabelOut[],
  name: string,
  exceptId?: string,
): LabelOut | undefined {
  const target = normalizeName(name);
  return labels.find((l) => l.id !== exceptId && normalizeName(l.name) === target);
}
