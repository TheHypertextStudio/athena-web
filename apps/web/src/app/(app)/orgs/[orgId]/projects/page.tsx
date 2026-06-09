'use client';

import type { ProjectOut } from '@docket/types';
import {
  ActorAvatar,
  EmptyState,
  EntityList,
  EntityListRow,
  RowMeta,
  StatusIcon,
} from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { Calendar, FolderKanban, ListChecks, Plus } from '@docket/ui/icons';
import { Button, Skeleton } from '@docket/ui/primitives';
import { useParams, useRouter } from 'next/navigation';
import { type JSX, useCallback, useMemo, useState } from 'react';

import { useActiveOrg } from '@/components/active-org';
import { CreateProjectDialog } from '@/components/projects/create-project';
import {
  HealthDot,
  ProjectStatusBadge,
  type StatusFilter,
  StatusFilterMenu,
  statusGlyphType,
  statusLabel,
} from '@/components/projects/project-status';
import { api } from '@/lib/api';
import { queryKeys, useApiQuery } from '@/lib/query';
import { useQueryClient } from '@tanstack/react-query';

/** A short, year-less day formatter for a project's target date (e.g. "Jun 21"). */
const TARGET_DATE_FMT = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

/** Format a project's nullable target date for the row's meta band, or `null` when unset. */
function formatTargetDate(targetDate: string | null | undefined): string | null {
  if (!targetDate) return null;
  const date = new Date(targetDate);
  if (Number.isNaN(date.getTime())) return null;
  return TARGET_DATE_FMT.format(date);
}

/** The row view-model derived for one Project (lead + task-scope roll-up). */
interface ProjectRow {
  project: ProjectOut;
  leadName: string | null;
  taskCount: number;
}

/**
 * The org Projects list — the roster of bounded efforts (§8.4), rendered as dense rows.
 *
 * @remarks
 * A Client Component reached at `/orgs/[orgId]/projects`. A Project is a *bounded* effort, so
 * each {@link EntityListRow} leads with a lifecycle status glyph and surfaces its lead, target
 * date, task-scope count ("N tasks"), and — in the trailing slot — its lifecycle
 * {@link ProjectStatusBadge} and {@link HealthDot}. The card grid is gone: the roster is one
 * clean bordered list of hairline-divided rows (design-system §5.1), so a long roster scans by
 * row, not by tile.
 *
 * It composes three slices through the dynamic-data layer — projects, tasks, and members — so
 * each stays live (auto-refetch on focus + after a create) without a manual refresh control, and
 * rolls up the per-project task count client-side (a task belongs to a project via
 * `task.projectId`) so the roster renders without an N-round-trip detail fan-out. Members name
 * each project's lead. A styled {@link StatusFilterMenu} narrows the roster by lifecycle bucket
 * with live counts. Entity nouns route through {@link useVocabulary}; data is fetched at runtime
 * so the production build needs no running server.
 */
export default function ProjectsListPage(): JSX.Element {
  const router = useRouter();
  const params = useParams<{ orgId: string }>();
  const orgId = params.orgId;

  const { teams, defaultTeamId, teamsLoading } = useActiveOrg();
  const queryClient = useQueryClient();

  const projectLabel = useVocabulary('project');
  const projectsLabel = useVocabulary('project', { plural: true });
  const taskNoun = useVocabulary('task').toLowerCase();
  const taskNounPlural = useVocabulary('task', { plural: true }).toLowerCase();

  const [filter, setFilter] = useState<StatusFilter>('all');
  const [createOpen, setCreateOpen] = useState(false);

  // The roster is the primary slice (its load gates the page); tasks + members enrich each row
  // and degrade gracefully (an empty list) if they fail, mirroring the prior behavior.
  const projectsQ = useApiQuery(
    queryKeys.projects(orgId),
    () => api.v1.orgs[':orgId'].projects.$get({ param: { orgId } }),
    `Could not load ${projectsLabel.toLowerCase()}.`,
  );
  const tasksQ = useApiQuery(
    queryKeys.tasks(orgId),
    () => api.v1.orgs[':orgId'].tasks.$get({ param: { orgId } }),
    'Could not load tasks.',
  );
  const membersQ = useApiQuery(
    queryKeys.members(orgId),
    () => api.v1.orgs[':orgId'].members.$get({ param: { orgId } }),
    'Could not load members.',
  );

  const projects = useMemo(() => projectsQ.data?.items ?? [], [projectsQ.data]);
  const tasks = useMemo(() => tasksQ.data?.items ?? [], [tasksQ.data]);
  const members = useMemo(() => membersQ.data?.items ?? [], [membersQ.data]);

  const loading = projectsQ.isPending;
  const loadError = projectsQ.isError ? projectsQ.error.message : null;

  /** Lead display name by actor id (for the row attribution). */
  const leadNameById = useMemo(
    () => new Map(members.map((m) => [m.actorId, m.displayName])),
    [members],
  );

  /** Per-project task counts (a task belongs via `task.projectId`). */
  const taskCountByProject = useMemo(() => {
    const counts = new Map<string, number>();
    for (const task of tasks) {
      if (task.projectId) counts.set(task.projectId, (counts.get(task.projectId) ?? 0) + 1);
    }
    return counts;
  }, [tasks]);

  /** Per-bucket counts for the filter menu (always computed over the full roster). */
  const counts = useMemo<Record<StatusFilter, number>>(() => {
    const tally: Record<StatusFilter, number> = {
      all: projects.length,
      planned: 0,
      active: 0,
      completed: 0,
      canceled: 0,
    };
    for (const project of projects) {
      if (project.status in tally) tally[project.status as StatusFilter] += 1;
    }
    return tally;
  }, [projects]);

  /** The projects shown under the active filter, adapted to their row view-model. */
  const visibleRows = useMemo<readonly ProjectRow[]>(() => {
    const visible =
      filter === 'all' ? projects : projects.filter((project) => project.status === filter);
    return visible.map((project) => ({
      project,
      leadName: project.leadId ? (leadNameById.get(project.leadId) ?? null) : null,
      taskCount: taskCountByProject.get(project.id) ?? 0,
    }));
  }, [projects, filter, leadNameById, taskCountByProject]);

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
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 @2xl:p-6 @4xl:p-8">
      <header className="flex flex-col gap-3 @2xl:flex-row @2xl:flex-wrap @2xl:items-center @2xl:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-on-surface text-xl font-semibold tracking-tight">{projectsLabel}</h1>
          <p className="text-on-surface-variant text-xs">
            Bounded efforts with a finish line — tracked by status, health, and scope.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!loading && !loadError && projects.length > 0 ? (
            <StatusFilterMenu value={filter} counts={counts} onChange={setFilter} />
          ) : null}
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
        </div>
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

      {loading ? (
        <ListSkeleton />
      ) : loadError ? (
        <p
          role="alert"
          className="border-outline-variant text-destructive rounded-xl border p-4 text-sm"
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
      ) : visibleRows.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title={`No ${filter} ${projectsLabel.toLowerCase()}`}
          body={`No ${projectLabel.toLowerCase()} matches this filter. Try a different status.`}
        />
      ) : (
        <EntityList aria-label={projectsLabel}>
          {visibleRows.map(({ project, leadName, taskCount }) => {
            const targetDate = formatTargetDate(project.targetDate);
            const taskWord = taskCount === 1 ? taskNoun : taskNounPlural;
            return (
              <EntityListRow
                key={project.id}
                leading={
                  <StatusIcon
                    type={statusGlyphType(project.status)}
                    label={statusLabel(project.status)}
                  />
                }
                title={project.name}
                onActivate={() => {
                  router.push(`/orgs/${orgId}/projects/${project.id}`);
                }}
                meta={
                  <>
                    {leadName ? (
                      <RowMeta>
                        <ActorAvatar kind="human" name={leadName} size={18} />
                        <span className="text-on-surface/80 font-medium">{leadName}</span>
                      </RowMeta>
                    ) : null}
                    {targetDate ? (
                      <RowMeta tabular>
                        <Calendar aria-hidden="true" className="size-3.5" />
                        {targetDate}
                      </RowMeta>
                    ) : null}
                    <RowMeta tabular>
                      <ListChecks aria-hidden="true" className="size-3.5" />
                      {taskCount} {taskWord}
                    </RowMeta>
                  </>
                }
                trailing={
                  <>
                    <HealthDot health={project.health ?? null} />
                    <ProjectStatusBadge status={project.status} />
                  </>
                }
              />
            );
          })}
        </EntityList>
      )}
    </div>
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
          <Skeleton className="size-4 rounded-full" />
          <Skeleton className="h-4 w-48" />
          <Skeleton className="ml-auto h-4 w-24" />
        </div>
      ))}
    </div>
  );
}
