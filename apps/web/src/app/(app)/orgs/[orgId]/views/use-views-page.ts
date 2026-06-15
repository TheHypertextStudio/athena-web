'use client';

import {
  type AgentOut,
  type MemberOut,
  type ProgramOut,
  type ProjectOut,
  type SavedViewCreate,
  type SavedViewOut,
  type TaskOut,
  TeamId,
} from '@docket/types';
import { useVocabulary } from '@docket/ui/hooks';
import { useQueryClient } from '@tanstack/react-query';
import { type Dispatch, type SetStateAction, useCallback, useMemo, useState } from 'react';

import { useActiveOrg } from '@/components/active-org';
import type { FieldOption, ViewState } from '@/components/views/field-catalog';
import { EMPTY_VIEW_STATE, findField } from '@/components/views/field-catalog';
import { buildTaskCatalog, toStoredView, toViewState } from '@/components/views/task-catalog';
import type { RunnerActor } from '@/components/views/view-runner';
import { api } from '@/lib/api';
import { queryKeys, unwrap, useApiMutation, useApiQuery } from '@/lib/query';

/** The active working query the toolbar edits, the runner renders, and the composer saves. */
interface WorkingQuery {
  sourceViewId: string | null;
  state: ViewState;
}

const EMPTY_QUERY: WorkingQuery = { sourceViewId: null, state: EMPTY_VIEW_STATE };

/** All state, data, and actions the Views page needs. */
export interface ViewsPageData {
  views: readonly SavedViewOut[];
  tasks: readonly TaskOut[];
  loading: boolean;
  loadError: string | null;
  viewsLabel: string;
  query: WorkingQuery;
  setQuery: Dispatch<SetStateAction<WorkingQuery>>;
  composerOpen: boolean;
  setComposerOpen: Dispatch<SetStateAction<boolean>>;
  catalog: ReturnType<typeof buildTaskCatalog>;
  querySummary: string;
  canScopeToTeam: boolean;
  saving: boolean;
  saveError: string | null;
  save: (payload: SavedViewCreate) => void;
  resetSave: () => void;
  openView: (view: SavedViewOut) => void;
  storedQuery: ReturnType<typeof toStoredView>;
  openViewName: string | null;
  resolveActor: (actorId: string) => RunnerActor | null;
}

/** useViewsPage coordinates saved views state, loading, and mutations for its screen. */
export function useViewsPage(orgId: string): ViewsPageData {
  const { defaultTeamId } = useActiveOrg();
  const projectLabel = useVocabulary('project');
  const programLabel = useVocabulary('program');
  const viewsLabel = useVocabulary('task', { plural: true });
  const queryClient = useQueryClient();
  const savedViewsKey = queryKeys.savedViews(orgId);

  const viewsQ = useApiQuery(
    savedViewsKey,
    () => api.v1.orgs[':orgId']['saved-views'].$get({ param: { orgId } }),
    'Could not load your saved views.',
  );
  const tasksQ = useApiQuery(
    queryKeys.tasks(orgId),
    () => api.v1.orgs[':orgId'].tasks.$get({ param: { orgId } }),
    'Could not load tasks.',
  );
  const projectsQ = useApiQuery(
    queryKeys.projects(orgId),
    () => api.v1.orgs[':orgId'].projects.$get({ param: { orgId } }),
    'Could not load projects.',
  );
  const programsQ = useApiQuery(
    queryKeys.programs(orgId),
    () => api.v1.orgs[':orgId'].programs.$get({ param: { orgId } }),
    'Could not load programs.',
  );
  const membersQ = useApiQuery(
    queryKeys.members(orgId),
    () => api.v1.orgs[':orgId'].members.$get({ param: { orgId } }),
    'Could not load members.',
  );
  const agentsQ = useApiQuery(
    queryKeys.agents(orgId),
    () => api.v1.orgs[':orgId'].agents.$get({ param: { orgId } }),
    'Could not load agents.',
  );

  const views: readonly SavedViewOut[] = viewsQ.data?.items ?? [];
  const tasks: readonly TaskOut[] = tasksQ.data?.items ?? [];
  const projects: readonly ProjectOut[] = projectsQ.data?.items ?? [];
  const programs: readonly ProgramOut[] = programsQ.data?.items ?? [];
  const members: readonly MemberOut[] = membersQ.data?.items ?? [];
  const agents: readonly AgentOut[] = agentsQ.data?.items ?? [];
  const loading = viewsQ.isPending;
  const loadError = viewsQ.isError ? viewsQ.error.message : null;

  const [query, setQuery] = useState<WorkingQuery>(EMPTY_QUERY);
  const [composerOpen, setComposerOpen] = useState(false);

  const projectName = useMemo(
    () => new Map<string, string>(projects.map((p) => [p.id, p.name])),
    [projects],
  );
  const programName = useMemo(
    () => new Map<string, string>(programs.map((p) => [p.id, p.name])),
    [programs],
  );

  const actorById = useMemo(() => {
    const byId = new Map<string, RunnerActor>();
    for (const member of members) {
      byId.set(member.actorId, {
        name: member.displayName,
        kind: 'human',
        avatarUrl: member.avatar,
      });
    }
    const agentActorIds = new Set(agents.map((a) => a.actorId));
    for (const id of agentActorIds) {
      const existing = byId.get(id);
      byId.set(id, existing ? { ...existing, kind: 'agent' } : { name: 'Agent', kind: 'agent' });
    }
    return byId;
  }, [agents, members]);

  const resolveActor = useCallback(
    (actorId: string): RunnerActor | null => actorById.get(actorId) ?? null,
    [actorById],
  );

  const catalog = useMemo(
    () =>
      buildTaskCatalog({
        projectLabel,
        programLabel,
        resolveProject: (id) => projectName.get(id) ?? id,
        resolveProgram: (id) => programName.get(id) ?? id,
        resolveAssignee: (id) => actorById.get(id)?.name ?? id,
        assigneeOptions: (): readonly FieldOption[] =>
          [...actorById.entries()].map(([value, actor]) => ({ value, label: actor.name })),
        projectOptions: (): readonly FieldOption[] =>
          projects.map((p) => ({ value: p.id, label: p.name })),
        programOptions: (): readonly FieldOption[] =>
          programs.map((p) => ({ value: p.id, label: p.name })),
      }),
    [actorById, programLabel, programName, programs, projectLabel, projectName, projects],
  );

  const querySummary = useMemo(() => {
    const { state } = query;
    const parts: string[] = [];
    parts.push(
      state.filters.length === 0
        ? 'all tasks'
        : `${String(state.filters.length)} filter${state.filters.length === 1 ? '' : 's'}`,
    );
    if (state.groupBy) {
      const label = findField(catalog, state.groupBy.field)?.label ?? state.groupBy.field;
      parts.push(`grouped by ${label.toLowerCase()}`);
    }
    const primarySort = state.sort[0];
    if (primarySort) {
      const label = findField(catalog, primarySort.field)?.label ?? primarySort.field;
      parts.push(
        `sorted by ${label.toLowerCase()} (${primarySort.dir === 'asc' ? 'ascending' : 'descending'})`,
      );
    }
    return parts.join(' · ');
  }, [catalog, query]);

  const canScopeToTeam = useMemo(() => Boolean(defaultTeamId), [defaultTeamId]);

  const saveMutation = useApiMutation({
    mutationFn: (payload: SavedViewCreate) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId']['saved-views'].$post({
            param: { orgId },
            json: {
              ...payload,
              ...(payload.scope === 'team' && defaultTeamId
                ? { teamId: TeamId.parse(defaultTeamId) }
                : {}),
            },
          }),
        'Could not save the view. Please try again.',
      ),
    onSuccess: (created) => {
      queryClient.setQueryData<NonNullable<typeof viewsQ.data>>(savedViewsKey, (current) =>
        current ? { ...current, items: [created, ...current.items] } : { items: [created] },
      );
      setComposerOpen(false);
      setQuery((current) => ({ ...current, sourceViewId: created.id }));
    },
    invalidateKeys: [savedViewsKey],
  });

  const openView = useCallback(
    (view: SavedViewOut): void => {
      setComposerOpen(false);
      saveMutation.reset();
      setQuery({
        sourceViewId: view.id,
        state: toViewState({
          filters: view.filters,
          grouping: view.grouping ?? null,
          sort: view.sort,
        }),
      });
    },
    [saveMutation],
  );

  const storedQuery = useMemo(() => toStoredView(query.state), [query.state]);
  const openViewName = useMemo(
    () => views.find((v) => v.id === query.sourceViewId)?.name ?? null,
    [query.sourceViewId, views],
  );

  return {
    views,
    tasks,
    loading,
    loadError,
    viewsLabel,
    query,
    setQuery,
    composerOpen,
    setComposerOpen,
    catalog,
    querySummary,
    canScopeToTeam,
    saving: saveMutation.isPending,
    saveError: saveMutation.isError ? saveMutation.error.message : null,
    save: (payload) => {
      saveMutation.mutate(payload);
    },
    resetSave: () => {
      saveMutation.reset();
    },
    openView,
    storedQuery,
    openViewName,
    resolveActor,
  };
}
