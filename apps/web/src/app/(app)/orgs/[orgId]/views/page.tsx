'use client';

/**
 * The org "Saved Views" screen (mvp-plan §8.3d).
 *
 * @remarks
 * A Client Component reached at `/orgs/[orgId]/views`, rendered in the app-shell main region
 * (the shell's integrated sidebar already wraps `(app)` routes). A saved view is a
 * stored filter/grouping/sort over the org's tasks, with a sharing {@link ViewScope} (personal
 * / team / org). The screen does three things:
 *
 * 1. **Lists** the org's saved views ({@link ViewList}) — name, scope badge, and a one-line
 *    summary of what each filters/groups.
 * 2. **Opens** a view: its stored `filters`/`grouping`/`sort` become the active working query,
 *    which the unified {@link FilterToolbar} shows (and lets you tweak) and the
 *    {@link ViewRunner} renders as a grouped task {@link ListView}.
 * 3. **Saves** the current working query as a new view ({@link SaveViewComposer}).
 *
 * This screen drives the *same* {@link FilterToolbar} as every entity list, over a task
 * {@link FieldCatalog} ({@link buildTaskCatalog}); the stored saved-view config is bridged to the
 * unified {@link ViewState} via {@link toViewState}/{@link toStoredView}, so opening a view,
 * tweaking it, and saving it round-trips losslessly. Unlike the entity lists, the working query
 * lives in local state (not the URL), because this screen's state is "which saved view is open",
 * not a sticky per-page filter.
 *
 * Views are *shareable but permission-filtered*: the tasks endpoint returns only work the
 * caller may access, so the runner renders exactly the rows it is handed — a shared view simply
 * shows a viewer fewer tasks, never an error. The screen never re-implements access control.
 *
 * Entity-noun labels (project/program) flow through {@link useVocabulary} into the catalog so the
 * org's vocabulary skin applies everywhere a field, group header, or filter chip names an entity.
 * All data is fetched at runtime, so the production build needs no running server.
 */
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
import { LayoutGrid, Plus } from '@docket/ui/icons';
import { useVocabulary } from '@docket/ui/hooks';
import { Button, Separator, Skeleton } from '@docket/ui/primitives';
import { useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { type JSX, useCallback, useMemo, useState } from 'react';

import { useActiveOrg } from '@/components/active-org';
import type { FieldOption, ViewState } from '@/components/views/field-catalog';
import { EMPTY_VIEW_STATE } from '@/components/views/field-catalog';
import { FilterToolbar } from '@/components/views/filter-toolbar';
import { SaveViewComposer } from '@/components/views/save-view-composer';
import { buildTaskCatalog, toStoredView, toViewState } from '@/components/views/task-catalog';
import { type RunnerActor, ViewRunner } from '@/components/views/view-runner';
import { ViewList } from '@/components/views/view-list';
import { findField } from '@/components/views/field-catalog';
import { api } from '@/lib/api';
import { queryKeys, unwrap, useApiMutation, useApiQuery } from '@/lib/query';

/** The active working query the toolbar edits, the runner renders, and the composer saves. */
interface WorkingQuery {
  /** The id of the saved view this query was opened from, or `null` for an ad-hoc query. */
  sourceViewId: string | null;
  /** The unified view state (filters + grouping + sort). */
  state: ViewState;
}

/** The empty starting query (no source view, no filters / grouping / sort). */
const EMPTY_QUERY: WorkingQuery = { sourceViewId: null, state: EMPTY_VIEW_STATE };

/**
 * The org Saved Views screen.
 *
 * @returns the rendered views directory + the open view's filtered task list.
 */
export default function ViewsPage(): JSX.Element {
  const router = useRouter();
  const params = useParams<{ orgId: string }>();
  const orgId = params.orgId;
  const { defaultTeamId } = useActiveOrg();

  const projectLabel = useVocabulary('project');
  const programLabel = useVocabulary('program');
  const viewsLabel = useVocabulary('task', { plural: true });

  const queryClient = useQueryClient();
  const savedViewsKey = queryKeys.savedViews(orgId);

  // The saved-views read governs whether the screen can render; the tasks + entity reads are
  // best-effort overlays used to resolve labels (a failed one just leaves a value un-skinned).
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

  /** Project/program name lookups for resolving entity-id field values to labels. */
  const projectName = useMemo(
    () => new Map<string, string>(projects.map((p) => [p.id, p.name])),
    [projects],
  );
  const programName = useMemo(
    () => new Map<string, string>(programs.map((p) => [p.id, p.name])),
    [programs],
  );

  /** Resolve an actor id to its display descriptor (humans from members, agents flagged). */
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

  /** The task field catalog driving the toolbar, runner, and view-list summaries. */
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

  /** A one-line, human summary of the working query for the save composer caption. */
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

  /** Whether the org has a team id available to attach a team-scoped view to. */
  const canScopeToTeam = useMemo(() => Boolean(defaultTeamId), [defaultTeamId]);

  /** Save the working query as a new saved view and prepend it to the directory. */
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
      // Prepend the created view so it appears instantly; the invalidation below reconciles with
      // the server's authoritative directory. The cache holds the full list body, so map over
      // `.items` while preserving the rest. Open the new view as the working query's source.
      queryClient.setQueryData<NonNullable<typeof viewsQ.data>>(savedViewsKey, (current) =>
        current ? { ...current, items: [created, ...current.items] } : { items: [created] },
      );
      setComposerOpen(false);
      setQuery((current) => ({ ...current, sourceViewId: created.id }));
    },
    invalidateKeys: [savedViewsKey],
  });
  const saving = saveMutation.isPending;
  const saveError = saveMutation.isError ? saveMutation.error.message : null;

  /** Open a saved view: its stored config becomes the active working query. */
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

  /** The stored config the composer captures (derived from the working query state). */
  const storedQuery = useMemo(() => toStoredView(query.state), [query.state]);

  const openViewName = useMemo(
    () => views.find((v) => v.id === query.sourceViewId)?.name ?? null,
    [query.sourceViewId, views],
  );

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-6 p-4 @2xl:p-6 @4xl:p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-on-surface text-xl font-semibold tracking-tight">Views</h1>
        <p className="text-on-surface-variant text-xs">
          Saved filters over your {viewsLabel.toLowerCase()} — open one, tweak it, or save the
          current filter as a new view. Shared views show each person only the work they can see.
        </p>
      </header>

      {loading ? (
        <div className="flex flex-col gap-3" aria-hidden="true">
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-16 w-full rounded-lg" />
        </div>
      ) : loadError ? (
        <p role="alert" className="text-destructive text-body">
          {loadError}
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          <section aria-label="Saved views" className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-on-surface-variant text-xs font-medium">
                {views.length === 0 ? 'No saved views yet' : `${String(views.length)} saved`}
              </h2>
            </div>
            {views.length === 0 ? (
              <div className="border-outline-variant text-on-surface-variant text-body flex flex-col items-center gap-2 rounded-xl border border-dashed p-8 text-center">
                <LayoutGrid className="size-6 opacity-60" aria-hidden="true" />
                <p>
                  Build a filter below and save it to create your first view. Views can stay
                  personal or be shared with your team or organization.
                </p>
              </div>
            ) : (
              <ViewList
                views={views}
                activeId={query.sourceViewId}
                onOpen={openView}
                catalog={catalog}
              />
            )}
          </section>

          <Separator />

          <section aria-label="Working view" className="flex min-h-0 flex-1 flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-on-surface text-body font-semibold">
                {openViewName ?? 'New view'}
              </h2>
            </div>

            <FilterToolbar
              catalog={catalog}
              state={query.state}
              onFiltersChange={(filters) => {
                setQuery((current) => ({ ...current, state: { ...current.state, filters } }));
              }}
              onGroupByChange={(groupBy) => {
                setQuery((current) => ({ ...current, state: { ...current.state, groupBy } }));
              }}
              onSortChange={(sort) => {
                setQuery((current) => ({ ...current, state: { ...current.state, sort } }));
              }}
              saveSlot={
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => {
                    saveMutation.reset();
                    setComposerOpen((open) => !open);
                  }}
                  aria-expanded={composerOpen}
                >
                  <Plus className="size-3.5" aria-hidden="true" />
                  Save as view
                </Button>
              }
            />

            {composerOpen ? (
              <SaveViewComposer
                filters={storedQuery.filters}
                grouping={storedQuery.grouping}
                sort={storedQuery.sort}
                summary={querySummary}
                canScopeToTeam={canScopeToTeam}
                saving={saving}
                error={saveError}
                onSave={(payload) => {
                  saveMutation.mutate(payload);
                }}
                onCancel={() => {
                  setComposerOpen(false);
                }}
              />
            ) : null}

            <div className="border-outline-variant min-h-64 flex-1 overflow-hidden rounded-xl border">
              <ViewRunner
                tasks={tasks}
                state={query.state}
                catalog={catalog}
                resolveActor={resolveActor}
                label={openViewName ?? 'Working view tasks'}
                onOpenTask={(taskId) => {
                  router.push(`/orgs/${orgId}/tasks/${taskId}`);
                }}
              />
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
