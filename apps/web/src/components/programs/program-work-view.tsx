'use client';

/**
 * The Program page's Work tab — this Program's tasks through the same Filter/Display list-view
 * stack every other roster in the app uses, grouped by project by default.
 *
 * @remarks
 * Replaces the bespoke {@link "@/components/programs/work-board" | WorkBoard}, which rendered a
 * fixed cycle→project grouping with no filter or sort controls — the one roster in the app that
 * didn't share the {@link FilterToolbar} + {@link useViewState} + {@link applyView} engine.
 * Composed the same way {@link "@/app/(app)/orgs/[orgId]/tasks/org-tasks-client" | the workspace
 * Tasks roster} is, just scoped to one Program's tasks (`GET /tasks?programId=`) instead of every
 * task in the org, and defaulting the URL-persisted grouping to `project` on first load — a
 * viewer can still switch or clear it from the Display menu like anywhere else.
 *
 * One deliberate behavior change from the old board: there is no more inline "add a task to this
 * cycle" row, because the shared list view has no cycle grouping in its field catalog. Creating
 * work still goes through the normal "New task" composer elsewhere in the app.
 */
import type { MemberOut, ProjectOut } from '@docket/types';
import { EmptyState } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { ListChecks } from '@docket/ui/icons';
import { Skeleton } from '@docket/ui/primitives';
import { useRouter } from 'next/navigation';
import { type JSX, useEffect, useMemo, useRef } from 'react';

import { applyView } from '@/components/views/apply-view';
import { resolveRelationLabel, type FieldOption } from '@/components/views/field-catalog';
import { FilterToolbar } from '@/components/views/filter-toolbar';
import { buildTaskCatalog } from '@/components/views/task-catalog';
import { buildTaskColumns, TaskTable } from '@/components/views/task-table';
import { useViewState } from '@/components/views/use-view-state';
import { api } from '@/lib/api';
import { userErrorMessage } from '@/lib/problem';
import { apiQueryOptions, queryKeys, STALE, useApiListQuery, usePrefetchApi } from '@/lib/query';
import { useOrgCapability } from '@/lib/use-org-capability';
import { taskDetailDef } from '@/lib/use-task-detail';
import { useRenameTask } from '@/lib/use-rename-task';

/** Props for {@link ProgramWorkView}. */
export interface ProgramWorkViewProps {
  orgId: string;
  programId: string;
}

/** This Program's task roster, filterable and groupable like every other list in the app. */
export function ProgramWorkView({ orgId, programId }: ProgramWorkViewProps): JSX.Element {
  const router = useRouter();
  const prefetch = usePrefetchApi();
  const projectNoun = useVocabulary('project');
  const programNoun = useVocabulary('program');
  const { state, setFilters, setGroupBy, setSort } = useViewState();

  const taskKey = useMemo(
    () => [...queryKeys.program(orgId, programId), 'tasks'] as const,
    [orgId, programId],
  );
  const tasksQ = useApiListQuery(
    apiQueryOptions(
      taskKey,
      () => api.v1.orgs[':orgId'].tasks.$get({ param: { orgId }, query: { programId } }),
      "Could not load this program's work.",
    ),
  );
  const membersQ = useApiListQuery(
    apiQueryOptions(
      queryKeys.members(orgId),
      () => api.v1.orgs[':orgId'].members.$get({ param: { orgId } }),
      'Could not load members.',
      { staleTime: STALE.static },
    ),
  );
  const projectsQ = useApiListQuery(
    apiQueryOptions(
      queryKeys.projects(orgId),
      () => api.v1.orgs[':orgId'].projects.$get({ param: { orgId }, query: {} }),
      'Could not load projects.',
      { staleTime: STALE.static },
    ),
  );
  const programsQ = useApiListQuery(
    apiQueryOptions(
      queryKeys.programs(orgId),
      () => api.v1.orgs[':orgId'].programs.$get({ param: { orgId }, query: {} }),
      'Could not load programs.',
      { staleTime: STALE.static },
    ),
  );
  const rolesQ = useApiListQuery(
    apiQueryOptions(
      queryKeys.roles(orgId),
      () => api.v1.orgs[':orgId'].roles.$get({ param: { orgId } }),
      'Could not load roles.',
      { staleTime: STALE.static },
    ),
  );
  // A task's assignee can be an agent, not only a human member — fetched so the assignee resolver
  // below can recognize one instead of falling through to the raw actor id.
  const agentsQ = useApiListQuery(
    apiQueryOptions(
      queryKeys.agents(orgId),
      () => api.v1.orgs[':orgId'].agents.$get({ param: { orgId } }),
      'Could not load agents.',
      { staleTime: STALE.static },
    ),
  );

  const tasks = useMemo(() => tasksQ.data?.items ?? [], [tasksQ.data]);
  const members = useMemo(() => membersQ.data?.items ?? [], [membersQ.data]);
  const projects = useMemo<readonly ProjectOut[]>(
    () => projectsQ.data?.items ?? [],
    [projectsQ.data],
  );
  const programs = useMemo(() => programsQ.data?.items ?? [], [programsQ.data]);
  const roles = useMemo(() => rolesQ.data?.items ?? [], [rolesQ.data]);
  const agents = useMemo(() => agentsQ.data?.items ?? [], [agentsQ.data]);

  const canEdit = useOrgCapability(members, roles, 'contribute');
  const renameTask = useRenameTask(orgId, [taskKey]);

  const memberById = useMemo(
    () => new Map<string, MemberOut>(members.map((member) => [member.actorId, member])),
    [members],
  );
  const projectNameById = useMemo(
    () => new Map<string, string>(projects.map((project) => [project.id, project.name])),
    [projects],
  );
  const programNameById = useMemo(
    () => new Map<string, string>(programs.map((program) => [program.id, program.name])),
    [programs],
  );
  const agentActorIds = useMemo(
    () => new Set<string>(agents.map((agent) => agent.actorId)),
    [agents],
  );

  const catalog = useMemo(
    () =>
      buildTaskCatalog({
        projectLabel: projectNoun,
        programLabel: programNoun,
        resolveProject: (id) =>
          resolveRelationLabel(id, projectsQ.isPending, (i) => projectNameById.get(i)),
        resolveProgram: (id) =>
          resolveRelationLabel(id, programsQ.isPending, (i) => programNameById.get(i)),
        resolveAssignee: (id) =>
          resolveRelationLabel(id, membersQ.isPending || agentsQ.isPending, (i) => {
            const displayName = memberById.get(i)?.displayName;
            if (displayName) return displayName;
            return agentActorIds.has(i) ? 'Agent' : undefined;
          }),
        assigneeOptions: (): readonly FieldOption[] =>
          members.map((member) => ({ value: member.actorId, label: member.displayName })),
        projectOptions: (): readonly FieldOption[] =>
          projects.map((project) => ({ value: project.id, label: project.name })),
        programOptions: (): readonly FieldOption[] =>
          programs.map((program) => ({ value: program.id, label: program.name })),
        tasks,
      }),
    [
      tasks,
      agentActorIds,
      agentsQ.isPending,
      memberById,
      members,
      membersQ.isPending,
      programNameById,
      programNoun,
      programs,
      programsQ.isPending,
      projectNameById,
      projectNoun,
      projects,
      projectsQ.isPending,
    ],
  );

  // Default the URL-persisted grouping to "project" the first time this tab mounts, so it reads
  // as "this program's work, by project" out of the box — the Display menu still lets a viewer
  // switch or clear it, same as any other roster.
  const defaultedGroupBy = useRef(false);
  useEffect(() => {
    if (defaultedGroupBy.current) return;
    defaultedGroupBy.current = true;
    if (state.groupBy === null) setGroupBy({ field: 'project' });
  }, [state.groupBy, setGroupBy]);

  const applied = useMemo(() => applyView(tasks, state, catalog), [catalog, state, tasks]);

  const columns = useMemo(
    () =>
      buildTaskColumns({
        catalog,
        resolveActor: (actorId) => {
          const member = memberById.get(actorId);
          return member
            ? { name: member.displayName, kind: 'human' as const, avatarUrl: member.avatar }
            : { name: 'Someone', kind: 'human' as const };
        },
        canEdit,
        onRename: renameTask,
        onOpen: (task) => {
          router.push(`/orgs/${orgId}/tasks/${task.id}`);
        },
      }),
    [canEdit, catalog, memberById, orgId, renameTask, router],
  );

  if (tasksQ.isPending) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-9 w-full" />
        ))}
      </div>
    );
  }

  if (tasksQ.isError) {
    return (
      <p role="alert" className="text-error text-body-medium">
        {userErrorMessage(tasksQ.error, "Could not load this program's work.")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {tasks.length > 0 ? (
        <FilterToolbar
          catalog={catalog}
          state={state}
          onFiltersChange={setFilters}
          onGroupByChange={setGroupBy}
          onSortChange={setSort}
        />
      ) : null}

      {tasks.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="No work yet"
          body="Tasks filed under this program, or under one of its projects, will show up here."
        />
      ) : applied.rows.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="No matching tasks"
          body="Adjust the current filters to see more work."
        />
      ) : (
        <TaskTable
          columns={columns}
          {...(applied.groups ? { groups: applied.groups } : { tasks: applied.rows })}
          taskHref={(task) => `/orgs/${orgId}/tasks/${task.id}`}
          onRowPrefetch={(task) => {
            prefetch(taskDetailDef(orgId, task.id));
          }}
          label="Work"
        />
      )}
    </div>
  );
}
