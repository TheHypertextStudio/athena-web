'use client';

/**
 * Everything the Milestone detail page reads, as one value.
 *
 * @remarks
 * A milestone is a small record with a large *context*: it owns only a name, a note and a date, but
 * the page also needs the Project it hangs off (for the breadcrumb and the delete destination) and
 * that Project's tasks (for the ones pointing here). Both of those are dependent reads — the
 * `projectId` only exists once the milestone itself resolves — so keeping the sequencing in one hook
 * leaves the page component about layout.
 */
import type { MilestoneOut } from '@docket/work/milestone-contract';

import { useCategoryOf } from '@/components/entity-display/use-work-status';
import type { MilestoneTask } from '@/components/project-detail/milestone-tasks';
import { projectWorkSectionsDef } from '@/lib/fetch-project-sections';
import { projectRecordDef } from '@/lib/entity-records';
import { countTasksByMilestone } from '@/lib/milestone-progress';
import { useApiQuery } from '@/lib/query';
import { milestoneDetailDef, milestoneTargetDate } from '@/lib/use-milestone-detail';
import { useOrgCapability } from '@/lib/use-org-capability';
import { useOrgMembership } from '@/lib/use-org-membership';
import { useMemo } from 'react';

/** The synthesized bucket id for tasks with no milestone, shared with the Project's Tasks tab. */
const UNSCHEDULED_KEY = '__unscheduled__';

/** How many of a milestone's tasks are done. */
export interface MilestoneProgress {
  readonly done: number;
  readonly total: number;
}

/** Everything one Milestone detail page renders from. */
export interface MilestonePageData {
  /** The milestone, or `null` until it resolves (or when it does not exist). */
  readonly milestone: MilestoneOut | null;
  /** The owning Project's id, or `null` until the milestone resolves. */
  readonly projectId: string | null;
  /** The owning Project's name, or `null` until that read resolves. */
  readonly projectName: string | null;
  /** The milestone's target day (`YYYY-MM-DD`), or `null` when undated. */
  readonly targetDate: string | null;
  /** The Project's tasks that point at this milestone. */
  readonly tasks: readonly MilestoneTask[];
  /** Completion of those tasks. */
  readonly progress: MilestoneProgress;
  /** Whether the viewer may edit. */
  readonly canEdit: boolean;
  /** Whether the milestone read is still in flight. */
  readonly loading: boolean;
  /** The milestone read's failure, if any. */
  readonly error: unknown;
  /** Whether the Project work read failed (its tasks are missing, the page is not). */
  readonly tasksFailed: boolean;
}

/**
 * Read one milestone, its Project, and the Project tasks assigned to it.
 *
 * @param orgId - The active org.
 * @param milestoneId - The milestone being shown.
 * @returns the page's data.
 */
export function useMilestonePage(orgId: string, milestoneId: string): MilestonePageData {
  const milestoneQ = useApiQuery(milestoneDetailDef(orgId, milestoneId));
  const milestone = milestoneQ.data ?? null;
  const projectId = milestone?.projectId ?? null;

  const membership = useOrgMembership(orgId);
  const canEdit = useOrgCapability(membership.members, membership.roles, 'contribute');

  // Both dependent on the milestone resolving, because that is where `projectId` comes from.
  const projectQ = useApiQuery({
    ...projectRecordDef(orgId, projectId ?? ''),
    enabled: projectId !== null,
  });
  const workQ = useApiQuery({
    ...projectWorkSectionsDef(orgId, projectId ?? ''),
    enabled: projectId !== null,
  });

  const tasks = useMemo<readonly MilestoneTask[]>(
    () =>
      (workQ.data?.tasks ?? [])
        .map((task) => ({
          task,
          milestoneId:
            workQ.data?.taskMilestones.find((entry) => entry.taskId === task.id)?.milestoneId ??
            null,
        }))
        .filter((entry) => entry.milestoneId === milestoneId),
    [workQ.data, milestoneId],
  );

  const categoryOf = useCategoryOf('task');
  const progress = useMemo<MilestoneProgress>(
    () =>
      countTasksByMilestone(tasks, UNSCHEDULED_KEY, categoryOf).get(milestoneId) ?? {
        done: 0,
        total: 0,
      },
    [tasks, categoryOf, milestoneId],
  );

  return {
    milestone,
    projectId,
    projectName: projectQ.data?.name ?? null,
    targetDate: milestone ? milestoneTargetDate(milestone) : null,
    tasks,
    progress,
    canEdit,
    loading: milestoneQ.isPending,
    error: milestoneQ.isError ? milestoneQ.error : null,
    tasksFailed: workQ.isError,
  };
}
