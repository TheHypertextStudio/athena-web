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
 * the wire, so it stops here — {@link milestoneTargetDate} normalizes the read side to a plain
 * `string | null`, and nothing downstream of this module deals in `undefined`.
 */
import type { MilestoneOut, MilestoneUpdate } from '@docket/work/milestone-contract';

import { api } from './api';
import { userErrorMessage } from './problem';
import { projectMilestonesDef } from './project-milestones-def';
import { projectWorkSectionsDef } from './fetch-project-sections';
import { unwrap, useApiMutation } from './query';

/**
 * The milestone's target date as a calendar day, or `null` when it is undated.
 *
 * @remarks
 * `MilestoneOut.targetDate` is declared optional *and* nullable and arrives as a full ISO timestamp
 * (the column is a `timestamp`), while every writer takes `YYYY-MM-DD`. Both mismatches are
 * corrected in one place so no caller repeats `value ? value.slice(0, 10) : null`.
 *
 * @param milestone - The milestone as read from the API.
 * @returns the `YYYY-MM-DD` target day, or `null` when there is none.
 */
export function milestoneTargetDate(milestone: MilestoneOut): string | null {
  return milestone.targetDate ? milestone.targetDate.slice(0, 10) : null;
}

/** Edit actions for one Milestone. */
export interface MilestoneDetailMutations {
  patch: (patch: MilestoneUpdate) => void;
  pending: boolean;
  mutationError: string | null;
}

/**
 * Patch one Milestone, keeping the owning Project's work list in step.
 *
 * @param orgId - The active org.
 * @param milestoneId - The milestone being edited.
 * @param projectId - The milestone's project, whose work read backs the Overview list.
 * @returns the patch action, its pending state, and its failure in application-owned copy.
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
    invalidateKeys: [
      projectWorkSectionsDef(orgId, projectId).queryKey,
      projectMilestonesDef(orgId, projectId).queryKey,
    ],
  });

  return {
    patch: (patch) => {
      patchMutation.mutate(patch);
    },
    pending: patchMutation.isPending,
    mutationError: patchMutation.error
      ? userErrorMessage(patchMutation.error, 'Could not update this milestone.')
      : null,
  };
}
