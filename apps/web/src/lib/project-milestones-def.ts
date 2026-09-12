'use client';

/**
 * One Project's milestones, as a query definition every picker shares.
 *
 * @remarks
 * A milestone lives under its Project on the wire, so there is no org-wide list to read and every
 * caller needs the same two things: the parent id in the path, and dormancy until that parent is
 * known. Three surfaces need it — the task composer's milestone picker, the task detail's milestone
 * property, and the graph inspector — and each of them knows its project from somewhere different
 * (the draft, the task, the graph scope). Writing the `?? ''` and the `!== null` out at each site
 * spread the same two branches across three hooks that were already at their complexity ceiling.
 *
 * The empty-string fallback never reaches the network: `enabled` is false whenever `projectId` is
 * null, and it exists only because the path parameter is typed as a `string`.
 */
import type { MilestoneOut } from '@docket/work/milestone-contract';

import type { QueryKey } from '@tanstack/react-query';

import { api } from './api';
import { projectWorkSectionsDef } from './fetch-project-sections';
import { STALE, apiQueryOptions } from './query';

/** A page of milestones, as the nested collection returns them. */
interface MilestonePage {
  readonly items: readonly MilestoneOut[];
}

/**
 * Read the milestones of one Project.
 *
 * @param orgId - The active org.
 * @param projectId - The Project whose milestones to read; absent when none is selected.
 * @param enabled - The caller's own gate (a picker being open, a scope being project-shaped);
 *   absent means "no further gate", so the read waits only on the Project.
 * @returns query options that stay dormant until a Project is known.
 */
export function projectMilestonesDef(
  orgId: string,
  projectId: string | null | undefined,
  enabled?: boolean,
) {
  return apiQueryOptions<MilestonePage>(
    ['org', orgId, 'projects', projectId ?? '', 'milestones'] as const,
    () =>
      api.v1.orgs[':orgId'].projects[':id'].milestones.$get({
        param: { orgId, id: projectId ?? '' },
      }),
    'Could not load milestones.',
    { enabled: (enabled ?? true) && Boolean(projectId), staleTime: STALE.static },
  );
}

/**
 * The queries a milestone write makes stale.
 *
 * @remarks
 * Two reads carry a project's milestones: the project-detail work composite behind the Overview,
 * and this module's standalone list behind every picker. They are separate queries with separate
 * lifetimes — the list holds its answer for five minutes — so a write that refreshes one and not
 * the other leaves a picker offering a milestone that is gone. Held here rather than in each
 * mutation hook so the pair cannot drift.
 *
 * @param orgId - The active org.
 * @param projectId - The Project whose milestones changed.
 * @returns the query keys to invalidate.
 */
export function milestoneWriteKeys(orgId: string, projectId: string): readonly QueryKey[] {
  return [
    projectWorkSectionsDef(orgId, projectId).queryKey,
    projectMilestonesDef(orgId, projectId).queryKey,
  ];
}
