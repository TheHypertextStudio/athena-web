'use client';

/**
 * The workspace Tasks roster — the top-level list of every task in the active workspace.
 *
 * @remarks
 * Composed entirely from the shared list primitives so this surface reads as the same object as
 * every other roster in the app: {@link ListPageLayout} for the header/toolbar/body rhythm,
 * {@link FilterToolbar} + {@link useViewState} + {@link applyView} over
 * {@link buildTaskCatalog} for filter/group/sort (state lives in the URL, so a filtered roster is
 * a shareable link), and the shared aligned-column {@link TaskTable} for the rows. Nothing about a
 * task row is re-invented here — a task looks the same in this roster, in a project's Tasks tab,
 * and in a cycle.
 *
 * The empty state distinguishes "this workspace has no tasks yet" from "your current filters match
 * none of them", because the two are different facts and only one of them is fixed by creating
 * work.
 */
import type { MemberOut, TaskOut } from '@docket/types';
import { EmptyState } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { ListChecks, Plus } from '@docket/ui/icons';
import { Button, Skeleton } from '@docket/ui/primitives';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useAppParams } from '@/lib/app-location';
import { type JSX, useCallback, useMemo, useState } from 'react';

import { useActiveOrg } from '@/components/active-org';
import { CreateTaskDialog } from '@/components/tasks/create-task';
import { applyView } from '@/components/views/apply-view';
import type { FieldOption } from '@/components/views/field-catalog';
import { FilterToolbar } from '@/components/views/filter-toolbar';
import { ListPageLayout } from '@/components/views/page-layout';
import { buildTaskCatalog } from '@/components/views/task-catalog';
import { buildTaskColumns, TaskTable } from '@/components/views/task-table';
import { useViewState } from '@/components/views/use-view-state';
import { api } from '@/lib/api';
import { userErrorMessage } from '@/lib/problem';
import { apiQueryOptions, queryKeys, STALE, useApiListQuery, usePrefetchApi } from '@/lib/query';
import { useOrgCapability } from '@/lib/use-org-capability';
import { taskDetailDef } from '@/lib/use-task-detail';
import { useRenameTask } from '@/lib/use-rename-task';

/** The workspace's full task roster, filterable and groupable. */
export default function OrgTasksClient(): JSX.Element {
  const router = useRouter();
  const { orgId } = useAppParams<{ orgId: string }>();
  const queryClient = useQueryClient();
  const prefetch = usePrefetchApi();
  const { teams, defaultTeamId, teamsLoading } = useActiveOrg();
  const projectNoun = useVocabulary('project');
  const programNoun = useVocabulary('program');
  const [createOpen, setCreateOpen] = useState(false);
  const { state, setFilters, setGroupBy, setSort } = useViewState();

  const tasksQ = useApiListQuery(
    apiQueryOptions(
      queryKeys.tasks(orgId),
      () => api.v1.orgs[':orgId'].tasks.$get({ param: { orgId }, query: {} }),
      'Could not load tasks.',
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

  const tasks = useMemo(() => tasksQ.data?.items ?? [], [tasksQ.data]);
  const members = useMemo(() => membersQ.data?.items ?? [], [membersQ.data]);
  const projects = useMemo(() => projectsQ.data?.items ?? [], [projectsQ.data]);
  const programs = useMemo(() => programsQ.data?.items ?? [], [programsQ.data]);
  const roles = useMemo(() => rolesQ.data?.items ?? [], [rolesQ.data]);

  const canEdit = useOrgCapability(members, roles, 'contribute');
  const renameTask = useRenameTask(orgId, [queryKeys.tasks(orgId)]);

  // Keyed by plain `string`: the ids arriving from the catalog and column resolvers are opaque
  // strings, not the branded id types the DTOs carry, so branding the map keys would only force a
  // cast at every lookup.
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

  const catalog = useMemo(
    () =>
      buildTaskCatalog({
        projectLabel: projectNoun,
        programLabel: programNoun,
        resolveProject: (id) => projectNameById.get(id) ?? id,
        resolveProgram: (id) => programNameById.get(id) ?? id,
        resolveAssignee: (id) => memberById.get(id)?.displayName ?? id,
        assigneeOptions: (): readonly FieldOption[] =>
          members.map((member) => ({ value: member.actorId, label: member.displayName })),
        projectOptions: (): readonly FieldOption[] =>
          projects.map((project) => ({ value: project.id, label: project.name })),
        programOptions: (): readonly FieldOption[] =>
          programs.map((program) => ({ value: program.id, label: program.name })),
      }),
    [
      memberById,
      members,
      programNameById,
      programNoun,
      programs,
      projectNameById,
      projectNoun,
      projects,
    ],
  );

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

  const handleCreated = useCallback(
    (created: TaskOut): void => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks(orgId) });
      router.push(`/orgs/${orgId}/tasks/${created.id}`);
    },
    [orgId, queryClient, router],
  );

  return (
    <ListPageLayout
      title="Tasks"
      actions={
        canEdit ? (
          <Button
            className="min-h-10 gap-1.5"
            onClick={() => {
              setCreateOpen(true);
            }}
          >
            <Plus aria-hidden className="size-4" /> New task
          </Button>
        ) : null
      }
      toolbar={
        tasks.length > 0 ? (
          <FilterToolbar
            catalog={catalog}
            state={state}
            onFiltersChange={setFilters}
            onGroupByChange={setGroupBy}
            onSortChange={setSort}
          />
        ) : null
      }
    >
      <CreateTaskDialog
        orgId={orgId}
        teams={teams}
        defaultTeamId={defaultTeamId}
        teamsLoading={teamsLoading}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={handleCreated}
      />

      {/* placeholder: the task rows — how many tasks the workspace has and each one's title,
          status, assignee, due date and estimate. The heading, filters and "New task" action above
          are static copy and paint immediately. */}
      {tasksQ.isPending ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }, (_, index) => (
            <Skeleton key={index} className="h-9 w-full" />
          ))}
        </div>
      ) : tasksQ.isError ? (
        <p role="alert" className="text-error text-body-medium">
          {userErrorMessage(tasksQ.error, 'Could not load tasks.')}
        </p>
      ) : tasks.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="No tasks yet"
          body="Every piece of work in this workspace lands here — assigned, scheduled, and tracked."
          {...(canEdit
            ? {
                cta: {
                  label: 'Create your first task',
                  onClick: () => {
                    setCreateOpen(true);
                  },
                },
              }
            : {})}
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
          label="Tasks"
        />
      )}
    </ListPageLayout>
  );
}
