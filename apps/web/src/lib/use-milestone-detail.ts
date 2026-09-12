'use client';

/**
 * Edit one of a Project's milestones.
 *
 * @remarks
 * There is no milestone read here, and no milestone query key of its own, because a milestone is
 * never fetched on its own: the Project's work read already carries its milestones, and the editor
 * is opened from that list with the record in hand. The patch invalidates that read, which is the
 * list the edit has to show up in, and {@link projectMilestonesDef}, the standalone list every
 * milestone picker reads and holds for five minutes.
 *
 * Deleting is not here. A milestone is removed from the list it sits in, by the list's own hook
 * ({@link useProjectMilestones}), which already owns the pending state that greys the other rows.
 *
 * The patch type is {@link MilestoneUpdate} itself rather than a hand-written near-copy. On that
 * type `description` and `targetDate` are optional *and* nullable, and both halves mean something:
 * omitting a field leaves it unchanged, passing `null` clears it. That distinction only exists on
 * the wire, so it stops here: nothing downstream of this module deals in `undefined`. The read side
 * is normalized by `toDay`, the date module's own coercion for API values documented as days and
 * delivered as timestamps.
 */
import type { MilestoneOut, MilestoneUpdate } from '@docket/work/milestone-contract';

import { api } from './api';
import { userErrorMessage } from './problem';
import { milestoneWriteKeys } from './project-milestones-def';
import { unwrap, useApiMutation } from './query';

/** Edit actions for one Milestone. */
export interface MilestoneDetailMutations {
  patch: (patch: MilestoneUpdate) => void;
  mutationError: string | null;
}

/**
 * Patch one Milestone, keeping the owning Project's work list in step.
 *
 * @param orgId - The active org.
 * @param milestoneId - The milestone being edited.
 * @param projectId - The milestone's project, whose work read backs the Overview list.
 * @returns the patch action and its failure in application-owned copy.
 */
export function useMilestoneDetail(
  orgId: string,
  milestoneId: string,
  projectId: string,
): MilestoneDetailMutations {
  const patchMutation = useApiMutation<MilestoneOut, MilestoneUpdate>({
    mutationFn: (json) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].projects[':id'].milestones[':milestoneId'].$patch({
            param: { orgId, id: projectId, milestoneId },
            json,
          }),
        'Could not update this milestone.',
      ),
    invalidateKeys: milestoneWriteKeys(orgId, projectId),
  });

  return {
    patch: (patch) => {
      patchMutation.mutate(patch);
    },
    mutationError: patchMutation.error
      ? userErrorMessage(patchMutation.error, 'Could not update this milestone.')
      : null,
  };
}
