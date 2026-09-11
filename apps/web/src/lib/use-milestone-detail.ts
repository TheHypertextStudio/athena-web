'use client';

/**
 * The read + write layer for one Milestone's detail page.
 *
 * @remarks
 * A Milestone is project-scoped and cannot be re-parented — `MilestoneUpdate` has no `projectId` —
 * so its detail page reads the milestone itself for identity and body, and the owning Project's
 * work sections for the tasks pointed at it. There is no `milestoneId` filter on the task list, and
 * adding one would duplicate a read the Project already serves, so the tasks come from
 * {@link projectWorkSectionsDef} and are narrowed by the page.
 *
 * The patch type is {@link MilestoneUpdate} itself rather than a hand-written near-copy. On that
 * type `description` and `targetDate` are optional *and* nullable, and both halves mean something:
 * omitting a field leaves it unchanged, passing `null` clears it. That distinction only exists on
 * the wire, so it stops here — {@link milestoneTargetDate} normalizes the read side to a plain
 * `string | null`, and nothing downstream of this module deals in `undefined`.
 *
 * Every mutation invalidates the Project's work key as well as the milestone's own. The Project
 * Overview's Milestones list is rendered from that composite read, so a rename that only invalidated
 * the milestone would leave the list showing the old name until something else happened to refetch
 * it.
 */
import type { MilestoneOut, MilestoneUpdate } from '@docket/work/milestone-contract';

import { api } from './api';
import { userErrorMessage } from './problem';
import { projectWorkSectionsDef } from './fetch-project-sections';
import { apiQueryOptions, queryKeys, unwrap, useApiMutation } from './query';

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

/** Read one Milestone by id. */
export function milestoneDetailDef(orgId: string, milestoneId: string) {
  return apiQueryOptions<MilestoneOut>(
    queryKeys.milestone(orgId, milestoneId),
    () => api.v1.orgs[':orgId'].milestones[':id'].$get({ param: { orgId, id: milestoneId } }),
    'Could not load this milestone.',
  );
}

/** Edit and delete actions for one Milestone. */
export interface MilestoneDetailMutations {
  patch: (patch: MilestoneUpdate) => void;
  remove: () => void;
  pending: boolean;
  mutationError: string | null;
}

/**
 * Patch/delete one Milestone, keeping the owning Project's work list in step.
 *
 * @param orgId - The active org.
 * @param milestoneId - The milestone being edited.
 * @param projectId - The milestone's project, whose work read backs the Overview list.
 * @param onRemoved - Run after a successful delete, so the page can route away from a gone record.
 */
export function useMilestoneDetail(
  orgId: string,
  milestoneId: string,
  projectId: string,
  onRemoved: () => void,
): MilestoneDetailMutations {
  const invalidateKeys = [
    queryKeys.milestone(orgId, milestoneId),
    projectWorkSectionsDef(orgId, projectId).queryKey,
  ];

  const patchMutation = useApiMutation<MilestoneOut, MilestoneUpdate>({
    mutationFn: (json) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].milestones[':id'].$patch({
            param: { orgId, id: milestoneId },
            json,
          }),
        'Could not update this milestone.',
      ),
    invalidateKeys,
  });

  const removeMutation = useApiMutation<MilestoneOut, undefined>({
    mutationFn: () =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].milestones[':id'].$delete({ param: { orgId, id: milestoneId } }),
        'Could not remove this milestone.',
      ),
    invalidateKeys,
    onSuccess: onRemoved,
  });

  return {
    patch: (patch) => {
      patchMutation.mutate(patch);
    },
    remove: () => {
      removeMutation.mutate(undefined);
    },
    pending: patchMutation.isPending || removeMutation.isPending,
    mutationError: patchMutation.error
      ? userErrorMessage(patchMutation.error, 'Could not update this milestone.')
      : removeMutation.error
        ? userErrorMessage(removeMutation.error, 'Could not remove this milestone.')
        : null,
  };
}
