'use client';

import type { ProjectOut, TaskOut, TeamOut } from '@docket/types';
import { useVocabulary } from '@docket/ui/hooks';
import { Plus, Users } from '@docket/ui/icons';
import { Button, Skeleton } from '@docket/ui/primitives';
import { useParams } from 'next/navigation';
import { type JSX, useCallback, useEffect, useMemo, useState } from 'react';

import { CreateTeamDialog } from '@/components/teams/create-team';
import { TeamCard, type TeamCardData } from '@/components/teams/team-card';
import { api } from '@/lib/api';
import { readError, readProblem } from '@/lib/problem';

/**
 * The org Teams list — the roster of first-class units within the org (§7).
 *
 * @remarks
 * A Client Component reached at `/orgs/[orgId]/teams`. A Team owns its own workflow states,
 * cycles, and Triage queue ({@link TeamOut}); each {@link TeamCard} surfaces the team's key,
 * name, whether its Triage queue is enabled, and a scope roll-up ("N projects · M tasks").
 *
 * It composes three slices in parallel — teams, projects, and tasks — and rolls up the
 * per-team scope client-side (a project belongs via `project.teamId`; a task belongs via
 * `task.teamId`), so the roster renders without an N-round-trip detail fan-out. Entity nouns
 * route through {@link useVocabulary}; data is fetched at runtime so the production build needs
 * no running server.
 */
export default function TeamsListPage(): JSX.Element {
  const params = useParams<{ orgId: string }>();
  const orgId = params.orgId;

  const projectNoun = useVocabulary('project').toLowerCase();
  const projectNounPlural = useVocabulary('project', { plural: true }).toLowerCase();
  const taskNoun = useVocabulary('task').toLowerCase();
  const taskNounPlural = useVocabulary('task', { plural: true }).toLowerCase();

  const [teams, setTeams] = useState<readonly TeamOut[]>([]);
  const [projects, setProjects] = useState<readonly ProjectOut[]>([]);
  const [tasks, setTasks] = useState<readonly TaskOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  /** Load the org's teams and the slices needed to scope each card. */
  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    try {
      const [teamsRes, projectsRes, tasksRes] = await Promise.all([
        api.v1.orgs[':orgId'].teams.$get({ param: { orgId } }),
        api.v1.orgs[':orgId'].projects.$get({ param: { orgId } }),
        api.v1.orgs[':orgId'].tasks.$get({ param: { orgId } }),
      ]);
      if (!teamsRes.ok) {
        setLoadError(await readProblem(teamsRes, 'Could not load your teams.'));
        return;
      }
      setTeams((await teamsRes.json()).items);
      if (projectsRes.ok) setProjects((await projectsRes.json()).items);
      if (tasksRes.ok) setTasks((await tasksRes.json()).items);
    } catch (caught) {
      setLoadError(readError(caught, 'Something went wrong loading your teams.'));
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

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

  /** Adapt a Team DTO to its card view-model (scope roll-up). */
  const toCard = useCallback(
    (team: TeamOut): TeamCardData => ({
      id: team.id,
      name: team.name,
      key: team.key,
      description: team.description,
      triageEnabled: team.triageEnabled,
      projectCount: projectCountByTeam.get(team.id) ?? 0,
      taskCount: taskCountByTeam.get(team.id) ?? 0,
    }),
    [projectCountByTeam, taskCountByTeam],
  );

  /** Prepend the freshly-created team to the roster (teams have no detail route to open). */
  const handleCreated = useCallback((created: TeamOut): void => {
    setTeams((current) => [created, ...current]);
    setCreateOpen(false);
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Teams</h1>
          <p className="text-muted-foreground text-sm">
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

      {loading ? (
        <div
          className="grid grid-cols-1 gap-4 @2xl:grid-cols-2 @5xl:grid-cols-3"
          aria-hidden="true"
        >
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-36 w-full rounded-xl" />
          ))}
        </div>
      ) : loadError ? (
        <p role="alert" className="border-border text-destructive rounded-lg border p-4 text-sm">
          {loadError}
        </p>
      ) : teams.length === 0 ? (
        <EmptyState
          title="No teams yet"
          body="Teams are the units that own work — each with its own workflow, cycles, and triage queue. Create one to start organizing your work."
          cta={{
            label: 'Create your first team',
            onClick: () => {
              setCreateOpen(true);
            },
          }}
        />
      ) : (
        <ul className="grid grid-cols-1 gap-4 @2xl:grid-cols-2 @5xl:grid-cols-3">
          {teams.map((team) => (
            <li key={team.id}>
              <TeamCard
                team={toCard(team)}
                projectNoun={projectNoun}
                projectNounPlural={projectNounPlural}
                taskNoun={taskNoun}
                taskNounPlural={taskNounPlural}
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
        <Users aria-hidden="true" className="size-5" />
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
