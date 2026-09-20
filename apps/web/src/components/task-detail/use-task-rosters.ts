'use client';

/**
 * The organization rosters behind a task's property pickers.
 *
 * @remarks
 * A roster (members, projects, programs, cycles, a project's milestones) is not part of the task's
 * first paint, so each one stays dormant until it is needed. It is needed in exactly two cases: a
 * person opens the picker that lists it, or the task already holds a value from it — an assigned
 * task has to name its assignee, and a task in a project has to name the project, before anyone
 * opens anything. The second case is why the gates read the task rather than only the pickers.
 *
 * Every roster uses the shared `queryKeys` entry for its list, so a roster is fetched once however
 * many surfaces want it.
 */
import type { AgentOut } from '@docket/athena/agent-contract';
import type { MemberOut } from '@docket/identity-access/member-contract';
import type { MilestoneOut } from '@docket/work/milestone-contract';
import type { ProgramOut } from '@docket/work/program-contract';
import type { TaskDetail } from '@docket/work/task-model';
import { useCallback, useMemo, useState } from 'react';

import type { ProjectOut } from '@/lib/contracts/project';
import { api } from '@/lib/api';
import { projectMilestonesDef } from '@/lib/project-milestones-def';
import { STALE, apiQueryOptions, queryKeys, useApiQuery } from '@/lib/query';
import { orgMembersDef } from '@/lib/use-org-membership';

/** The rosters a task's pickers can draw on. */
export type TaskRoster = 'members' | 'projects' | 'programs' | 'milestones';

/** The rosters with their loading state and the hooks for the pickers that open them. */
export interface TaskRosters {
  readonly members: readonly MemberOut[];
  readonly agents: readonly AgentOut[];
  readonly projects: readonly ProjectOut[];
  readonly programs: readonly ProgramOut[];
  readonly milestones: readonly MilestoneOut[];
  /** Whether the roster is switched on: its picker was opened, or the task holds a value from it. */
  readonly wanted: Readonly<Record<TaskRoster, boolean>>;
  /** Whether the roster was requested and has not answered yet. */
  readonly loading: Readonly<Record<TaskRoster, boolean>>;
  /** Pass to a picker's `onOpenChange`: opening it starts its roster. */
  readonly onOpenChange: Readonly<Record<TaskRoster, (open: boolean) => void>>;
}

/** The one empty roster, so a roster that has not loaded keeps a stable identity across renders. */
export const NO_ITEMS: readonly never[] = [];

/** The rows of a list response, or none before it arrives. */
function itemsOf<T>(page: { readonly items: readonly T[] } | undefined): readonly T[] {
  return page?.items ?? NO_ITEMS;
}

/** Which rosters the task already holds a value from. */
function heldRosters(task: TaskDetail | null): Record<TaskRoster, boolean> {
  return {
    members: Boolean(task?.assigneeId ?? task?.delegateId),
    projects: Boolean(task?.projectId),
    programs: Boolean(task?.programId),
    milestones: Boolean(task?.milestoneId),
  };
}

/** Remember which pickers have been opened; a roster stays requested once it has been. */
function useOpenedRosters(): {
  readonly opened: ReadonlySet<TaskRoster>;
  readonly onOpenChange: TaskRosters['onOpenChange'];
} {
  const [opened, setOpened] = useState<ReadonlySet<TaskRoster>>(() => new Set());
  const handler = useCallback(
    (roster: TaskRoster) =>
      (open: boolean): void => {
        if (open) setOpened((current) => new Set(current).add(roster));
      },
    [],
  );
  const onOpenChange = useMemo<TaskRosters['onOpenChange']>(
    () => ({
      members: handler('members'),
      projects: handler('projects'),
      programs: handler('programs'),
      milestones: handler('milestones'),
    }),
    [handler],
  );
  return { opened, onOpenChange };
}

/**
 * Read the rosters a task's pickers need, when they are needed.
 *
 * @param orgId - The active organization.
 * @param task - The task on screen, whose held values request their rosters.
 * @returns the rosters, their loading state, and the picker open handlers.
 */
export function useTaskRosters(orgId: string, task: TaskDetail | null): TaskRosters {
  const { opened, onOpenChange } = useOpenedRosters();
  const held = heldRosters(task);
  const wanted: Record<TaskRoster, boolean> = {
    members: opened.has('members') || held.members,
    projects: opened.has('projects') || held.projects,
    programs: opened.has('programs') || held.programs,
    milestones: opened.has('milestones') || held.milestones,
  };
  const wants = (roster: TaskRoster): boolean => wanted[roster];

  const membersQ = useApiQuery({ ...orgMembersDef(orgId), enabled: wants('members') });
  const agentsQ = useApiQuery(
    apiQueryOptions(
      queryKeys.agents(orgId),
      () => api.v1.orgs[':orgId'].agents.$get({ param: { orgId }, query: { limit: '100' } }),
      'Could not load agents.',
      { enabled: Boolean(task?.delegateId), staleTime: STALE.static },
    ),
  );
  const projectsQ = useApiQuery(
    apiQueryOptions(
      queryKeys.projects(orgId),
      () => api.v1.orgs[':orgId'].projects.$get({ param: { orgId }, query: {} }),
      'Could not load projects.',
      { enabled: wants('projects'), staleTime: STALE.static },
    ),
  );
  const programsQ = useApiQuery(
    apiQueryOptions(
      queryKeys.programs(orgId),
      () => api.v1.orgs[':orgId'].programs.$get({ param: { orgId }, query: {} }),
      'Could not load programs.',
      { enabled: wants('programs'), staleTime: STALE.static },
    ),
  );
  const milestonesQ = useApiQuery(
    projectMilestonesDef(orgId, task?.projectId, wants('milestones')),
  );

  const isLoading = (roster: TaskRoster, pending: boolean): boolean =>
    opened.has(roster) && pending;
  return {
    members: itemsOf(membersQ.data),
    agents: itemsOf(agentsQ.data),
    projects: itemsOf(projectsQ.data),
    programs: itemsOf(programsQ.data),
    milestones: itemsOf(milestonesQ.data),
    wanted,
    loading: {
      members: isLoading('members', membersQ.isPending),
      projects: isLoading('projects', projectsQ.isPending),
      programs: isLoading('programs', programsQ.isPending),
      milestones: isLoading('milestones', milestonesQ.isPending),
    },
    onOpenChange,
  };
}
