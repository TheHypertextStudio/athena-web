'use client';

/** Mutations for a Project's milestones — the list itself lives in the composite project-detail read. */
import type { MilestoneOut } from '@docket/types';
import type { QueryKey } from '@tanstack/react-query';

import { api } from './api';
import { userErrorMessage } from './problem';
import { unwrap, useApiMutation } from './query';

/** Fields settable on milestone create (`projectId` is fixed by the caller, not the form). */
export interface CreateMilestoneInput {
  name: string;
  description?: string;
  targetDate?: string;
  sort?: number;
}

/** Fields settable on milestone update; all optional (matches `MilestoneUpdate`). */
export interface UpdateMilestoneInput {
  name?: string;
  description?: string | null;
  targetDate?: string | null;
  sort?: number;
}

/** Create/update/delete actions for one Project's milestones. */
export interface ProjectMilestonesMutations {
  create: (input: CreateMilestoneInput) => void;
  update: (id: string, patch: UpdateMilestoneInput) => void;
  remove: (id: string) => void;
  pending: boolean;
  mutationError: string | null;
}

/**
 * Create/edit/delete milestones for one Project without a separate list query — the
 * caller already has `milestones` from the project-detail read, so every mutation here
 * just invalidates `projectDetailKey` to refetch that composite query.
 *
 * @param orgId - The active org.
 * @param projectId - The project the milestone is (or will be) scoped to.
 * @param projectDetailKey - The project-detail query key to invalidate on settle.
 */
export function useProjectMilestones(
  orgId: string,
  projectId: string,
  projectDetailKey: QueryKey,
): ProjectMilestonesMutations {
  const createMutation = useApiMutation<MilestoneOut, CreateMilestoneInput>({
    mutationFn: (input) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].milestones.$post({
            param: { orgId },
            json: { projectId, ...input },
          }),
        'Could not create the milestone.',
      ),
    invalidateKeys: [projectDetailKey],
  });

  const updateMutation = useApiMutation<MilestoneOut, { id: string; patch: UpdateMilestoneInput }>({
    mutationFn: ({ id, patch }) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].milestones[':id'].$patch({
            param: { orgId, id },
            json: patch,
          }),
        'Could not update the milestone.',
      ),
    invalidateKeys: [projectDetailKey],
  });

  const removeMutation = useApiMutation<MilestoneOut, string>({
    mutationFn: (id) =>
      unwrap(
        () => api.v1.orgs[':orgId'].milestones[':id'].$delete({ param: { orgId, id } }),
        'Could not remove the milestone.',
      ),
    invalidateKeys: [projectDetailKey],
  });

  return {
    create: (input) => {
      createMutation.mutate(input);
    },
    update: (id, patch) => {
      updateMutation.mutate({ id, patch });
    },
    remove: (id) => {
      removeMutation.mutate(id);
    },
    pending: createMutation.isPending || updateMutation.isPending || removeMutation.isPending,
    mutationError: createMutation.error
      ? userErrorMessage(createMutation.error, 'Could not create the milestone.')
      : updateMutation.error
        ? userErrorMessage(updateMutation.error, 'Could not update the milestone.')
        : removeMutation.error
          ? userErrorMessage(removeMutation.error, 'Could not remove the milestone.')
          : null,
  };
}
