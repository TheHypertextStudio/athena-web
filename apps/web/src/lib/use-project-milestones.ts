'use client';

/**
 * Create/delete a Project's milestones — the list itself lives in the composite project-detail read.
 *
 * @remarks
 * Editing one milestone belongs to its own detail page ({@link useMilestoneDetail}); this hook is
 * what the Project Overview's Milestones list needs, which is adding one to the end and removing
 * one from the middle.
 *
 * The create input is {@link MilestoneCreate} minus `projectId`, taken from the contract rather than
 * retyped, so a field added to the wire contract cannot silently go missing here.
 */
import type { MilestoneCreate, MilestoneOut } from '@docket/work/milestone-contract';
import type { QueryKey } from '@tanstack/react-query';

import { api } from './api';
import { userErrorMessage } from './problem';
import { unwrap, useApiMutation } from './query';

/** Fields settable on milestone create; `projectId` is fixed by the caller, not the form. */
export type CreateMilestoneInput = Omit<MilestoneCreate, 'projectId'>;

/** Create/delete actions for one Project's milestones. */
export interface ProjectMilestonesMutations {
  create: (input: CreateMilestoneInput) => Promise<void>;
  remove: (id: string) => void;
  pending: boolean;
  mutationError: string | null;
}

/**
 * Create/delete milestones for one Project without a separate list query — the caller already has
 * `milestones` from the project-detail read, so every mutation here just invalidates
 * `projectDetailKey` to refetch that composite query.
 *
 * `create` resolves once persisted and rejects when the server refuses, because the inline add row
 * clears its field before the round trip and needs the rejection to hand the typed words back.
 *
 * @param orgId - The active org.
 * @param projectId - The project the milestone will be scoped to.
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

  const removeMutation = useApiMutation<MilestoneOut, string>({
    mutationFn: (id) =>
      unwrap(
        () => api.v1.orgs[':orgId'].milestones[':id'].$delete({ param: { orgId, id } }),
        'Could not remove the milestone.',
      ),
    invalidateKeys: [projectDetailKey],
  });

  return {
    create: async (input) => {
      await createMutation.mutateAsync(input);
    },
    remove: (id) => {
      removeMutation.mutate(id);
    },
    pending: createMutation.isPending || removeMutation.isPending,
    mutationError: removeMutation.error
      ? userErrorMessage(removeMutation.error, 'Could not remove the milestone.')
      : null,
  };
}
