'use client';

/**
 * Fetch the org-scoped option sources a create composer needs, while it is open.
 *
 * @remarks
 * The robust create composers ({@link CreateTaskDialog}, {@link CreateProjectDialog}, …) front a
 * row of compact property pickers — assignee, project, program, lead, labels — whose choices come
 * from the org's rosters. Rather than fan out hand-rolled `useEffect`s, this hook reads each list
 * the composer opts into through the shared {@link useApiQuery} layer, gated by the `enabled` flag
 * (so a closed dialog fetches nothing) and the `include` set (so a composer pays only for what it
 * shows). Rosters are tiered `static` — reopening a composer reuses the warm cache instead of
 * refetching — and the lists are shared with the rest of the app under the standard {@link queryKeys}.
 *
 * Workflow states are *per team*, not org-global, so they are exposed through a memoized
 * {@link ComposerOptions.workflowStatesFor} loader that reads through the query cache (sharing the
 * same key as the task detail's workflow read), which the task composer calls when its team changes.
 *
 * @see {@link actorOptions} and friends for the pure DTO→option mappers this composes.
 */
import type { CycleOut } from '@docket/work/cycle-contract';
import type { EntityDisplayOut } from '@docket/work/entity-display-contract';
import type { LabelOut } from '@docket/work/label-contract';
import type { MilestoneOut } from '@docket/work/milestone-contract';
import type { ProjectOut } from '../../lib/contracts/project';
import type { TeamOut } from '../../lib/contracts/team';
import type { WorkflowState } from '@docket/work/workflow';
import type { PickerOption } from '@docket/ui/components';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import {
  actorOptions,
  initiativeOptions,
  labelOptions,
  memberActorOptions,
  programOptions,
  projectOptions,
  teamOptions,
} from '@/components/pickers/options';
import { api } from '@/lib/api';
import { STALE, apiQueryOptions, queryKeys, useApiQuery } from '@/lib/query';

/** The org-scoped option lists a composer can opt into loading. */
export type ComposerOptionKind =
  'actors' | 'projects' | 'programs' | 'initiatives' | 'labels' | 'cycles' | 'milestones' | 'teams';

/** The resolved option arrays + loaders returned by {@link useComposerOptions}. */
export interface ComposerOptions {
  /** Searchable actor options (org members + agents), for assignee / lead / owner pickers. */
  readonly actorOptions: readonly PickerOption[];
  /** Human-only options for accountable lead and owner fields. */
  readonly memberOptions: readonly PickerOption[];
  /** Project entity options. */
  readonly projectOptions: readonly PickerOption[];
  /** The org's raw projects (each carries its `programId`, for callers that need more than a
   * value/label pair — e.g. scoping to "projects not yet filed under this Program"). */
  readonly projects: readonly ProjectOut[];
  /** Program entity options. */
  readonly programOptions: readonly PickerOption[];
  /** Initiative entity options. */
  readonly initiativeOptions: readonly PickerOption[];
  /** Label multi-select options (each with its color swatch). */
  readonly labelOptions: readonly PickerOption[];
  /** Raw Labels retained for Team-scope compatibility checks. */
  readonly labels: readonly LabelOut[];
  /** Team entity options. */
  readonly teamOptions: readonly PickerOption[];
  /** Raw Teams retained for option scoping. */
  readonly teams: readonly TeamOut[];
  /** The org's raw cycles (each carries its `teamId` so callers can scope to a team). */
  readonly cycles: readonly CycleOut[];
  /** Cycle display records used when a caller scopes the raw cycle list. */
  readonly cycleDisplays: readonly EntityDisplayOut[];
  /** The org's raw milestones (each carries its `projectId` so callers can scope to a project). */
  readonly milestones: readonly MilestoneOut[];
  /** Milestone display records used when a caller scopes the raw milestone list. */
  readonly milestoneDisplays: readonly EntityDisplayOut[];
  /** Whether any requested list is still loading. */
  readonly loading: boolean;
  /** Application-owned error copy when any requested option source failed. */
  readonly error: string | null;
  /** Requested option kinds whose source query failed. */
  readonly failedKinds: ReadonlySet<ComposerOptionKind>;
  /** Retry every requested option source that is currently failed. */
  readonly retry: () => void;
  /**
   * Load a team's ordered workflow states (the valid task-status set), memoized per team.
   *
   * @param teamId - The team whose workflow to read, or `null` to resolve to an empty list.
   * @returns the team's workflow states (empty on failure or when `teamId` is null).
   */
  readonly workflowStatesFor: (teamId: string | null) => Promise<readonly WorkflowState[]>;
}

/**
 * Load the org-scoped option sources for a create composer.
 *
 * @param orgId - The org whose rosters to read.
 * @param include - Which lists to fetch (a composer pays only for what it shows).
 * @param enabled - Gate fetching (pass the dialog's `open` so a closed dialog stays idle).
 * @returns the resolved {@link ComposerOptions}.
 */
export function useComposerOptions(
  orgId: string,
  include: readonly ComposerOptionKind[],
  enabled: boolean,
): ComposerOptions {
  const queryClient = useQueryClient();
  const want = useMemo(() => new Set(include), [include]);
  const on = (kind: ComposerOptionKind): boolean => enabled && want.has(kind);

  const membersQ = useApiQuery(
    apiQueryOptions(
      queryKeys.members(orgId),
      () => api.v1.orgs[':orgId'].members.$get({ param: { orgId } }),
      'Could not load members.',
      { enabled: on('actors'), staleTime: STALE.static },
    ),
  );
  const agentsQ = useApiQuery(
    apiQueryOptions(
      queryKeys.agents(orgId),
      () => api.v1.orgs[':orgId'].agents.$get({ param: { orgId } }),
      'Could not load agents.',
      { enabled: on('actors'), staleTime: STALE.static },
    ),
  );
  const projectsQ = useApiQuery(
    apiQueryOptions(
      queryKeys.projects(orgId),
      () => api.v1.orgs[':orgId'].projects.$get({ param: { orgId }, query: {} }),
      'Could not load projects.',
      { enabled: on('projects'), staleTime: STALE.static },
    ),
  );
  const projectDisplaysQ = useApiQuery(
    apiQueryOptions(
      queryKeys.entityDisplays(orgId, 'project'),
      () =>
        api.v1.orgs[':orgId'].display[':subjectType'].$get({
          param: { orgId, subjectType: 'project' },
        }),
      'Could not load project icons.',
      { enabled: on('projects'), staleTime: STALE.static },
    ),
  );
  const programsQ = useApiQuery(
    apiQueryOptions(
      queryKeys.programs(orgId),
      () => api.v1.orgs[':orgId'].programs.$get({ param: { orgId }, query: {} }),
      'Could not load programs.',
      { enabled: on('programs'), staleTime: STALE.static },
    ),
  );
  const programDisplaysQ = useApiQuery(
    apiQueryOptions(
      queryKeys.entityDisplays(orgId, 'program'),
      () =>
        api.v1.orgs[':orgId'].display[':subjectType'].$get({
          param: { orgId, subjectType: 'program' },
        }),
      'Could not load program icons.',
      { enabled: on('programs'), staleTime: STALE.static },
    ),
  );
  const initiativesQ = useApiQuery(
    apiQueryOptions(
      queryKeys.initiatives(orgId),
      () => api.v1.orgs[':orgId'].initiatives.$get({ param: { orgId }, query: {} }),
      'Could not load initiatives.',
      { enabled: on('initiatives'), staleTime: STALE.static },
    ),
  );
  const initiativeDisplaysQ = useApiQuery(
    apiQueryOptions(
      queryKeys.entityDisplays(orgId, 'initiative'),
      () =>
        api.v1.orgs[':orgId'].display[':subjectType'].$get({
          param: { orgId, subjectType: 'initiative' },
        }),
      'Could not load initiative icons.',
      { enabled: on('initiatives'), staleTime: STALE.static },
    ),
  );
  const labelsQ = useApiQuery(
    apiQueryOptions(
      ['org', orgId, 'labels'],
      () => api.v1.orgs[':orgId'].labels.$get({ param: { orgId }, query: {} }),
      'Could not load labels.',
      { enabled: on('labels'), staleTime: STALE.static },
    ),
  );
  const cyclesQ = useApiQuery(
    apiQueryOptions(
      queryKeys.cycles(orgId),
      () => api.v1.orgs[':orgId'].cycles.$get({ param: { orgId }, query: {} }),
      'Could not load cycles.',
      { enabled: on('cycles'), staleTime: STALE.static },
    ),
  );
  const cycleDisplaysQ = useApiQuery(
    apiQueryOptions(
      queryKeys.entityDisplays(orgId, 'cycle'),
      () =>
        api.v1.orgs[':orgId'].display[':subjectType'].$get({
          param: { orgId, subjectType: 'cycle' },
        }),
      'Could not load cycle icons.',
      { enabled: on('cycles'), staleTime: STALE.static },
    ),
  );
  const milestonesQ = useApiQuery(
    apiQueryOptions(
      ['org', orgId, 'milestones'],
      () => api.v1.orgs[':orgId'].milestones.$get({ param: { orgId }, query: {} }),
      'Could not load milestones.',
      { enabled: on('milestones'), staleTime: STALE.static },
    ),
  );
  const milestoneDisplaysQ = useApiQuery(
    apiQueryOptions(
      queryKeys.entityDisplays(orgId, 'milestone'),
      () =>
        api.v1.orgs[':orgId'].display[':subjectType'].$get({
          param: { orgId, subjectType: 'milestone' },
        }),
      'Could not load milestone icons.',
      { enabled: on('milestones'), staleTime: STALE.static },
    ),
  );
  const teamsQ = useApiQuery(
    apiQueryOptions(
      queryKeys.teams(orgId),
      () => api.v1.orgs[':orgId'].teams.$get({ param: { orgId } }),
      'Could not load teams.',
      { enabled: on('teams'), staleTime: STALE.static },
    ),
  );
  const teamDisplaysQ = useApiQuery(
    apiQueryOptions(
      queryKeys.entityDisplays(orgId, 'team'),
      () =>
        api.v1.orgs[':orgId'].display[':subjectType'].$get({
          param: { orgId, subjectType: 'team' },
        }),
      'Could not load team icons.',
      { enabled: on('teams'), staleTime: STALE.static },
    ),
  );

  // Only enabled, first-loading queries contribute (a gated-off query is idle, not loading).
  const loading =
    membersQ.isLoading ||
    agentsQ.isLoading ||
    projectsQ.isLoading ||
    projectDisplaysQ.isLoading ||
    programsQ.isLoading ||
    programDisplaysQ.isLoading ||
    initiativesQ.isLoading ||
    initiativeDisplaysQ.isLoading ||
    labelsQ.isLoading ||
    cyclesQ.isLoading ||
    cycleDisplaysQ.isLoading ||
    milestonesQ.isLoading ||
    milestoneDisplaysQ.isLoading ||
    teamsQ.isLoading ||
    teamDisplaysQ.isLoading;
  const failedKinds = useMemo(() => {
    const failed = new Set<ComposerOptionKind>();
    if (membersQ.isError || agentsQ.isError) failed.add('actors');
    if (projectsQ.isError || projectDisplaysQ.isError) failed.add('projects');
    if (programsQ.isError || programDisplaysQ.isError) failed.add('programs');
    if (initiativesQ.isError || initiativeDisplaysQ.isError) failed.add('initiatives');
    if (labelsQ.isError) failed.add('labels');
    if (cyclesQ.isError || cycleDisplaysQ.isError) failed.add('cycles');
    if (milestonesQ.isError || milestoneDisplaysQ.isError) failed.add('milestones');
    if (teamsQ.isError || teamDisplaysQ.isError) failed.add('teams');
    return failed;
  }, [
    agentsQ.isError,
    cycleDisplaysQ.isError,
    cyclesQ.isError,
    initiativeDisplaysQ.isError,
    initiativesQ.isError,
    labelsQ.isError,
    membersQ.isError,
    milestonesQ.isError,
    milestoneDisplaysQ.isError,
    programDisplaysQ.isError,
    programsQ.isError,
    projectDisplaysQ.isError,
    projectsQ.isError,
    teamsQ.isError,
    teamDisplaysQ.isError,
  ]);
  const retry = useCallback((): void => {
    const requests: Promise<unknown>[] = [];
    if (membersQ.isError) requests.push(membersQ.refetch());
    if (agentsQ.isError) requests.push(agentsQ.refetch());
    if (projectsQ.isError) requests.push(projectsQ.refetch());
    if (projectDisplaysQ.isError) requests.push(projectDisplaysQ.refetch());
    if (programsQ.isError) requests.push(programsQ.refetch());
    if (programDisplaysQ.isError) requests.push(programDisplaysQ.refetch());
    if (initiativesQ.isError) requests.push(initiativesQ.refetch());
    if (initiativeDisplaysQ.isError) requests.push(initiativeDisplaysQ.refetch());
    if (labelsQ.isError) requests.push(labelsQ.refetch());
    if (cyclesQ.isError) requests.push(cyclesQ.refetch());
    if (cycleDisplaysQ.isError) requests.push(cycleDisplaysQ.refetch());
    if (milestonesQ.isError) requests.push(milestonesQ.refetch());
    if (milestoneDisplaysQ.isError) requests.push(milestoneDisplaysQ.refetch());
    if (teamsQ.isError) requests.push(teamsQ.refetch());
    if (teamDisplaysQ.isError) requests.push(teamDisplaysQ.refetch());
    void Promise.all(requests);
  }, [
    agentsQ,
    cyclesQ,
    cycleDisplaysQ,
    initiativeDisplaysQ,
    initiativesQ,
    labelsQ,
    membersQ,
    milestonesQ,
    milestoneDisplaysQ,
    programDisplaysQ,
    programsQ,
    projectDisplaysQ,
    projectsQ,
    teamsQ,
    teamDisplaysQ,
  ]);

  const workflowStatesFor = useCallback(
    async (teamId: string | null): Promise<readonly WorkflowState[]> => {
      if (!teamId) return [];
      try {
        const detail = await queryClient.fetchQuery(
          apiQueryOptions(
            [...queryKeys.team(orgId, teamId), 'workflow'],
            () => api.v1.orgs[':orgId'].teams[':teamId'].$get({ param: { orgId, teamId } }),
            'Could not load the workflow.',
            { staleTime: STALE.static },
          ),
        );
        return detail.workflowStates;
      } catch {
        return [];
      }
    },
    [queryClient, orgId],
  );

  const members = membersQ.data?.items ?? [];
  const agents = agentsQ.data?.items ?? [];
  const projects = projectsQ.data?.items ?? [];
  const projectDisplays = projectDisplaysQ.data?.items ?? [];
  const programs = programsQ.data?.items ?? [];
  const programDisplays = programDisplaysQ.data?.items ?? [];
  const initiatives = initiativesQ.data?.items ?? [];
  const initiativeDisplays = initiativeDisplaysQ.data?.items ?? [];
  const labels = labelsQ.data?.items ?? [];
  const cycles = cyclesQ.data?.items ?? [];
  const cycleDisplays = cycleDisplaysQ.data?.items ?? [];
  const milestones = milestonesQ.data?.items ?? [];
  const milestoneDisplays = milestoneDisplaysQ.data?.items ?? [];
  const teams = teamsQ.data?.items ?? [];
  const teamDisplays = teamDisplaysQ.data?.items ?? [];

  return useMemo(
    () => ({
      actorOptions: actorOptions(members, agents),
      memberOptions: memberActorOptions(members.filter(({ status }) => status === 'active')),
      projectOptions: projectOptions(projects, projectDisplays),
      projects,
      programOptions: programOptions(programs, programDisplays),
      initiativeOptions: initiativeOptions(initiatives, initiativeDisplays),
      labelOptions: labelOptions(labels),
      labels,
      teamOptions: teamOptions(teams, teamDisplays),
      teams,
      cycles,
      cycleDisplays,
      milestones,
      milestoneDisplays,
      loading,
      error: failedKinds.size > 0 ? 'Could not load some property choices.' : null,
      failedKinds,
      retry,
      workflowStatesFor,
    }),
    [
      members,
      agents,
      projects,
      projectDisplays,
      programs,
      programDisplays,
      initiatives,
      initiativeDisplays,
      labels,
      teams,
      teamDisplays,
      cycles,
      cycleDisplays,
      milestones,
      milestoneDisplays,
      loading,
      failedKinds,
      retry,
      workflowStatesFor,
    ],
  );
}
