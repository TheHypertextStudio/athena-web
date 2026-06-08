'use client';

/**
 * Fetch the org-scoped option sources a create composer needs, once, when it opens.
 *
 * @remarks
 * The robust create composers ({@link CreateTaskDialog}, {@link CreateProjectDialog}, …) front a
 * row of compact property pickers — assignee, project, program, lead, labels — whose choices come
 * from the org's rosters. Rather than have each composer fan out its own `useEffect`s, this hook
 * loads the lists it is asked for (gated by the `enabled` flag so a closed dialog fetches nothing)
 * and hands back ready-to-use {@link PickerOption} arrays plus a `loading` flag. Every list is
 * optional via the `include` set so a composer pays only for what it shows (the project composer
 * needs members + programs + initiatives; the task composer needs members + projects + labels).
 *
 * Workflow states are *per team*, not org-global, so they are exposed through a memoized
 * {@link ComposerOptions.workflowStatesFor} loader the task composer calls when its team changes.
 *
 * @see {@link actorOptions} and friends for the pure DTO→option mappers this composes.
 */
import type {
  AgentOut,
  CycleOut,
  InitiativeOut,
  LabelOut,
  MemberOut,
  ProgramOut,
  ProjectOut,
  WorkflowState,
} from '@docket/types';
import type { PickerOption } from '@docket/ui/components';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '@/lib/api';
import {
  actorOptions,
  initiativeOptions,
  labelOptions,
  programOptions,
  projectOptions,
} from '@/components/pickers/options';

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
  const [members, setMembers] = useState<readonly MemberOut[]>([]);
  const [agents, setAgents] = useState<readonly AgentOut[]>([]);
  const [projects, setProjects] = useState<readonly ProjectOut[]>([]);
  const [programs, setPrograms] = useState<readonly ProgramOut[]>([]);
  const [initiatives, setInitiatives] = useState<readonly InitiativeOut[]>([]);
  const [labels, setLabels] = useState<readonly LabelOut[]>([]);
  const [cycles, setCycles] = useState<readonly CycleOut[]>([]);
  const [loading, setLoading] = useState(false);

  // A stable string key so the effect re-runs only when the *set* of lists changes, not on every
  // render that passes a fresh array literal.
  const includeKey = useMemo(() => [...new Set(include)].sort().join(','), [include]);

  useEffect(() => {
    if (!enabled) return;
    const wanted = new Set(includeKey.split(',').filter(Boolean) as ComposerOptionKind[]);
    if (wanted.size === 0) return;
    const live = { current: true };
    setLoading(true);
    void (async () => {
      try {
        const tasks: Promise<void>[] = [];
        if (wanted.has('actors')) {
          tasks.push(
            (async () => {
              const [membersRes, agentsRes] = await Promise.all([
                api.v1.orgs[':orgId'].members.$get({ param: { orgId } }),
                api.v1.orgs[':orgId'].agents.$get({ param: { orgId } }),
              ]);
              if (live.current && membersRes.ok) setMembers((await membersRes.json()).items);
              if (live.current && agentsRes.ok) setAgents((await agentsRes.json()).items);
            })(),
          );
        }
        if (wanted.has('projects')) {
          tasks.push(
            (async () => {
              const res = await api.v1.orgs[':orgId'].projects.$get({ param: { orgId } });
              if (live.current && res.ok) setProjects((await res.json()).items);
            })(),
          );
        }
        if (wanted.has('programs')) {
          tasks.push(
            (async () => {
              const res = await api.v1.orgs[':orgId'].programs.$get({ param: { orgId } });
              if (live.current && res.ok) setPrograms((await res.json()).items);
            })(),
          );
        }
        if (wanted.has('initiatives')) {
          tasks.push(
            (async () => {
              const res = await api.v1.orgs[':orgId'].initiatives.$get({ param: { orgId } });
              if (live.current && res.ok) setInitiatives((await res.json()).items);
            })(),
          );
        }
        if (wanted.has('labels')) {
          tasks.push(
            (async () => {
              const res = await api.v1.orgs[':orgId'].labels.$get({ param: { orgId } });
              if (live.current && res.ok) setLabels((await res.json()).items);
            })(),
          );
        }
        if (wanted.has('cycles')) {
          tasks.push(
            (async () => {
              const res = await api.v1.orgs[':orgId'].cycles.$get({ param: { orgId } });
              if (live.current && res.ok) setCycles((await res.json()).items);
            })(),
          );
        }
        await Promise.all(tasks);
      } finally {
        if (live.current) setLoading(false);
      }
    })();
    return () => {
      live.current = false;
    };
  }, [orgId, includeKey, enabled]);

  // Cache workflow-state reads per team so re-picking the same team is free.
  const workflowCache = useRef(new Map<string, readonly WorkflowState[]>());
  const workflowStatesFor = useCallback(
    async (teamId: string | null): Promise<readonly WorkflowState[]> => {
      if (!teamId) return [];
      const cached = workflowCache.current.get(teamId);
      if (cached) return cached;
      const res = await api.v1.orgs[':orgId'].teams[':teamId'].$get({
        param: { orgId, teamId },
      });
      if (!res.ok) return [];
      const detail = await res.json();
      const states = detail.workflowStates;
      workflowCache.current.set(teamId, states);
      return states;
    },
    [orgId],
  );

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
