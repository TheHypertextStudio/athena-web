'use client';

/**
 * The Triage view — the holding pen for unsorted incoming work (mvp-plan §8.3c).
 *
 * @remarks
 * A Client Component reached at `/orgs/[orgId]/triage`. Triage is where work lands before it
 * has a home: a task with **no project AND no program**, on a team that has Triage *enabled*.
 * This screen is the org-wide aggregate of that queue, shown as one simple newest-first list
 * so a triager can clear it top-to-bottom. Each row is SOURCE-TAGGED — native (created in
 * Docket) vs linked (mirrored/imported from an integration like GitHub or Linear, with its
 * provenance) — and carries a sort-it quick-action menu that sends the item onward (into a
 * project, into a program, or dismissed). Rows open the task detail.
 *
 * Because drilling into per-team is cheap, the single list is *grouped by team* via the
 * design-system {@link ListView} (collapsible group headers), giving an at-a-glance read of
 * which teams are accumulating unsorted work while preserving the one-list mental model.
 *
 * It composes several slices in parallel:
 *
 * - **tasks** (`GET /tasks`) — filtered client-side to the triage predicate.
 * - **teams** (`GET /teams`) — to know which teams have `triageEnabled` (only their unsorted
 *   tasks belong here) and to name + order the team groups.
 * - **members** (`GET /members`) — to name + avatar the assignee on each row.
 * - **projects** / **programs** (`GET /projects`, `GET /programs`) — the sort-it destinations.
 * - **integrations** + the connect-wizard **directory** — to resolve a linked task's source
 *   integration id to a friendly provider name for the source tag.
 *
 * Sorting an item (assign a project/program) PATCHes the task and optimistically drops it
 * from the local list; dismissing archives it. Data is fetched at runtime, so the production
 * build needs no running server.
 */
import {
  type IntegrationDirectoryProvider,
  type IntegrationOut,
  type MemberOut,
  ProgramId,
  type ProgramOut,
  ProjectId,
  type ProjectOut,
  type TaskOut,
  type TeamOut,
} from '@docket/types';
import { type GroupKey, ListView } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { Inbox, RefreshCw } from '@docket/ui/icons';
import { Button, Skeleton } from '@docket/ui/primitives';
import { useParams, useRouter } from 'next/navigation';
import { type JSX, useCallback, useEffect, useMemo, useState } from 'react';

import { api } from '@/lib/api';
import { readError, readProblem } from '@/lib/problem';
import { stateTypeOf } from '@/lib/work-state';
import { buildProviderResolver } from '@/components/triage/provider-directory';
import { TriageRow, type TriageRowData } from '@/components/triage/triage-row';
import type { TriageDestination } from '@/components/triage/triage-actions';

/**
 * Whether a task is unsorted incoming work: it has neither a project nor a program.
 *
 * @remarks
 * This is the Triage membership predicate (mvp-plan §8.3c). `projectId`/`programId` are
 * nullable+optional on {@link TaskOut}, so an absent value is treated as "none". The
 * team-level `triageEnabled` gate is applied separately by the page (a task on a triage-
 * disabled team is never surfaced here even when it is otherwise unsorted).
 */
function isUnsorted(task: TaskOut): boolean {
  return (task.projectId ?? null) === null && (task.programId ?? null) === null;
}

/**
 * The Triage queue page.
 */
export default function TriagePage(): JSX.Element {
  const router = useRouter();
  const params = useParams<{ orgId: string }>();
  const orgId = params.orgId;

  const projectNoun = useVocabulary('project');
  const programNoun = useVocabulary('program');
  const taskNounPlural = useVocabulary('task', { plural: true });

  const [tasks, setTasks] = useState<readonly TaskOut[]>([]);
  const [teams, setTeams] = useState<readonly TeamOut[]>([]);
  const [members, setMembers] = useState<readonly MemberOut[]>([]);
  const [projects, setProjects] = useState<readonly ProjectOut[]>([]);
  const [programs, setPrograms] = useState<readonly ProgramOut[]>([]);
  const [integrations, setIntegrations] = useState<readonly IntegrationOut[]>([]);
  const [directory, setDirectory] = useState<readonly IntegrationDirectoryProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  /** Ids of tasks with an in-flight sort/dismiss mutation (disables that row's menu). */
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  /** A transient banner error from a failed sort/dismiss action. */
  const [actionError, setActionError] = useState<string | null>(null);

  /** Load the queue and every slice needed to name + sort its rows. */
  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    try {
      const [tasksRes, teamsRes, membersRes, projectsRes, programsRes, integrationsRes, dirRes] =
        await Promise.all([
          api.v1.orgs[':orgId'].tasks.$get({ param: { orgId } }),
          api.v1.orgs[':orgId'].teams.$get({ param: { orgId } }),
          api.v1.orgs[':orgId'].members.$get({ param: { orgId } }),
          api.v1.orgs[':orgId'].projects.$get({ param: { orgId } }),
          api.v1.orgs[':orgId'].programs.$get({ param: { orgId } }),
          api.v1.orgs[':orgId'].integrations.$get({ param: { orgId } }),
          api.v1.orgs[':orgId'].integrations.directory.$get({ param: { orgId } }),
        ]);
      if (!tasksRes.ok) {
        setLoadError(await readProblem(tasksRes, 'Could not load the triage queue.'));
        return;
      }
      setTasks((await tasksRes.json()).items);
      if (teamsRes.ok) setTeams((await teamsRes.json()).items);
      if (membersRes.ok) setMembers((await membersRes.json()).items);
      if (projectsRes.ok) setProjects((await projectsRes.json()).items);
      if (programsRes.ok) setPrograms((await programsRes.json()).items);
      if (integrationsRes.ok) setIntegrations((await integrationsRes.json()).items);
      if (dirRes.ok) setDirectory((await dirRes.json()).providers);
    } catch (caught) {
      setLoadError(readError(caught, 'Something went wrong loading the triage queue.'));
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Team ids that have Triage enabled — only their unsorted tasks belong in the queue. */
  const triageTeamIds = useMemo(
    () => new Set(teams.filter((team) => team.triageEnabled).map((team) => team.id)),
    [teams],
  );

  /** A team's display name by id (for the group headers); falls back to a short label. */
  const teamName = useMemo(() => {
    const byId = new Map<string, string>(teams.map((team) => [team.id, team.name]));
    return (teamId: string): string => byId.get(teamId) ?? 'Team';
  }, [teams]);

  /** Resolve an assignee actor id to its member display info (name + avatar). */
  const memberByActor = useMemo(
    () => new Map<string, MemberOut>(members.map((member) => [member.actorId, member])),
    [members],
  );

  /** Resolve a linked task's source integration id to a friendly provider name. */
  const providerName = useMemo(
    () => buildProviderResolver(integrations, directory),
    [integrations, directory],
  );

  /** The sort-it destinations offered in every row's menu. */
  const projectDestinations = useMemo<readonly TriageDestination[]>(
    () => projects.map((project) => ({ id: project.id, name: project.name })),
    [projects],
  );
  const programDestinations = useMemo<readonly TriageDestination[]>(
    () => programs.map((program) => ({ id: program.id, name: program.name })),
    [programs],
  );

  /**
   * The queue: unsorted tasks on triage-enabled teams, newest-first.
   *
   * @remarks
   * Newest-first by `createdAt` (ISO-8601 strings sort lexicographically by time), which is
   * the one canonical order for a holding pen — the freshest arrivals are seen first.
   */
  const queue = useMemo(() => {
    const inTriage = tasks.filter((task) => isUnsorted(task) && triageTeamIds.has(task.teamId));
    return [...inTriage].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [tasks, triageTeamIds]);

  /** Adapt a task DTO to its Triage row view-model (state type + provenance + assignee). */
  const toRow = useCallback(
    (task: TaskOut): TriageRowData => {
      const member = task.assigneeId ? memberByActor.get(task.assigneeId) : undefined;
      return {
        id: task.id,
        title: task.title,
        stateType: stateTypeOf(task.state),
        provenance: task.provenance,
        assigneeName: member?.displayName ?? null,
        assigneeAvatarUrl: member?.avatar ?? null,
      };
    },
    [memberByActor],
  );

  /** Group a queue row by its team (the cheap per-team drill-in within the one list). */
  const groupBy = useCallback(
    (task: TaskOut): GroupKey => ({ id: task.teamId, label: teamName(task.teamId) }),
    [teamName],
  );

  /** Mark a task as having an in-flight mutation. */
  const beginPending = useCallback((taskId: string): void => {
    setPending((current) => new Set(current).add(taskId));
  }, []);

  /** Clear a task's in-flight-mutation marker. */
  const endPending = useCallback((taskId: string): void => {
    setPending((current) => {
      const next = new Set(current);
      next.delete(taskId);
      return next;
    });
  }, []);

  /** Remove a task from the local list (after it has been sorted onward or dismissed). */
  const dropTask = useCallback((taskId: string): void => {
    setTasks((current) => current.filter((task) => task.id !== taskId));
  }, []);

  /** Sort a task into a project: PATCH `projectId`, then drop it from the queue. */
  const sortToProject = useCallback(
    async (taskId: string, projectId: string): Promise<void> => {
      setActionError(null);
      beginPending(taskId);
      try {
        const res = await api.v1.orgs[':orgId'].tasks[':id'].$patch({
          param: { orgId, id: taskId },
          json: { projectId: ProjectId.parse(projectId) },
        });
        if (!res.ok) {
          setActionError(await readProblem(res, 'Could not move that item. Please try again.'));
          return;
        }
        dropTask(taskId);
      } catch (caught) {
        setActionError(readError(caught, 'Something went wrong moving that item.'));
      } finally {
        endPending(taskId);
      }
    },
    [orgId, beginPending, endPending, dropTask],
  );

  /** Send a task to a program: PATCH `programId`, then drop it from the queue. */
  const sortToProgram = useCallback(
    async (taskId: string, programId: string): Promise<void> => {
      setActionError(null);
      beginPending(taskId);
      try {
        const res = await api.v1.orgs[':orgId'].tasks[':id'].$patch({
          param: { orgId, id: taskId },
          json: { programId: ProgramId.parse(programId) },
        });
        if (!res.ok) {
          setActionError(await readProblem(res, 'Could not send that item. Please try again.'));
          return;
        }
        dropTask(taskId);
      } catch (caught) {
        setActionError(readError(caught, 'Something went wrong sending that item.'));
      } finally {
        endPending(taskId);
      }
    },
    [orgId, beginPending, endPending, dropTask],
  );

  /** Dismiss a task: archive it, then drop it from the queue. */
  const dismiss = useCallback(
    async (taskId: string): Promise<void> => {
      setActionError(null);
      beginPending(taskId);
      try {
        const res = await api.v1.orgs[':orgId'].tasks[':id'].$delete({
          param: { orgId, id: taskId },
        });
        if (!res.ok) {
          setActionError(await readProblem(res, 'Could not dismiss that item. Please try again.'));
          return;
        }
        dropTask(taskId);
      } catch (caught) {
        setActionError(readError(caught, 'Something went wrong dismissing that item.'));
      } finally {
        endPending(taskId);
      }
    },
    [orgId, beginPending, endPending, dropTask],
  );

  const openTask = useCallback(
    (taskId: string): void => {
      router.push(`/orgs/${orgId}/tasks/${taskId}`);
    },
    [router, orgId],
  );

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-6 p-4 @2xl:p-6 @4xl:p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-on-surface text-xl font-semibold tracking-tight">Triage</h1>
        <p className="text-on-surface-variant text-xs">
          Unsorted incoming work — {taskNounPlural.toLowerCase()} that have no home yet. Sort each
          one onward into a {projectNoun.toLowerCase()} or {programNoun.toLowerCase()}, or dismiss
          it.
        </p>
      </header>

      <div className="flex items-center justify-between gap-3">
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => {
            void load();
          }}
          disabled={loading}
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
        {!loading && !loadError ? (
          <p className="text-on-surface-variant text-xs tabular-nums">
            {queue.length} {queue.length === 1 ? 'item' : 'items'} to sort
          </p>
        ) : null}
      </div>

      {actionError ? (
        <p role="alert" className="text-destructive text-sm">
          {actionError}
        </p>
      ) : null}

      <section
        aria-label="Triage queue"
        className="border-outline-variant flex-1 overflow-hidden rounded-xl border"
      >
        {loading ? (
          <div className="flex flex-col gap-2 p-3" aria-hidden="true">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : loadError ? (
          <p role="alert" className="text-destructive p-4 text-sm">
            {loadError}
          </p>
        ) : queue.length === 0 ? (
          <div className="text-on-surface-variant flex flex-col items-center gap-3 p-12 text-center">
            <Inbox className="h-8 w-8 opacity-50" aria-hidden="true" />
            <div className="flex flex-col gap-1">
              <p className="text-on-surface text-sm font-medium">Triage is clear</p>
              <p className="text-sm">
                Nothing unsorted right now. New incoming work shows up here for you to sort.
              </p>
            </div>
          </div>
        ) : (
          <ListView
            items={queue}
            label="Triage queue, grouped by team"
            getItemKey={(task) => task.id}
            groupBy={groupBy}
            rowHeight={40}
            renderRow={(task, ctx) => (
              <TriageRow
                task={toRow(task)}
                active={ctx.active}
                onActivate={ctx.onActivate}
                busy={pending.has(task.id)}
                projects={projectDestinations}
                programs={programDestinations}
                projectNoun={projectNoun}
                programNoun={programNoun}
                providerName={providerName}
                onAssignProject={(projectId) => {
                  void sortToProject(task.id, projectId);
                }}
                onAssignProgram={(programId) => {
                  void sortToProgram(task.id, programId);
                }}
                onDismiss={() => {
                  void dismiss(task.id);
                }}
              />
            )}
            onActivateItem={(task) => {
              openTask(task.id);
            }}
          />
        )}
      </section>
    </div>
  );
}
