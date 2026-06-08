'use client';

import type { MemberOut, ProjectOut, TaskOut } from '@docket/types';
import { useVocabulary } from '@docket/ui/hooks';
import { FolderKanban, Plus } from '@docket/ui/icons';
import { Button, Skeleton } from '@docket/ui/primitives';
import { useParams, useRouter } from 'next/navigation';
import { type JSX, useCallback, useEffect, useMemo, useState } from 'react';

import { useActiveOrg } from '@/components/active-org';
import { CreateProjectDialog } from '@/components/projects/create-project';
import { ProjectCard, type ProjectCardData } from '@/components/projects/project-card';
import { type StatusFilter, StatusFilterMenu } from '@/components/projects/project-status';
import { api } from '@/lib/api';
import { readError, readProblem } from '@/lib/problem';

/**
 * The org Projects list — the roster of bounded efforts (§8.4).
 *
 * @remarks
 * A Client Component reached at `/orgs/[orgId]/projects`. A Project is a *bounded* effort, so
 * each {@link ProjectCard} leads with identity, lifecycle status (`planned | active |
 * completed | canceled`), its {@link import('@/components/projects/project-status').HealthPill |
 * health verdict}, its lead, and a task-scope count ("N tasks").
 *
 * It composes two slices in parallel — projects and tasks — and rolls up the per-project task
 * count client-side (a task belongs to a project via `task.projectId`), so the roster renders
 * without an N-round-trip detail fan-out. Members name each project's lead. A styled
 * {@link StatusFilterMenu} narrows the roster by lifecycle bucket with live counts. Entity
 * nouns route through {@link useVocabulary}; data is fetched at runtime so the production build
 * needs no running server.
 */
export default function ProjectsListPage(): JSX.Element {
  const router = useRouter();
  const params = useParams<{ orgId: string }>();
  const orgId = params.orgId;

  const { teams, defaultTeamId, teamsLoading } = useActiveOrg();

  const projectLabel = useVocabulary('project');
  const projectsLabel = useVocabulary('project', { plural: true });
  const taskNoun = useVocabulary('task').toLowerCase();
  const taskNounPlural = useVocabulary('task', { plural: true }).toLowerCase();

  const [projects, setProjects] = useState<readonly ProjectOut[]>([]);
  const [tasks, setTasks] = useState<readonly TaskOut[]>([]);
  const [members, setMembers] = useState<readonly MemberOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [createOpen, setCreateOpen] = useState(false);

  /** Load the org's projects and the slices needed to scope + attribute each card. */
  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    try {
      const [projectsRes, tasksRes, membersRes] = await Promise.all([
        api.v1.orgs[':orgId'].projects.$get({ param: { orgId } }),
        api.v1.orgs[':orgId'].tasks.$get({ param: { orgId } }),
        api.v1.orgs[':orgId'].members.$get({ param: { orgId } }),
      ]);
      if (!projectsRes.ok) {
        setLoadError(
          await readProblem(projectsRes, `Could not load ${projectsLabel.toLowerCase()}.`),
        );
        return;
      }
      setProjects((await projectsRes.json()).items);
      if (tasksRes.ok) setTasks((await tasksRes.json()).items);
      if (membersRes.ok) setMembers((await membersRes.json()).items);
    } catch (caught) {
      setLoadError(
        readError(caught, `Something went wrong loading ${projectsLabel.toLowerCase()}.`),
      );
    } finally {
      setLoading(false);
    }
  }, [orgId, projectsLabel]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Lead display name by actor id (for the card footer attribution). */
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

  /** Adapt a Project DTO to its card view-model (lead + task scope roll-up). */
  const toCard = useCallback(
    (project: ProjectOut): ProjectCardData => ({
      id: project.id,
      name: project.name,
      description: project.description,
      status: project.status,
      health: project.health ?? null,
      leadName: project.leadId ? (leadNameById.get(project.leadId) ?? null) : null,
      taskCount: taskCountByProject.get(project.id) ?? 0,
    }),
    [leadNameById, taskCountByProject],
  );

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

  /** The projects shown under the active filter. */
  const visibleProjects = useMemo(
    () => (filter === 'all' ? projects : projects.filter((project) => project.status === filter)),
    [projects, filter],
  );

  /** Prepend the freshly-created project to the roster, then open its detail. */
  const handleCreated = useCallback(
    (created: ProjectOut): void => {
      setProjects((current) => [created, ...current]);
      router.push(`/orgs/${orgId}/projects/${created.id}`);
    },
    [orgId, router],
  );

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{projectsLabel}</h1>
          <p className="text-muted-foreground text-sm">
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-44 w-full rounded-xl" />
          ))}
        </div>
      ) : loadError ? (
        <p role="alert" className="border-border text-destructive rounded-lg border p-4 text-sm">
          {loadError}
        </p>
      ) : projects.length === 0 ? (
        <EmptyState
          title={`No ${projectsLabel.toLowerCase()} yet`}
          body={`${projectsLabel} are bounded efforts with a clear finish line. Create one to start tracking its status, health, and scope.`}
          cta={{
            label: `Create your first ${projectLabel.toLowerCase()}`,
            onClick: () => {
              setCreateOpen(true);
            },
          }}
        />
      ) : visibleProjects.length === 0 ? (
        <EmptyState
          title={`No ${filter} ${projectsLabel.toLowerCase()}`}
          body={`No ${projectLabel.toLowerCase()} matches this filter. Try a different status.`}
        />
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {visibleProjects.map((project) => (
            <li key={project.id}>
              <ProjectCard
                project={toCard(project)}
                taskNoun={taskNoun}
                taskNounPlural={taskNounPlural}
                onOpen={(id) => {
                  router.push(`/orgs/${orgId}/projects/${id}`);
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A centered empty-state panel with an icon, title, supporting copy, and an optional CTA. */
function EmptyState({
  title,
  body,
  cta,
}: {
  title: string;
  body: string;
  cta?: { label: string; onClick: () => void } | null;
}): JSX.Element {
  return (
    <div className="border-border flex flex-col items-center gap-3 rounded-xl border border-dashed p-12 text-center">
      <span className="bg-muted text-muted-foreground flex size-10 items-center justify-center rounded-full">
        <FolderKanban aria-hidden="true" className="size-5" />
      </span>
      <p className="text-foreground text-sm font-medium">{title}</p>
      <p className="text-muted-foreground max-w-sm text-sm leading-relaxed">{body}</p>
      {cta ? (
        <Button type="button" variant="outline" className="mt-1 gap-1.5" onClick={cta.onClick}>
          <Plus aria-hidden="true" className="size-4" />
          {cta.label}
        </Button>
      ) : null}
    </div>
  );
}
