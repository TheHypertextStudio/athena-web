'use client';

/**
 * Create/delete a Project's milestones — the list itself lives in the composite project-detail read.
 *
 * @remarks
 * Editing one milestone belongs to its own detail page ({@link useMilestoneDetail}); this hook is
 * what the Project Overview's Milestones list needs, which is adding one to the end and removing
 * one from the middle.
 *
 * The create input is {@link MilestoneCreate} itself: the parent is a path segment, not a field, so
 * there is nothing to subtract.
 *
 * Both mutations invalidate {@link milestoneWriteKeys} — the project's work read and the standalone
 * list every milestone picker draws from — which is the same pair {@link useMilestoneDetail}
 * invalidates, held in one place so the two hooks cannot disagree about what a milestone write
 * makes stale.
 */
import type { MilestoneCreate, MilestoneOut } from '@docket/work/milestone-contract';

import { api } from './api';
import { userErrorMessage } from './problem';
import { milestoneWriteKeys } from './project-milestones-def';
import { unwrap, useApiMutation } from './query';

/** Fields settable on milestone create; the parent Project is the path, not a field. */
export type CreateMilestoneInput = MilestoneCreate;

/** Create/delete actions for one Project's milestones. */
export interface ProjectMilestonesMutations {
  create: (input: CreateMilestoneInput) => Promise<void>;
  remove: (id: string) => void;
  /**
   * Whether a delete is in flight.
   *
   * @remarks
   * A delete, not any mutation: the add row is built to accept the next name while the previous
   * create is still going, so a create must not be what greys out every row's remove button.
   */
  removing: boolean;
  mutationError: string | null;
}

/**
 * Create/delete milestones for one Project without a separate list query — the caller already has
 * `milestones` from the project-detail read, which is one of the queries a write invalidates.
 *
 * `create` resolves once persisted and rejects when the server refuses, because the inline add row
 * clears its field before the round trip and needs the rejection to hand the typed words back.
 *
 * @param orgId - The active org.
 * @param projectId - The project the milestone will be scoped to.
 * @returns the create/delete actions, the delete's pending state, and its failure copy.
 */
export function useProjectMilestones(orgId: string, projectId: string): ProjectMilestonesMutations {
  const invalidateKeys = milestoneWriteKeys(orgId, projectId);

  const createMutation = useApiMutation<MilestoneOut, CreateMilestoneInput>({
    mutationFn: (input) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].projects[':id'].milestones.$post({
            param: { orgId, id: projectId },
            json: input,
          }),
        'Could not create the milestone.',
      ),
    invalidateKeys,
  });

  const removeMutation = useApiMutation<MilestoneOut, string>({
    mutationFn: (id) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].projects[':id'].milestones[':milestoneId'].$delete({
            param: { orgId, id: projectId, milestoneId: id },
          }),
        'Could not remove the milestone.',
      ),
    invalidateKeys,
  });

  return {
    create: async (input) => {
      await createMutation.mutateAsync(input);
    },
    remove: (id) => {
      removeMutation.mutate(id);
    },
    removing: removeMutation.isPending,
    mutationError: removeMutation.error
      ? userErrorMessage(removeMutation.error, 'Could not remove the milestone.')
      : null,
  };
}
