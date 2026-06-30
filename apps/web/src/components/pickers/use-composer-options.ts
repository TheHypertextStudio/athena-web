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
import type { CycleOut, WorkflowState } from '@docket/types';
import type { PickerOption } from '@docket/ui/components';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import {
  actorOptions,
  initiativeOptions,
  labelOptions,
  programOptions,
  projectOptions,
} from '@/components/pickers/options';
import { api } from '@/lib/api';
import { STALE, apiQueryOptions, queryKeys, useApiQuery } from '@/lib/query';

/** The org-scoped option lists a composer can opt into loading. */
export type ComposerOptionKind =
  | 'actors'
  | 'projects'
  | 'programs'
  | 'initiatives'
  | 'labels'
  | 'cycles';

/** The resolved option arrays + loaders returned by {@link useComposerOptions}. */
export interface ComposerOptions {
  /** Searchable actor options (org members + agents), for assignee / lead / owner pickers. */
  readonly actorOptions: readonly PickerOption[];
  /** Project entity options. */
  readonly projectOptions: readonly PickerOption[];
  /** Program entity options. */
  readonly programOptions: readonly PickerOption[];
  /** Initiative entity options. */
  readonly initiativeOptions: readonly PickerOption[];
  /** Label multi-select options (each with its color swatch). */
  readonly labelOptions: readonly PickerOption[];
  /** The org's raw cycles (each carries its `teamId` so callers can scope to a team). */
  readonly cycles: readonly CycleOut[];
  /** Whether any requested list is still loading. */
  readonly loading: boolean;
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
  const programsQ = useApiQuery(
    apiQueryOptions(
      queryKeys.programs(orgId),
      () => api.v1.orgs[':orgId'].programs.$get({ param: { orgId }, query: {} }),
      'Could not load programs.',
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
  const labelsQ = useApiQuery(
    apiQueryOptions(
      ['org', orgId, 'labels'],
      () => api.v1.orgs[':orgId'].labels.$get({ param: { orgId } }),
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

  // Only enabled, first-loading queries contribute (a gated-off query is idle, not loading).
  const loading =
    membersQ.isLoading ||
    agentsQ.isLoading ||
    projectsQ.isLoading ||
    programsQ.isLoading ||
    initiativesQ.isLoading ||
    labelsQ.isLoading ||
    cyclesQ.isLoading;

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
  const programs = programsQ.data?.items ?? [];
  const initiatives = initiativesQ.data?.items ?? [];
  const labels = labelsQ.data?.items ?? [];
  const cycles = cyclesQ.data?.items ?? [];

  return useMemo(
    () => ({
      actorOptions: actorOptions(members, agents),
      projectOptions: projectOptions(projects),
      programOptions: programOptions(programs),
      initiativeOptions: initiativeOptions(initiatives),
      labelOptions: labelOptions(labels),
      cycles,
      loading,
      workflowStatesFor,
    }),
    [members, agents, projects, programs, initiatives, labels, cycles, loading, workflowStatesFor],
  );
}
