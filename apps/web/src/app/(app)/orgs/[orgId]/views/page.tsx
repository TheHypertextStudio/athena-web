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
 *    which the {@link FilterBuilder} shows (and lets you tweak) and the {@link ViewRunner}
 *    renders as a grouped task {@link ListView}.
 * 3. **Saves** the current working query as a new view ({@link SaveViewComposer}).
 *
 * Views are *shareable but permission-filtered*: the tasks endpoint returns only work the
 * caller may access, so the runner renders exactly the rows it is handed — a shared view simply
 * shows a viewer fewer tasks, never an error. The screen never re-implements access control.
 *
 * Entity-noun labels (project/program) flow through {@link useVocabulary} so the org's
 * vocabulary skin applies everywhere a field, group header, or filter chip names an entity.
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
  type ViewFilter,
  type ViewGrouping,
  type ViewSort,
} from '@docket/types';
import { LayoutGrid, Plus } from '@docket/ui/icons';
import { useVocabulary } from '@docket/ui/hooks';
import { Button, Separator, Skeleton } from '@docket/ui/primitives';
import { useParams, useRouter } from 'next/navigation';
import { type JSX, useCallback, useEffect, useMemo, useState } from 'react';

import { useActiveOrg } from '@/components/active-org';
import { FilterBuilder } from '@/components/views/filter-builder';
import { SaveViewComposer } from '@/components/views/save-view-composer';
import { type RunnerActor, ViewRunner } from '@/components/views/view-runner';
import { ViewList } from '@/components/views/view-list';
import { fieldSpec } from '@/components/views/view-engine';
import { api } from '@/lib/api';
import { readError, readProblem } from '@/lib/problem';

/** The active working query the builder edits, the runner renders, and the composer saves. */
interface WorkingQuery {
  /** The id of the saved view this query was opened from, or `null` for an ad-hoc query. */
  sourceViewId: string | null;
  /** Active filter predicates. */
  filters: readonly ViewFilter[];
  /** Active grouping, or `null`. */
  grouping: ViewGrouping | null;
  /** Active sort terms. */
  sort: readonly ViewSort[];
}

/** The empty starting query (no filters / grouping / sort). */
const EMPTY_QUERY: WorkingQuery = {
  sourceViewId: null,
  filters: [],
  grouping: null,
  sort: [],
};

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

  const [views, setViews] = useState<readonly SavedViewOut[]>([]);
  const [tasks, setTasks] = useState<readonly TaskOut[]>([]);
  const [projects, setProjects] = useState<readonly ProjectOut[]>([]);
  const [programs, setPrograms] = useState<readonly ProgramOut[]>([]);
  const [members, setMembers] = useState<readonly MemberOut[]>([]);
  const [agents, setAgents] = useState<readonly AgentOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [query, setQuery] = useState<WorkingQuery>(EMPTY_QUERY);
  const [composerOpen, setComposerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  /** Load the org's saved views, plus the tasks + entities used to resolve labels. */
  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    try {
      const [viewsRes, tasksRes, projectsRes, programsRes, membersRes, agentsRes] =
        await Promise.all([
          api.v1.orgs[':orgId']['saved-views'].$get({ param: { orgId } }),
          api.v1.orgs[':orgId'].tasks.$get({ param: { orgId } }),
          api.v1.orgs[':orgId'].projects.$get({ param: { orgId } }),
          api.v1.orgs[':orgId'].programs.$get({ param: { orgId } }),
          api.v1.orgs[':orgId'].members.$get({ param: { orgId } }),
          api.v1.orgs[':orgId'].agents.$get({ param: { orgId } }),
        ]);
      if (!viewsRes.ok) {
        setLoadError(await readProblem(viewsRes, 'Could not load your saved views.'));
        return;
      }
      setViews((await viewsRes.json()).items);
      if (tasksRes.ok) setTasks((await tasksRes.json()).items);
      if (projectsRes.ok) setProjects((await projectsRes.json()).items);
      if (programsRes.ok) setPrograms((await programsRes.json()).items);
      if (membersRes.ok) setMembers((await membersRes.json()).items);
      if (agentsRes.ok) setAgents((await agentsRes.json()).items);
    } catch (caught) {
      setLoadError(readError(caught, 'Something went wrong loading your saved views.'));
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

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

  /** Resolve an entity-id field value to a human label (used by group headers + chips). */
  const resolveLabel = useCallback(
    (field: string, value: string | null): string => {
      if (value === null) return '—';
      if (field === 'projectId') return projectName.get(value) ?? value;
      if (field === 'programId') return programName.get(value) ?? value;
      if (field === 'assigneeId') return actorById.get(value)?.name ?? value;
      return value;
    },
    [actorById, programName, projectName],
  );

  /** Vocabulary-aware label for a field (entity nouns re-skin; others use the catalog label). */
  const fieldLabel = useCallback(
    (field: string, fallback: string): string => {
      if (field === 'projectId') return projectLabel;
      if (field === 'programId') return programLabel;
      return fallback;
    },
    [programLabel, projectLabel],
  );

  /** Vocabulary-aware label for a grouping field (drives the list-row summary). */
  const groupingLabel = useCallback(
    (field: string): string => fieldLabel(field, fieldSpec(field)?.label ?? field),
    [fieldLabel],
  );

  /** A one-line, human summary of the working query for the save composer caption. */
  const querySummary = useMemo(() => {
    const parts: string[] = [];
    parts.push(
      query.filters.length === 0
        ? 'all tasks'
        : `${String(query.filters.length)} filter${query.filters.length === 1 ? '' : 's'}`,
    );
    if (query.grouping) parts.push(`grouped by ${groupingLabel(query.grouping.by).toLowerCase()}`);
    const primarySort = query.sort[0];
    if (primarySort) {
      parts.push(
        `sorted by ${groupingLabel(primarySort.field).toLowerCase()} (${primarySort.order === 'asc' ? 'ascending' : 'descending'})`,
      );
    }
    return parts.join(' · ');
  }, [groupingLabel, query]);

  /** Open a saved view: its stored config becomes the active working query. */
  const openView = useCallback((view: SavedViewOut): void => {
    setComposerOpen(false);
    setSaveError(null);
    setQuery({
      sourceViewId: view.id,
      filters: view.filters,
      grouping: view.grouping ?? null,
      sort: view.sort,
    });
  }, []);

  /** Whether the org has a team id available to attach a team-scoped view to. */
  const canScopeToTeam = useMemo(() => Boolean(defaultTeamId), [defaultTeamId]);

  /** Save the working query as a new saved view and prepend it to the directory. */
  const saveView = useCallback(
    async (payload: SavedViewCreate): Promise<void> => {
      setSaving(true);
      setSaveError(null);
      try {
        const res = await api.v1.orgs[':orgId']['saved-views'].$post({
          param: { orgId },
          json: {
            ...payload,
            ...(payload.scope === 'team' && defaultTeamId
              ? { teamId: TeamId.parse(defaultTeamId) }
              : {}),
          },
        });
        if (!res.ok) {
          setSaveError(await readProblem(res, 'Could not save the view. Please try again.'));
          return;
        }
        const created = await res.json();
        setViews((current) => [created, ...current]);
        setComposerOpen(false);
        setQuery((current) => ({ ...current, sourceViewId: created.id }));
      } catch (caught) {
        setSaveError(readError(caught, 'Something went wrong saving the view.'));
      } finally {
        setSaving(false);
      }
    },
    [orgId, defaultTeamId],
  );

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
        <p role="alert" className="text-destructive text-sm">
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
              <div className="border-outline-variant text-on-surface-variant flex flex-col items-center gap-2 rounded-xl border border-dashed p-8 text-center text-sm">
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
                resolveLabel={resolveLabel}
                groupingLabel={groupingLabel}
              />
            )}
          </section>

          <Separator />

          <section aria-label="Working view" className="flex min-h-0 flex-1 flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-on-surface text-sm font-semibold">
                {openViewName ?? 'New view'}
              </h2>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => {
                  setSaveError(null);
                  setComposerOpen((open) => !open);
                }}
                aria-expanded={composerOpen}
              >
                <Plus className="size-4" aria-hidden="true" />
                Save as view
              </Button>
            </div>

            <FilterBuilder
              filters={query.filters}
              grouping={query.grouping}
              sort={query.sort}
              onFiltersChange={(filters) => {
                setQuery((current) => ({ ...current, filters }));
              }}
              onGroupingChange={(grouping) => {
                setQuery((current) => ({ ...current, grouping }));
              }}
              onSortChange={(sort) => {
                setQuery((current) => ({ ...current, sort }));
              }}
              resolveLabel={resolveLabel}
              fieldLabel={fieldLabel}
            />

            {composerOpen ? (
              <SaveViewComposer
                filters={query.filters}
                grouping={query.grouping}
                sort={query.sort}
                summary={querySummary}
                canScopeToTeam={canScopeToTeam}
                saving={saving}
                error={saveError}
                onSave={(payload) => {
                  void saveView(payload);
                }}
                onCancel={() => {
                  setComposerOpen(false);
                }}
              />
            ) : null}

            <div className="border-outline-variant min-h-64 flex-1 overflow-hidden rounded-xl border">
              <ViewRunner
                tasks={tasks}
                filters={query.filters}
                grouping={query.grouping}
                sort={query.sort}
                resolveActor={resolveActor}
                resolveLabel={resolveLabel}
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
