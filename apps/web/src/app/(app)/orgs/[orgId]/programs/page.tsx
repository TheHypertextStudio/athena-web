'use client';

import type { MemberOut, ProgramOut, ProjectOut, TaskOut } from '@docket/types';
import { ActorAvatar, EntityList, EntityListRow, RowMeta, StatusIcon } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { FolderKanban, Layers, ListChecks, Plus } from '@docket/ui/icons';
import { Button, Skeleton } from '@docket/ui/primitives';
import { useParams, useRouter } from 'next/navigation';
import { type JSX, useCallback, useEffect, useMemo, useState } from 'react';

import { CreateProgramDialog } from '@/components/programs/create-program';
import {
  HealthDot,
  ProgramStatusBadge,
  STATUS_LABEL,
  type StatusFilter,
  StatusFilterMenu,
  statusGlyphType,
} from '@/components/programs/program-status';
import { api } from '@/lib/api';
import { readError, readProblem } from '@/lib/problem';

/** The row view-model derived for one Program (owner + child-work roll-up). */
interface ProgramRow {
  program: ProgramOut;
  ownerName: string | null;
  projectCount: number;
  taskCount: number;
}

/**
 * The org Programs list — the roster of ongoing operational lines of work (§8.4), as dense rows.
 *
 * @remarks
 * A Client Component reached at `/orgs/[orgId]/programs`. Programs are *ongoing*, so each
 * {@link EntityListRow} leads with a liveness status glyph and surfaces the program's owner,
 * its child-work scope ("N projects" + "M tasks"), and — in the trailing slot — its
 * {@link HealthDot | health} and lifecycle {@link ProgramStatusBadge}. The former card grid is
 * replaced by one clean bordered list of hairline-divided rows (design-system §5.1).
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
  const [createOpen, setCreateOpen] = useState(false);

  /** Load the org's programs and the slices needed to scope + attribute each row. */
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

  /** Owner display name by actor id (for the row attribution). */
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

  /** The programs shown under the active filter, adapted to their row view-model. */
  const visibleRows = useMemo<readonly ProgramRow[]>(() => {
    const visible =
      filter === 'all' ? programs : programs.filter((program) => program.status === filter);
    return visible.map((program) => ({
      program,
      ownerName: program.ownerId ? (ownerNameById.get(program.ownerId) ?? null) : null,
      projectCount: projectCountByProgram.get(program.id) ?? 0,
      taskCount: taskCountByProgram.get(program.id) ?? 0,
    }));
  }, [programs, filter, ownerNameById, projectCountByProgram, taskCountByProgram]);

  /** Prepend the freshly-created program to the roster, then open its detail. */
  const handleCreated = useCallback(
    (created: ProgramOut): void => {
      setPrograms((current) => [created, ...current]);
      router.push(`/orgs/${orgId}/programs/${created.id}`);
    },
    [orgId, router],
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 @2xl:p-6 @4xl:p-8">
      <header className="flex flex-col gap-3 @2xl:flex-row @2xl:flex-wrap @2xl:items-center @2xl:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-on-surface text-xl font-semibold tracking-tight">{programsLabel}</h1>
          <p className="text-on-surface-variant text-xs">
            Ongoing lines of work — tracked by health, not a finish line.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!loading && !loadError && programs.length > 0 ? (
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
            New {programLabel}
          </Button>
        </div>
      </header>

      <CreateProgramDialog
        orgId={orgId}
        programNoun={programLabel}
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
      ) : programs.length === 0 ? (
        <EmptyState
          title={`No ${programsLabel.toLowerCase()} yet`}
          body={`${programsLabel} are ongoing lines of work — your funded areas, retainers, or recurring operations. Create one to start tracking its health.`}
          cta={{
            label: `Create your first ${programLabel.toLowerCase()}`,
            onClick: () => {
              setCreateOpen(true);
            },
          }}
        />
      ) : visibleRows.length === 0 ? (
        <EmptyState
          title={`No ${filter} ${programsLabel.toLowerCase()}`}
          body={`No ${programLabel.toLowerCase()} matches this filter. Try a different status.`}
        />
      ) : (
        <EntityList aria-label={programsLabel}>
          {visibleRows.map(({ program, ownerName, projectCount, taskCount }) => {
            const projectWord = projectCount === 1 ? projectNoun : projectNounPlural;
            const taskWord = taskCount === 1 ? taskNoun : taskNounPlural;
            return (
              <EntityListRow
                key={program.id}
                leading={
                  <StatusIcon
                    type={statusGlyphType(program.status)}
                    label={STATUS_LABEL[program.status]}
                  />
                }
                title={program.name}
                onActivate={() => {
                  router.push(`/orgs/${orgId}/programs/${program.id}`);
                }}
                meta={
                  <>
                    {ownerName ? (
                      <RowMeta>
                        <ActorAvatar kind="human" name={ownerName} size={18} />
                        <span className="text-on-surface/80 font-medium">{ownerName}</span>
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
                trailing={
                  <>
                    <HealthDot health={program.health ?? null} />
                    <ProgramStatusBadge status={program.status} />
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
    <div className="border-outline-variant flex flex-col items-center gap-3 rounded-xl border border-dashed p-12 text-center">
      <span className="bg-surface-container text-on-surface-variant flex size-10 items-center justify-center rounded-full">
        <Layers aria-hidden="true" className="size-5" />
      </span>
      <p className="text-on-surface text-sm font-medium">{title}</p>
      <p className="text-on-surface-variant max-w-sm text-sm leading-relaxed">{body}</p>
      {cta ? (
        <Button type="button" variant="outline" className="mt-1 gap-1.5" onClick={cta.onClick}>
          <Plus aria-hidden="true" className="size-4" />
          {cta.label}
        </Button>
      ) : null}
    </div>
  );
}
