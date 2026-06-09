'use client';

import type { TeamOut } from '@docket/types';
import { EmptyState, EntityList, EntityListRow, RowMeta } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { FolderKanban, ListChecks, Plus, Users, Workflow } from '@docket/ui/icons';
import { Badge, Button, Skeleton } from '@docket/ui/primitives';
import { useParams } from 'next/navigation';
import { type JSX, useCallback, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { CreateTeamDialog } from '@/components/teams/create-team';
import { buildTeamCatalog } from '@/components/teams/team-catalog';
import { applyView } from '@/components/views/apply-view';
import { FilterToolbar } from '@/components/views/filter-toolbar';
import { useViewState } from '@/components/views/use-view-state';
import { api } from '@/lib/api';
import { queryKeys, useApiQuery } from '@/lib/query';

/** The row view-model derived for one Team (scope + workflow roll-up). */
interface TeamRow {
  team: TeamOut;
  projectCount: number;
  taskCount: number;
  workflowStateCount: number;
}

/**
 * The org Teams list — the roster of first-class units within the org (§7), as dense rows.
 *
 * @remarks
 * A Client Component reached at `/orgs/[orgId]/teams`. A Team owns its own workflow states,
 * cycles, and Triage queue ({@link TeamOut}); each {@link EntityListRow} leads with the team
 * `key` as a monospace chip and surfaces the team name, its workflow-state count, and its scope
 * roll-up ("N projects" + "M tasks"), with a Triage {@link Badge} in the trailing slot when the
 * queue is enabled. The former card grid is replaced by one clean bordered list of
 * hairline-divided rows (design-system §5.1). The rows are *presentational* (`interactive`
 * disabled): there is no team-detail screen yet, so a row deliberately offers no click target
 * that would 404 — mirroring the old non-interactive card.
 *
 * It composes three slices through the dynamic-data layer — teams, projects, and tasks — so each
 * stays live (auto-refetch on focus + after a create) without a manual refresh control, and rolls
 * up the per-team scope client-side (a project belongs via `project.teamId`; a task belongs via
 * `task.teamId`) so the roster renders without an N-round-trip detail fan-out.
 *
 * Filtering is the unified engine: a single {@link FilterToolbar} over the team
 * {@link buildTeamCatalog | catalog} lets the roster be filtered by triage state, grouped, and
 * sorted (by triage, workflow-state count, key, or name) — all applied **client-side** over the
 * already-loaded {@link useApiQuery} results (Phase B data flow is preserved; no manual refresh).
 * The view state is held in the URL by {@link useViewState}, so a filtered roster is shareable and
 * survives a reload. Entity nouns route through {@link useVocabulary}; data is fetched at runtime
 * so the production build needs no running server.
 */
export default function TeamsListPage(): JSX.Element {
  const params = useParams<{ orgId: string }>();
  const orgId = params.orgId;
  const queryClient = useQueryClient();

  const projectNoun = useVocabulary('project').toLowerCase();
  const projectNounPlural = useVocabulary('project', { plural: true }).toLowerCase();
  const taskNoun = useVocabulary('task').toLowerCase();
  const taskNounPlural = useVocabulary('task', { plural: true }).toLowerCase();

  const [createOpen, setCreateOpen] = useState(false);
  const { state, setFilters, setGroupBy, setSort } = useViewState();

  // The roster is the primary slice (its load gates the page); projects + tasks enrich each row's
  // scope roll-up and degrade gracefully (an empty list) if they fail, mirroring prior behavior.
  const teamsQ = useApiQuery(
    queryKeys.teams(orgId),
    () => api.v1.orgs[':orgId'].teams.$get({ param: { orgId } }),
    'Could not load your teams.',
  );
  const projectsQ = useApiQuery(
    queryKeys.projects(orgId),
    () => api.v1.orgs[':orgId'].projects.$get({ param: { orgId } }),
    'Could not load projects.',
  );
  const tasksQ = useApiQuery(
    queryKeys.tasks(orgId),
    () => api.v1.orgs[':orgId'].tasks.$get({ param: { orgId } }),
    'Could not load tasks.',
  );

  const teams = useMemo(() => teamsQ.data?.items ?? [], [teamsQ.data]);
  const projects = useMemo(() => projectsQ.data?.items ?? [], [projectsQ.data]);
  const tasks = useMemo(() => tasksQ.data?.items ?? [], [tasksQ.data]);

  const loading = teamsQ.isPending;
  const loadError = teamsQ.isError ? teamsQ.error.message : null;

  /** Per-team project counts (a project belongs via `project.teamId`). */
  const projectCountByTeam = useMemo(() => {
    const counts = new Map<string, number>();
    for (const project of projects) {
      if (project.teamId) counts.set(project.teamId, (counts.get(project.teamId) ?? 0) + 1);
    }
    return counts;
  }, [projects]);

  /** Per-team task counts (a task belongs via `task.teamId`). */
  const taskCountByTeam = useMemo(() => {
    const counts = new Map<string, number>();
    for (const task of tasks) {
      counts.set(task.teamId, (counts.get(task.teamId) ?? 0) + 1);
    }
    return counts;
  }, [tasks]);

  /** The team field catalog driving the toolbar + the apply engine. */
  const catalog = useMemo(() => buildTeamCatalog(), []);

  /** Filter + sort + group the loaded roster client-side per the active view state. */
  const applied = useMemo(() => applyView(teams, state, catalog), [teams, state, catalog]);

  /** Adapt a team to its dense-row view-model (scope + workflow roll-up). */
  const toRow = useCallback(
    (team: TeamOut): TeamRow => ({
      team,
      projectCount: projectCountByTeam.get(team.id) ?? 0,
      taskCount: taskCountByTeam.get(team.id) ?? 0,
      workflowStateCount: team.workflowStates?.length ?? 0,
    }),
    [projectCountByTeam, taskCountByTeam],
  );

  /** Refetch the roster from the server (teams have no detail route to open), then close the dialog. */
  const handleCreated = useCallback(
    (_created: TeamOut): void => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.teams(orgId) });
      setCreateOpen(false);
    },
    [orgId, queryClient],
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 @2xl:p-6 @4xl:p-8">
      <header className="flex flex-col gap-3 @2xl:flex-row @2xl:flex-wrap @2xl:items-center @2xl:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-on-surface text-xl font-semibold tracking-tight">Teams</h1>
          <p className="text-on-surface-variant text-xs">
            The units that own your work — each with its own workflow, cycles, and triage queue.
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
          New team
        </Button>
      </header>

      <CreateTeamDialog
        orgId={orgId}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={handleCreated}
      />

      {!loading && !loadError && teams.length > 0 ? (
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
          className="border-outline-variant text-destructive rounded-xl border p-4 text-sm"
        >
          {loadError}
        </p>
      ) : teams.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No teams yet"
          body="Teams are the units that own work — each with its own workflow, cycles, and triage queue. Create one to start organizing your work."
          cta={{
            label: 'Create your first team',
            onClick: () => {
              setCreateOpen(true);
            },
          }}
        />
      ) : applied.rows.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No matching teams"
          body="No team matches the active filters. Adjust or clear them to see more."
        />
      ) : applied.groups ? (
        <div className="flex flex-col gap-4">
          {applied.groups.map((group) => (
            <section key={group.id} className="flex flex-col gap-2">
              <h2 className="text-on-surface-variant flex items-center gap-2 px-1 text-xs font-medium">
                <span>{group.label}</span>
                <span className="text-on-surface-variant/70 tabular-nums">{group.rows.length}</span>
              </h2>
              <TeamRows
                rows={group.rows.map(toRow)}
                projectNoun={projectNoun}
                projectNounPlural={projectNounPlural}
                taskNoun={taskNoun}
                taskNounPlural={taskNounPlural}
                ariaLabel={`Teams — ${group.label}`}
              />
            </section>
          ))}
        </div>
      ) : (
        <TeamRows
          rows={applied.rows.map(toRow)}
          projectNoun={projectNoun}
          projectNounPlural={projectNounPlural}
          taskNoun={taskNoun}
          taskNounPlural={taskNounPlural}
          ariaLabel="Teams"
        />
      )}
    </div>
  );
}

/** Props for {@link TeamRows}. */
interface TeamRowsProps {
  /** The adapted rows to render. */
  rows: readonly TeamRow[];
  /** Singular project noun (vocabulary-resolved). */
  projectNoun: string;
  /** Plural project noun (vocabulary-resolved). */
  projectNounPlural: string;
  /** Singular task noun (vocabulary-resolved). */
  taskNoun: string;
  /** Plural task noun (vocabulary-resolved). */
  taskNounPlural: string;
  /** Accessible label for the list. */
  ariaLabel: string;
}

/** A bordered {@link EntityList} of team rows (shared by the flat + grouped renders). */
function TeamRows({
  rows,
  projectNoun,
  projectNounPlural,
  taskNoun,
  taskNounPlural,
  ariaLabel,
}: TeamRowsProps): JSX.Element {
  return (
    <EntityList aria-label={ariaLabel}>
      {rows.map(({ team, projectCount, taskCount, workflowStateCount }) => {
        const projectWord = projectCount === 1 ? projectNoun : projectNounPlural;
        const taskWord = taskCount === 1 ? taskNoun : taskNounPlural;
        return (
          <EntityListRow
            key={team.id}
            interactive={false}
            aria-label={`${team.key} ${team.name}`}
            leading={
              <span className="bg-surface-container text-on-surface-variant rounded px-1.5 py-0.5 font-mono text-xs font-medium">
                {team.key}
              </span>
            }
            title={team.name}
            meta={
              <>
                {workflowStateCount > 0 ? (
                  <RowMeta tabular>
                    <Workflow aria-hidden="true" className="size-3.5" />
                    {workflowStateCount} states
                  </RowMeta>
                ) : null}
                <RowMeta tabular>
                  <FolderKanban aria-hidden="true" className="size-3.5" />
                  {projectCount} {projectWord}
                </RowMeta>
                <RowMeta tabular>
                  <ListChecks aria-hidden="true" className="size-3.5" />
                  {taskCount} {taskWord}
                </RowMeta>
              </>
            }
            trailing={team.triageEnabled ? <Badge variant="secondary">Triage</Badge> : null}
          />
        );
      })}
    </EntityList>
  );
}

/** Loading placeholder: a bordered list of slim row skeletons. */
function ListSkeleton(): JSX.Element {
  return (
    <div
      className="border-outline-variant divide-outline-variant flex flex-col divide-y overflow-hidden rounded-xl border"
      aria-hidden="true"
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-2.5">
          <Skeleton className="h-5 w-10 rounded" />
          <Skeleton className="h-4 w-44" />
          <Skeleton className="ml-auto h-4 w-24" />
        </div>
      ))}
    </div>
  );
}
