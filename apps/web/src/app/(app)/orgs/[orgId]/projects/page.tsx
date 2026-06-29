'use client';

/**
 * The org Projects list — the roster of bounded efforts (§8.4).
 *
 * @remarks
 * A Client Component reached at `/orgs/[orgId]/projects`. A Project is a *bounded* effort, so the
 * roster renders through the shared {@link EntityTable}: a leading lifecycle status glyph, a
 * flexing **Title** column, and the project's key properties — status, lead, health, target date,
 * and task scope — in **aligned** columns under a light header. This is the same column-aligned
 * surface Initiatives (and, later, Tasks) render through, so a project roster and an initiative
 * roster share one visual hierarchy (the user's mandate: "structured the same … just like Linear");
 * only the trailing property columns differ a little per entity.
 *
 * Columns are derived from the project {@link buildProjectCatalog | catalog} where natural
 * ({@link projectColumns}), so the toolbar's groupable/sortable fields and the table's headers read
 * from one source of truth. The {@link FilterToolbar} stays mounted above the table over the same
 * catalog: the roster can be filtered by status / health / lead / team, grouped, and sorted — all
 * applied **client-side** over the already-loaded {@link useApiQuery} results (Phase B data flow is
 * preserved; no manual refresh). The view state is held in the URL by {@link useViewState}, so a
 * filtered roster is shareable and survives a reload. Grouping renders full-width
 * {@link GroupHeader} boundary rows that span every column.
 *
 * It composes three slices through the dynamic-data layer — projects, tasks, and members — so each
 * stays live (auto-refetch on focus + after a create) and rolls up the per-project task count
 * client-side. Members + teams name each project's lead and team; entity nouns route through
 * {@link useVocabulary}; data is fetched at runtime so the production build needs no running server.
 */
import type { ProjectOut } from '@docket/types';
import { EmptyState, EntityTable, StatusIcon } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { FolderKanban, Plus } from '@docket/ui/icons';
import { Button, Skeleton } from '@docket/ui/primitives';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { type JSX, useCallback, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { useActiveOrg } from '@/components/active-org';
import { CreateProjectDialog } from '@/components/projects/create-project';
import { buildProjectCatalog, projectColumns } from '@/components/projects/project-catalog';
import { statusGlyphType } from '@/components/projects/project-status';
import { applyView, EMPTY_GROUP_ID } from '@/components/views/apply-view';
import type { FieldOption } from '@/components/views/field-catalog';
import { FilterToolbar } from '@/components/views/filter-toolbar';
import { useViewState } from '@/components/views/use-view-state';
import { api } from '@/lib/api';
import { apiQueryOptions, queryKeys, useApiQuery } from '@/lib/query';

/**
 * The Projects list page.
 *
 * @returns the rendered roster.
 */
export default function ProjectsListPage(): JSX.Element {
  const router = useRouter();
  const params = useParams<{ orgId: string }>();
  const orgId = params.orgId;

  const { teams, defaultTeamId, teamsLoading } = useActiveOrg();
  const queryClient = useQueryClient();

  const projectLabel = useVocabulary('project');
  const projectsLabel = useVocabulary('project', { plural: true });
  const teamLabel = useVocabulary('team');
  const taskNoun = useVocabulary('task').toLowerCase();
  const taskNounPlural = useVocabulary('task', { plural: true }).toLowerCase();

  const [createOpen, setCreateOpen] = useState(false);
  const { state, setFilters, setGroupBy, setSort } = useViewState();

  // The roster is the primary slice (its load gates the page); tasks + members enrich each row
  // and degrade gracefully (an empty list) if they fail, mirroring the prior behavior.
  const projectsQ = useApiQuery(
    apiQueryOptions(
      queryKeys.projects(orgId),
      () => api.v1.orgs[':orgId'].projects.$get({ param: { orgId } }),
      `Could not load ${projectsLabel.toLowerCase()}.`,
    ),
  );
  const tasksQ = useApiQuery(
    apiQueryOptions(
      queryKeys.tasks(orgId),
      () => api.v1.orgs[':orgId'].tasks.$get({ param: { orgId } }),
      'Could not load tasks.',
    ),
  );
  const membersQ = useApiQuery(
    apiQueryOptions(
      queryKeys.members(orgId),
      () => api.v1.orgs[':orgId'].members.$get({ param: { orgId } }),
      'Could not load members.',
    ),
  );

  const projects = useMemo(() => projectsQ.data?.items ?? [], [projectsQ.data]);
  const tasks = useMemo(() => tasksQ.data?.items ?? [], [tasksQ.data]);
  const members = useMemo(() => membersQ.data?.items ?? [], [membersQ.data]);

  const loading = projectsQ.isPending;
  const loadError = projectsQ.isError ? projectsQ.error.message : null;

  /** Lead display name by actor id (for the lead column + filter labels). */
  const leadNameById = useMemo(
    () => new Map<string, string>(members.map((m) => [m.actorId, m.displayName])),
    [members],
  );
  /** Team display name by id (for the team filter labels + group headers). */
  const teamNameById = useMemo(
    () => new Map<string, string>(teams.map((t) => [t.id, t.name])),
    [teams],
  );

  /** Per-project task counts (a task belongs via `task.projectId`). */
  const taskCountByProject = useMemo(() => {
    const counts = new Map<string, number>();
    for (const task of tasks) {
      if (task.projectId) counts.set(task.projectId, (counts.get(task.projectId) ?? 0) + 1);
    }
    return counts;
  }, [tasks]);

  /** The project field catalog driving the toolbar + the apply engine + the table columns. */
  const catalog = useMemo(
    () =>
      buildProjectCatalog({
        leadLabel: 'Lead',
        teamLabel,
        leadOptions: (): readonly FieldOption[] =>
          members.map((m) => ({ value: m.actorId, label: m.displayName })),
        resolveLead: (id) => leadNameById.get(id) ?? id,
        teamOptions: (): readonly FieldOption[] =>
          teams.map((t) => ({ value: t.id, label: t.name })),
        resolveTeam: (id) => teamNameById.get(id) ?? id,
      }),
    [leadNameById, members, teamLabel, teamNameById, teams],
  );

  /** The aligned table columns, derived from the same catalog the toolbar drives. */
  const columns = useMemo(
    () =>
      projectColumns(catalog, {
        taskCountFor: (project) => taskCountByProject.get(project.id) ?? 0,
        taskNoun,
        taskNounPlural,
      }),
    [catalog, taskCountByProject, taskNoun, taskNounPlural],
  );

  /** Filter + sort + group the loaded roster client-side per the active view state. */
  const applied = useMemo(() => applyView(projects, state, catalog), [projects, state, catalog]);

  /** Map an `applyView` bucket onto an {@link EntityTable} group (status buckets carry a glyph). */
  const groups = useMemo(() => {
    if (!applied.groups) return undefined;
    const isStatusGroup = state.groupBy?.field === 'status';
    return applied.groups.map((group) => ({
      id: group.id,
      label: group.label,
      decoration:
        isStatusGroup && group.id !== EMPTY_GROUP_ID ? (
          <StatusIcon type={statusGlyphType(group.id)} label={group.label} />
        ) : undefined,
      rows: group.rows,
    }));
  }, [applied.groups, state.groupBy]);

  /**
   * Refetch the roster from the server (prefix-matched, so this also refreshes any open
   * project-detail beneath it), then open the freshly-created project's detail.
   */
  const handleCreated = useCallback(
    (created: ProjectOut): void => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects(orgId) });
      router.push(`/orgs/${orgId}/projects/${created.id}`);
    },
    [orgId, router, queryClient],
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 @2xl:p-6 @4xl:p-8">
      <header className="flex flex-col gap-3 @2xl:flex-row @2xl:flex-wrap @2xl:items-center @2xl:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-on-surface text-h1">{projectsLabel}</h1>
          <p className="text-on-surface-variant text-xs">
            Bounded efforts with a finish line — tracked by status, health, and scope.
          </p>
        </div>
        <Button
          type="button"
          className="gap-1.5"
          onClick={() => {
            setCreateOpen(true);
          }}
        >
          <Plus aria-hidden="true" className="size-4" />
          New {projectLabel}
        </Button>
      </header>

      <CreateProjectDialog
        orgId={orgId}
        projectNoun={projectLabel}
        teams={teams}
        defaultTeamId={defaultTeamId}
        teamsLoading={teamsLoading}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={handleCreated}
      />

      {!loading && !loadError && projects.length > 0 ? (
        <FilterToolbar
          catalog={catalog}
          state={state}
          onFiltersChange={setFilters}
          onGroupByChange={setGroupBy}
          onSortChange={setSort}
        />
      ) : null}

      {loading ? (
        <ListSkeleton />
      ) : loadError ? (
        <p
          role="alert"
          className="border-outline-variant text-destructive text-body rounded-xl border p-4"
        >
          {loadError}
        </p>
      ) : projects.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title={`No ${projectsLabel.toLowerCase()} yet`}
          body={`${projectsLabel} are bounded efforts with a clear finish line. Create one to start tracking its status, health, and scope.`}
          cta={{
            label: `Create your first ${projectLabel.toLowerCase()}`,
            onClick: () => {
              setCreateOpen(true);
            },
          }}
        />
      ) : applied.rows.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title={`No matching ${projectsLabel.toLowerCase()}`}
          body={`No ${projectLabel.toLowerCase()} matches the active filters. Adjust or clear them to see more.`}
        />
      ) : (
        <EntityTable
          aria-label={projectsLabel}
          columns={columns}
          groups={groups}
          rows={applied.rows}
          getRowKey={(project) => project.id}
          rowHref={(project) => `/orgs/${orgId}/projects/${project.id}`}
          renderRowLink={(lp) => (
            <Link
              href={lp.href}
              className={lp.className}
              onClick={lp.onClick}
              tabIndex={lp.tabIndex}
              aria-current={lp['aria-current']}
            >
              {lp.children}
            </Link>
          )}
        />
      )}
    </div>
  );
}

/** Loading placeholder: a bordered list of slim row skeletons matching the table density. */
function ListSkeleton(): JSX.Element {
  return (
    <div
      className="border-outline-variant divide-outline-variant flex flex-col divide-y overflow-hidden rounded-xl border"
      aria-hidden="true"
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex min-h-9 items-center gap-2 px-3 py-1.5">
          <Skeleton className="size-3.5 rounded-full" />
          <Skeleton className="h-4 w-48" />
          <Skeleton className="ml-auto h-4 w-24" />
        </div>
      ))}
    </div>
  );
}
