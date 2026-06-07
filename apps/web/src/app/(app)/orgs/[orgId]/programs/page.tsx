'use client';

import type { MemberOut, ProgramOut, ProjectOut, TaskOut } from '@docket/types';
import { useVocabulary } from '@docket/ui/hooks';
import { FolderKanban } from '@docket/ui/icons';
import { Skeleton } from '@docket/ui/primitives';
import { useParams, useRouter } from 'next/navigation';
import { type JSX, useCallback, useEffect, useMemo, useState } from 'react';

import { ProgramCard, type ProgramCardData } from '@/components/programs/program-card';
import { type StatusFilter, StatusFilterMenu } from '@/components/programs/program-status';
import { api } from '@/lib/api';
import { readError, readProblem } from '@/lib/problem';

/**
 * The org Programs list — the roster of ongoing operational lines of work (§8.4).
 *
 * @remarks
 * A Client Component reached at `/orgs/[orgId]/programs`. Programs are *ongoing*, so the
 * list leads with health + lifecycle rather than completion: each {@link ProgramCard}
 * carries the program's name, its lifecycle status (`active | paused | archived`), its
 * {@link import('@/components/programs/program-status').HealthPill | health verdict}, its
 * owner, and a child-work scope ("N projects · M tasks").
 *
 * It composes three slices in parallel — programs, projects, and tasks — and rolls up the
 * per-program scope client-side (a project belongs to a program via `project.programId`; a
 * task belongs via `task.programId` directly or through one of those projects), so the
 * roster renders without an N-round-trip detail fan-out. Members name each program's owner.
 * A styled {@link StatusFilterMenu} narrows the roster by lifecycle bucket with live counts.
 * Entity nouns route through {@link useVocabulary}; data is fetched at runtime so the
 * production build needs no running server.
 */
export default function ProgramsListPage(): JSX.Element {
  const router = useRouter();
  const params = useParams<{ orgId: string }>();
  const orgId = params.orgId;

  const programLabel = useVocabulary('program');
  const programsLabel = useVocabulary('program', { plural: true });
  const projectNoun = useVocabulary('project').toLowerCase();
  const projectNounPlural = useVocabulary('project', { plural: true }).toLowerCase();
  const taskNoun = useVocabulary('task').toLowerCase();
  const taskNounPlural = useVocabulary('task', { plural: true }).toLowerCase();

  const [programs, setPrograms] = useState<readonly ProgramOut[]>([]);
  const [projects, setProjects] = useState<readonly ProjectOut[]>([]);
  const [tasks, setTasks] = useState<readonly TaskOut[]>([]);
  const [members, setMembers] = useState<readonly MemberOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>('all');

  /** Load the org's programs and the slices needed to scope + attribute each card. */
  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    try {
      const [programsRes, projectsRes, tasksRes, membersRes] = await Promise.all([
        api.v1.orgs[':orgId'].programs.$get({ param: { orgId } }),
        api.v1.orgs[':orgId'].projects.$get({ param: { orgId } }),
        api.v1.orgs[':orgId'].tasks.$get({ param: { orgId } }),
        api.v1.orgs[':orgId'].members.$get({ param: { orgId } }),
      ]);
      if (!programsRes.ok) {
        setLoadError(
          await readProblem(programsRes, `Could not load ${programsLabel.toLowerCase()}.`),
        );
        return;
      }
      setPrograms((await programsRes.json()).items);
      if (projectsRes.ok) setProjects((await projectsRes.json()).items);
      if (tasksRes.ok) setTasks((await tasksRes.json()).items);
      if (membersRes.ok) setMembers((await membersRes.json()).items);
    } catch (caught) {
      setLoadError(
        readError(caught, `Something went wrong loading ${programsLabel.toLowerCase()}.`),
      );
    } finally {
      setLoading(false);
    }
  }, [orgId, programsLabel]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Owner display name by actor id (for the card footer attribution). */
  const ownerNameById = useMemo(
    () => new Map(members.map((m) => [m.actorId, m.displayName])),
    [members],
  );

  /** The program id each project belongs to, indexed for the task roll-up below. */
  const programByProjectId = useMemo(
    () => new Map(projects.map((p) => [p.id, p.programId ?? null])),
    [projects],
  );

  /** Per-program project counts (a project belongs via `project.programId`). */
  const projectCountByProgram = useMemo(() => {
    const counts = new Map<string, number>();
    for (const project of projects) {
      if (project.programId)
        counts.set(project.programId, (counts.get(project.programId) ?? 0) + 1);
    }
    return counts;
  }, [projects]);

  /**
   * Per-program task counts: a task belongs to a program when it carries the program
   * directly (`task.programId`) or via the project it sits in (`project.programId`),
   * matching the API's `…/programs/:id/work` roll-up rule.
   */
  const taskCountByProgram = useMemo(() => {
    const counts = new Map<string, number>();
    for (const task of tasks) {
      const programId =
        task.programId ?? (task.projectId ? programByProjectId.get(task.projectId) : null);
      if (programId) counts.set(programId, (counts.get(programId) ?? 0) + 1);
    }
    return counts;
  }, [tasks, programByProjectId]);

  /** Adapt a Program DTO to its card view-model (owner + scope roll-up). */
  const toCard = useCallback(
    (program: ProgramOut): ProgramCardData => ({
      id: program.id,
      name: program.name,
      description: program.description,
      status: program.status,
      health: program.health ?? null,
      ownerName: program.ownerId ? (ownerNameById.get(program.ownerId) ?? null) : null,
      projectCount: projectCountByProgram.get(program.id) ?? 0,
      taskCount: taskCountByProgram.get(program.id) ?? 0,
    }),
    [ownerNameById, projectCountByProgram, taskCountByProgram],
  );

  /** Per-bucket counts for the filter menu (always computed over the full roster). */
  const counts = useMemo<Record<StatusFilter, number>>(() => {
    const tally: Record<StatusFilter, number> = {
      all: programs.length,
      active: 0,
      paused: 0,
      archived: 0,
    };
    for (const program of programs) tally[program.status] += 1;
    return tally;
  }, [programs]);

  /** The programs shown under the active filter. */
  const visiblePrograms = useMemo(
    () => (filter === 'all' ? programs : programs.filter((program) => program.status === filter)),
    [programs, filter],
  );

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{programsLabel}</h1>
          <p className="text-muted-foreground text-sm">
            Ongoing lines of work — tracked by health, not a finish line.
          </p>
        </div>
        {!loading && !loadError && programs.length > 0 ? (
          <StatusFilterMenu value={filter} counts={counts} onChange={setFilter} />
        ) : null}
      </header>

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
      ) : programs.length === 0 ? (
        <EmptyState
          title={`No ${programsLabel.toLowerCase()} yet`}
          body={`${programsLabel} are ongoing lines of work — your funded areas, retainers, or recurring operations. They'll appear here once created.`}
        />
      ) : visiblePrograms.length === 0 ? (
        <EmptyState
          title={`No ${filter} ${programsLabel.toLowerCase()}`}
          body={`No ${programLabel.toLowerCase()} matches this filter. Try a different status.`}
        />
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {visiblePrograms.map((program) => (
            <li key={program.id}>
              <ProgramCard
                program={toCard(program)}
                projectNoun={projectNoun}
                projectNounPlural={projectNounPlural}
                taskNoun={taskNoun}
                taskNounPlural={taskNounPlural}
                onOpen={(id) => {
                  router.push(`/orgs/${orgId}/programs/${id}`);
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A centered empty-state panel with an icon, title, and supporting copy. */
function EmptyState({ title, body }: { title: string; body: string }): JSX.Element {
  return (
    <div className="border-border flex flex-col items-center gap-3 rounded-xl border border-dashed p-12 text-center">
      <span className="bg-muted text-muted-foreground flex size-10 items-center justify-center rounded-full">
        <FolderKanban aria-hidden="true" className="size-5" />
      </span>
      <p className="text-foreground text-sm font-medium">{title}</p>
      <p className="text-muted-foreground max-w-sm text-sm leading-relaxed">{body}</p>
    </div>
  );
}
