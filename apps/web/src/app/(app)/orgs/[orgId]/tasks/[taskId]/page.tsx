'use client';

import {
  ActorId,
  type AgentOut,
  type AgentSessionOut,
  type CommentOut,
  CycleId,
  type CycleOut,
  MilestoneId,
  type MemberOut,
  type MilestoneOut,
  type Priority,
  ProgramId,
  type ProgramOut,
  ProjectId,
  type ProjectOut,
  type RoleOut,
  type SessionActivityOut,
  type TaskDetail,
  type TaskOut,
  type WorkflowState,
} from '@docket/types';
import {
  ActorAvatar,
  ActorPicker,
  DatePicker,
  EntityPicker,
  type PickerOption,
} from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { Badge, Separator, Skeleton } from '@docket/ui/primitives';
import { type QueryKey, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { type JSX, useCallback, useMemo } from 'react';

import { formatWindow } from '@/components/cycles/format-window';
import { CommentActivityFeed, type FeedActor } from '@/components/task-detail/CommentActivityFeed';
import { Dependencies } from '@/components/task-detail/Dependencies';
import { PriorityPicker } from '@/components/task-detail/PriorityPicker';
import { PropertyRow } from '@/components/task-detail/PropertyRow';
import { StatusPicker } from '@/components/task-detail/StatusPicker';
import { Subtasks } from '@/components/task-detail/Subtasks';
import {
  cycleOptions as toCycleOptions,
  memberActorOptions,
  programOptions as toProgramOptions,
  projectOptions as toProjectOptions,
} from '@/components/property-pickers/options';
import { api } from '@/lib/api';
import { formatCalendarDate } from '@/lib/format-date';
import { queryKeys, unwrap, useApiQuery, useApiMutation } from '@/lib/query';
import { useOrgCapability } from '@/lib/use-org-capability';
import { stateTypeOf } from '@/lib/work-state';

/** Format an ISO date/datetime string as a short, locale-aware day, or a dash when absent. */
function formatDate(value: string | null | undefined): string {
  return formatCalendarDate(value) ?? '—';
}

/**
 * Reduce a wire date/timestamp to its bare `YYYY-MM-DD` calendar day for the date picker.
 *
 * @remarks
 * A task's `dueDate` may arrive as a full ISO timestamp; the {@link DatePicker} (and the
 * `z.iso.date()` update DTO) want a bare calendar day, so slice the leading date component.
 */
function isoDateOf(value: string): string {
  return value.slice(0, 10);
}

/**
 * The task detail view — the full single-task surface (mvp-plan §8.5).
 *
 * @remarks
 * A Client Component reached at `/orgs/[orgId]/tasks/[taskId]`. It loads the rich task
 * detail (`GET /tasks/:id`, carrying dependency refs + subtasks), the task's team (for the
 * workflow states that bound the editable status), and the org's projects, programs,
 * members, agents, comments, and agent sessions. The header leads with the title, an
 * editable {@link StatusPicker | status} and {@link PriorityPicker | priority}, the
 * assignee/delegate {@link ActorAvatar}s, and the due date; a PROPERTIES panel lists the
 * task's project / program / milestone / cycle / external link as labeled rows; the
 * description is followed by an inline {@link Subtasks} checklist; a dedicated
 * {@link Dependencies} section shows the cross-project blocking / blocked-by graph; and a
 * {@link CommentActivityFeed} merges human comments with the task's agent-session activity
 * inline. Entity nouns route through {@link useVocabulary}.
 *
 * Reads run through {@link useApiQuery}, so every slice auto-refetches on window focus and
 * after any mutation — there is no manual refresh. Mutations run through {@link useApiMutation}
 * with optimistic cache updates against the task-detail key (rolled back on failure) and a
 * settle-time invalidation of that key (and the org's task list) so the UI feels instant while
 * staying authoritative. Data is fetched at runtime, so the production build needs no server.
 */
export default function TaskDetailPage(): JSX.Element {
  const router = useRouter();
  const params = useParams<{ orgId: string; taskId: string }>();
  const { orgId, taskId } = params;
  const queryClient = useQueryClient();

  const projectLabel = useVocabulary('project');
  const programLabel = useVocabulary('program');
  const cycleLabel = useVocabulary('cycle');

  // The canonical detail key every mutation invalidates + optimistically writes against.
  const detailKey = useMemo<QueryKey>(() => queryKeys.task(orgId, taskId), [orgId, taskId]);

  // The primary read: the rich task detail (carries dependencies + subtasks).
  const taskQ = useApiQuery(
    detailKey,
    () => api.v1.orgs[':orgId'].tasks[':id'].$get({ param: { orgId, id: taskId } }),
    'Could not load this task.',
  );
  const task = taskQ.data ?? null;
  const teamId = task?.teamId ?? null;

  // The task's team carries the workflow states that bound the editable status. Gated on the
  // team id, which only resolves after the detail loads. The hook's single generic is the full
  // body, so the slice (`.workflowStates`) is read off `.data` rather than via `select`.
  const teamQ = useApiQuery(
    [...queryKeys.team(orgId, teamId ?? ''), 'workflow'],
    () => api.v1.orgs[':orgId'].teams[':teamId'].$get({ param: { orgId, teamId: teamId ?? '' } }),
    'Could not load the workflow.',
    { enabled: Boolean(teamId) },
  );
  const workflowStates: readonly WorkflowState[] | null = teamQ.data?.workflowStates ?? null;

  // The org rosters the pickers + actor resolution draw from. Each read resolves the full
  // `{ items }` body; the `.items` slice is read off `.data` (the hook keys on the whole body).
  const projectsQ = useApiQuery(
    queryKeys.projects(orgId),
    () => api.v1.orgs[':orgId'].projects.$get({ param: { orgId } }),
    'Could not load projects.',
  );
  const programsQ = useApiQuery(
    queryKeys.programs(orgId),
    () => api.v1.orgs[':orgId'].programs.$get({ param: { orgId } }),
    'Could not load programs.',
  );
  const membersQ = useApiQuery(
    queryKeys.members(orgId),
    () => api.v1.orgs[':orgId'].members.$get({ param: { orgId } }),
    'Could not load members.',
  );
  const agentsQ = useApiQuery(
    ['org', orgId, 'agents'],
    () => api.v1.orgs[':orgId'].agents.$get({ param: { orgId } }),
    'Could not load agents.',
  );
  const milestonesQ = useApiQuery(
    ['org', orgId, 'milestones'],
    () => api.v1.orgs[':orgId'].milestones.$get({ param: { orgId }, query: {} }),
    'Could not load milestones.',
  );
  const cyclesQ = useApiQuery(
    queryKeys.cycles(orgId),
    () => api.v1.orgs[':orgId'].cycles.$get({ param: { orgId } }),
    'Could not load cycles.',
  );
  const rolesQ = useApiQuery(
    queryKeys.roles(orgId),
    () => api.v1.orgs[':orgId'].roles.$get({ param: { orgId } }),
    'Could not load roles.',
  );

  const projects: readonly ProjectOut[] = projectsQ.data?.items ?? [];
  const programs: readonly ProgramOut[] = programsQ.data?.items ?? [];
  const members: readonly MemberOut[] = membersQ.data?.items ?? [];
  const agents: readonly AgentOut[] = agentsQ.data?.items ?? [];
  const milestones: readonly MilestoneOut[] = milestonesQ.data?.items ?? [];
  const cycles: readonly CycleOut[] = cyclesQ.data?.items ?? [];
  const roles: readonly RoleOut[] = rolesQ.data?.items ?? [];

  // The task's comment stream (subject-scoped). Keyed under the task so a comment mutation can
  // invalidate it by prefix.
  const commentsKey = useMemo<QueryKey>(() => [...detailKey, 'comments'], [detailKey]);
  const commentsQ = useApiQuery(
    commentsKey,
    () =>
      api.v1.orgs[':orgId'].comments.$get({
        param: { orgId },
        query: { subjectType: 'task', subjectId: taskId },
      }),
    'Could not load comments.',
  );
  const comments: readonly CommentOut[] = commentsQ.data?.items ?? [];

  // The task's agent session (if any) carries the inline activity stream. Sessions are listed
  // org-wide, so pick the most recent one bound to this task; keyed under the task.
  const sessionQ = useApiQuery(
    [...detailKey, 'session'],
    () => api.v1.orgs[':orgId'].sessions.$get({ param: { orgId }, query: {} }),
    'Could not load sessions.',
  );
  const taskSession: AgentSessionOut | null =
    sessionQ.data?.items.find((session) => session.taskId === taskId) ?? null;

  // The chosen session's ordered activity. Gated on a resolved session; absent one, the feed
  // shows comments only.
  const activityQ = useApiQuery(
    [...detailKey, 'activity', taskSession?.id ?? ''],
    () =>
      api.v1.orgs[':orgId'].sessions[':id'].activity.$get({
        param: { orgId, id: taskSession?.id ?? '' },
      }),
    'Could not load activity.',
    { enabled: Boolean(taskSession) },
  );
  const activities: readonly SessionActivityOut[] = activityQ.data?.items ?? [];

  /** Resolve a project id to its display name (used by the dependencies section). */
  const projectName = useCallback(
    (projectId: string): string =>
      projects.find((project) => project.id === projectId)?.name ?? projectLabel,
    [projects, projectLabel],
  );

  /** Resolve an actor id to display info: humans from members, agents tagged from the agent list. */
  const resolveActor = useCallback(
    (actorId: string | null | undefined): FeedActor => {
      if (!actorId) return { name: 'Unknown', kind: 'human' };
      const member = members.find((m) => m.actorId === actorId);
      if (member) return { name: member.displayName, kind: 'human', avatarUrl: member.avatar };
      if (agents.some((agent) => agent.actorId === actorId))
        return { name: 'Agent', kind: 'agent' };
      return { name: 'Unknown', kind: 'human' };
    },
    [members, agents],
  );

  /**
   * Optimistically merge a partial task patch into the detail-key cache, preserving the
   * detail-only fields (`blocking` / `blockedBy` / `subtasks` and the relations the base
   * `TaskOut` read-back omits) so a `TaskOut`-shaped server response never drops them.
   */
  const writeDetail = useCallback(
    (patch: Partial<TaskDetail>): TaskDetail | undefined => {
      const previous = queryClient.getQueryData<TaskDetail>(detailKey);
      queryClient.setQueryData<TaskDetail>(detailKey, (current) =>
        current ? { ...current, ...patch } : current,
      );
      return previous;
    },
    [queryClient, detailKey],
  );

  /** Adopt a `TaskOut` server read-back into the cache while keeping the detail-only fields. */
  const adoptTaskOut = useCallback(
    (updated: TaskOut): void => {
      queryClient.setQueryData<TaskDetail>(detailKey, (current) =>
        current
          ? {
              ...current,
              ...updated,
              blocking: current.blocking,
              blockedBy: current.blockedBy,
              subtasks: current.subtasks,
            }
          : current,
      );
    },
    [queryClient, detailKey],
  );

  /** Change the task's workflow state: optimistic write, settle-time invalidation. */
  const stateMutation = useApiMutation<TaskOut, string, { previous?: TaskDetail }>({
    mutationFn: (stateKey) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].tasks[':id'].state.$post({
            param: { orgId, id: taskId },
            json: { state: stateKey },
          }),
        'Could not update the status.',
      ),
    onMutate: async (stateKey) => {
      await queryClient.cancelQueries({ queryKey: detailKey });
      return { previous: writeDetail({ state: stateKey }) };
    },
    onError: (_err, _stateKey, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(detailKey, ctx.previous);
    },
    onSuccess: (updated) => {
      adoptTaskOut(updated);
    },
    invalidateKeys: [detailKey, queryKeys.tasks(orgId)],
  });

  /** Change the task's priority: optimistic write, settle-time invalidation. */
  const priorityMutation = useApiMutation<TaskOut, Priority, { previous?: TaskDetail }>({
    mutationFn: (priority) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].tasks[':id'].$patch({
            param: { orgId, id: taskId },
            json: { priority },
          }),
        'Could not update the priority.',
      ),
    onMutate: async (priority) => {
      await queryClient.cancelQueries({ queryKey: detailKey });
      return { previous: writeDetail({ priority }) };
    },
    onError: (_err, _priority, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(detailKey, ctx.previous);
    },
    onSuccess: (updated) => {
      adoptTaskOut(updated);
    },
    invalidateKeys: [detailKey, queryKeys.tasks(orgId)],
  });

  /**
   * The right-rail property patch (assignee / project / program / milestone / cycle / due date):
   * optimistic write, rollback on failure, settle-time invalidation.
   *
   * @remarks
   * Each field is a nullable relation/date the `TaskUpdate` DTO accepts; `null` clears it. The
   * optimistic snapshot and the request share one branded body so they never drift.
   */
  const patchMutation = useApiMutation<
    TaskOut,
    {
      assigneeId?: string | null;
      projectId?: string | null;
      programId?: string | null;
      milestoneId?: string | null;
      cycleId?: string | null;
      dueDate?: string | null;
    },
    { previous?: TaskDetail }
  >({
    mutationFn: (patch) => {
      const body = {
        ...(patch.assigneeId !== undefined
          ? { assigneeId: patch.assigneeId === null ? null : ActorId.parse(patch.assigneeId) }
          : {}),
        ...(patch.projectId !== undefined
          ? { projectId: patch.projectId === null ? null : ProjectId.parse(patch.projectId) }
          : {}),
        ...(patch.programId !== undefined
          ? { programId: patch.programId === null ? null : ProgramId.parse(patch.programId) }
          : {}),
        ...(patch.milestoneId !== undefined
          ? {
              milestoneId: patch.milestoneId === null ? null : MilestoneId.parse(patch.milestoneId),
            }
          : {}),
        ...(patch.cycleId !== undefined
          ? { cycleId: patch.cycleId === null ? null : CycleId.parse(patch.cycleId) }
          : {}),
        ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate } : {}),
      };
      return unwrap(
        () =>
          api.v1.orgs[':orgId'].tasks[':id'].$patch({
            param: { orgId, id: taskId },
            json: body,
          }),
        'Could not update the task.',
      );
    },
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: detailKey });
      // Mirror the request's null-clears / set semantics into the optimistic cache.
      return { previous: writeDetail(patch as Partial<TaskDetail>) };
    },
    onError: (_err, _patch, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(detailKey, ctx.previous);
    },
    onSuccess: (updated) => {
      adoptTaskOut(updated);
    },
    invalidateKeys: [detailKey, queryKeys.tasks(orgId)],
  });

  /** Add a subtask under this task by title; invalidate the detail so the checklist re-reads. */
  const addSubtaskMutation = useApiMutation<TaskOut, string>({
    mutationFn: (title) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].tasks[':id'].subtasks.$post({
            param: { orgId, id: taskId },
            json: { title },
          }),
        'Could not add the subtask.',
      ),
    invalidateKeys: [detailKey, queryKeys.tasks(orgId)],
  });

  /**
   * Toggle a subtask's completion via its own state transition, with an optimistic flip of the
   * subtask ref in the parent's cached `subtasks` list.
   */
  const toggleSubtaskMutation = useApiMutation<
    TaskOut,
    { subtaskId: string; done: boolean },
    { previous?: TaskDetail }
  >({
    mutationFn: ({ subtaskId, done }) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].tasks[':id'].state.$post({
            param: { orgId, id: subtaskId },
            json: { state: done ? 'done' : 'todo' },
          }),
        'Could not update the subtask.',
      ),
    onMutate: async ({ subtaskId, done }) => {
      await queryClient.cancelQueries({ queryKey: detailKey });
      const previous = queryClient.getQueryData<TaskDetail>(detailKey);
      queryClient.setQueryData<TaskDetail>(detailKey, (current) =>
        current
          ? {
              ...current,
              subtasks: current.subtasks.map((subtask) =>
                subtask.id === subtaskId ? { ...subtask, state: done ? 'done' : 'todo' } : subtask,
              ),
            }
          : current,
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(detailKey, ctx.previous);
    },
    invalidateKeys: [detailKey, queryKeys.tasks(orgId)],
  });

  /** Post a comment on this task; invalidate the comment stream so it re-reads. */
  const commentMutation = useApiMutation<CommentOut, string>({
    mutationFn: (body) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].comments.$post({
            param: { orgId },
            json: { subjectType: 'task', subjectId: taskId, body },
          }),
        'Could not post the comment.',
      ),
    invalidateKeys: [commentsKey],
  });

  const setState = useCallback(
    (stateKey: string): Promise<void> => stateMutation.mutateAsync(stateKey).then(() => undefined),
    [stateMutation],
  );
  const setPriority = useCallback(
    (priority: Priority): Promise<void> =>
      priorityMutation.mutateAsync(priority).then(() => undefined),
    [priorityMutation],
  );
  const patchTask = useCallback(
    (patch: Parameters<typeof patchMutation.mutateAsync>[0]): void => {
      patchMutation.mutate(patch);
    },
    [patchMutation],
  );
  const addSubtask = useCallback(
    (title: string): Promise<void> => addSubtaskMutation.mutateAsync(title).then(() => undefined),
    [addSubtaskMutation],
  );
  const toggleSubtask = useCallback(
    (subtaskId: string, done: boolean): Promise<void> =>
      toggleSubtaskMutation.mutateAsync({ subtaskId, done }).then(() => undefined),
    [toggleSubtaskMutation],
  );
  const addComment = useCallback(
    (body: string): Promise<void> => commentMutation.mutateAsync(body).then(() => undefined),
    [commentMutation],
  );

  /** Navigate to another task's detail (subtask / dependency links). */
  const openTask = useCallback(
    (id: string): void => {
      router.push(`/orgs/${orgId}/tasks/${id}`);
    },
    [router, orgId],
  );

  const delegate = useMemo(
    () => (task?.delegateId ? resolveActor(task.delegateId) : null),
    [task, resolveActor],
  );

  // Editing a task property requires `contribute`; gate the rail's affordances on it.
  const canEdit = useOrgCapability(members, roles, 'contribute');
  const memberOptions = useMemo<readonly PickerOption[]>(
    () => memberActorOptions(members),
    [members],
  );
  const projectOptions = useMemo<readonly PickerOption[]>(
    () => toProjectOptions(projects),
    [projects],
  );
  const programOptions = useMemo<readonly PickerOption[]>(
    () => toProgramOptions(programs),
    [programs],
  );
  const cycleOptions = useMemo<readonly PickerOption[]>(
    () => toCycleOptions(cycles, cycleLabel, formatWindow),
    [cycles, cycleLabel],
  );
  // A task's milestones are project-scoped; only the current project's milestones are valid.
  const milestoneOptions = useMemo<readonly PickerOption[]>(
    () =>
      milestones
        .filter((milestone) => milestone.projectId === task?.projectId)
        .map((milestone) => ({ value: milestone.id, label: milestone.name })),
    [milestones, task?.projectId],
  );

  // Any in-flight write disables the rail's pickers; the status/priority chips track their own.
  const propsPending = patchMutation.isPending;
  const statusPending = stateMutation.isPending;
  const priorityPending = priorityMutation.isPending;
  // The first authoritative error surfaced by any mutation (newest takes precedence).
  const actionError =
    patchMutation.error?.message ??
    stateMutation.error?.message ??
    priorityMutation.error?.message ??
    addSubtaskMutation.error?.message ??
    toggleSubtaskMutation.error?.message ??
    commentMutation.error?.message ??
    null;

  if (taskQ.isPending) {
    return (
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 @2xl:p-6 @4xl:p-8">
        <Skeleton className="h-9 w-2/3" />
        <div className="flex gap-2">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-8 w-24" />
        </div>
        <Skeleton className="h-32 w-full rounded-lg" />
        <Skeleton className="h-48 w-full rounded-lg" />
      </div>
    );
  }

  if (taskQ.isError) {
    return (
      <div className="mx-auto w-full max-w-6xl p-4 @2xl:p-6 @4xl:p-8">
        <p
          role="alert"
          className="border-outline-variant text-destructive rounded-lg border p-4 text-sm"
        >
          {taskQ.error.message}
        </p>
      </div>
    );
  }

  if (!task) {
    return (
      <div className="mx-auto w-full max-w-6xl p-4 @2xl:p-6 @4xl:p-8">
        <p className="border-outline-variant text-on-surface-variant rounded-lg border border-dashed p-6 text-center text-sm">
          This task could not be found.
        </p>
      </div>
    );
  }

  const provenance = task.provenance;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 @2xl:p-6 @4xl:p-8">
      {/* Header: title, editable status + priority, assignee/delegate, due date. */}
      <header className="flex flex-col gap-4">
        <h1 className="text-on-surface text-xl leading-tight font-semibold tracking-tight">
          {task.title}
        </h1>

        <div className="flex flex-wrap items-center gap-2">
          <StatusPicker
            current={task.state}
            states={workflowStates}
            currentType={stateTypeOf(task.state)}
            onSelect={(stateKey) => {
              void setState(stateKey);
            }}
            pending={statusPending}
          />
          <PriorityPicker
            current={task.priority}
            onSelect={(priority) => {
              void setPriority(priority);
            }}
            pending={priorityPending}
          />
          <Separator orientation="vertical" className="h-6" />
          <ActorPicker
            options={memberOptions}
            value={task.assigneeId ?? null}
            onChange={(assigneeId) => {
              patchTask({ assigneeId });
            }}
            placeholder="Assign"
            clearLabel="Unassigned"
            ariaLabel="Assignee"
            triggerVariant="outline"
            readOnly={!canEdit}
            disabled={propsPending}
          />
          {delegate ? (
            <span className="flex items-center gap-1.5 text-sm">
              <span className="text-on-surface-variant text-xs">delegate</span>
              <ActorAvatar
                kind={delegate.kind}
                name={delegate.name}
                avatarUrl={delegate.avatarUrl}
              />
              <span className="text-on-surface-variant">{delegate.name}</span>
            </span>
          ) : null}
          <Separator orientation="vertical" className="h-6" />
          <DatePicker
            value={task.dueDate ? isoDateOf(task.dueDate) : null}
            onChange={(dueDate) => {
              patchTask({ dueDate });
            }}
            placeholder="Set due date"
            formatLabel={(value) => formatCalendarDate(value) ?? undefined}
            ariaLabel="Due date"
            triggerVariant="outline"
            readOnly={!canEdit}
            disabled={propsPending}
          />
        </div>

        {actionError ? (
          <p role="alert" className="text-destructive text-sm">
            {actionError}
          </p>
        ) : null}
      </header>

      <div className="grid grid-cols-1 gap-6 @4xl:grid-cols-[minmax(0,1fr)_18rem]">
        {/* Main column: description, subtasks, dependencies, activity. */}
        <div className="flex min-w-0 flex-col gap-6">
          <section aria-labelledby="description-heading" className="flex flex-col gap-2">
            <h2 id="description-heading" className="sr-only">
              Description
            </h2>
            {task.description ? (
              <p className="text-on-surface text-sm leading-relaxed whitespace-pre-wrap">
                {task.description}
              </p>
            ) : (
              <p className="text-on-surface-variant text-sm">No description.</p>
            )}
          </section>

          <Subtasks
            subtasks={task.subtasks}
            onAdd={addSubtask}
            onToggle={(subtask, done) => toggleSubtask(subtask.id, done)}
            onOpen={openTask}
            canEdit
          />

          <Dependencies
            blocking={task.blocking}
            blockedBy={task.blockedBy}
            projectName={projectName}
            projectLabel={projectLabel}
            onOpen={openTask}
          />

          <CommentActivityFeed
            comments={comments}
            activities={activities}
            resolveActor={resolveActor}
            onComment={addComment}
            canComment
          />
        </div>

        {/* Properties panel: project / program / milestone / cycle / labels / links.
            On a narrow panel the grid stacks, so the panel takes a top divider; at `@4xl` it
            sits in the right rail and takes a left divider instead. */}
        <aside
          aria-labelledby="properties-heading"
          className="border-outline-variant border-t pt-6 @4xl:border-t-0 @4xl:border-l @4xl:pt-0 @4xl:pl-6"
        >
          <h2 id="properties-heading" className="text-on-surface-variant mb-2 text-xs font-medium">
            Properties
          </h2>
          <div className="divide-outline-variant flex flex-col divide-y">
            <PropertyRow label={projectLabel}>
              <EntityPicker
                options={projectOptions}
                value={task.projectId ?? null}
                onChange={(projectId) => {
                  patchTask({ projectId });
                }}
                placeholder={`Set ${projectLabel.toLowerCase()}`}
                clearLabel={`No ${projectLabel.toLowerCase()}`}
                searchPlaceholder={`Search ${projectLabel.toLowerCase()}s…`}
                ariaLabel={projectLabel}
                readOnly={!canEdit}
                disabled={propsPending}
              />
            </PropertyRow>

            <PropertyRow label={programLabel}>
              <EntityPicker
                options={programOptions}
                value={task.programId ?? null}
                onChange={(programId) => {
                  patchTask({ programId });
                }}
                placeholder={`Set ${programLabel.toLowerCase()}`}
                clearLabel={`No ${programLabel.toLowerCase()}`}
                searchPlaceholder={`Search ${programLabel.toLowerCase()}s…`}
                ariaLabel={programLabel}
                readOnly={!canEdit}
                disabled={propsPending}
              />
            </PropertyRow>

            <PropertyRow label="Milestone">
              <EntityPicker
                options={milestoneOptions}
                value={task.milestoneId ?? null}
                onChange={(milestoneId) => {
                  patchTask({ milestoneId });
                }}
                placeholder={
                  task.projectId ? 'Set milestone' : `Set a ${projectLabel.toLowerCase()} first`
                }
                clearLabel="No milestone"
                searchPlaceholder="Search milestones…"
                emptyText={
                  task.projectId
                    ? 'No milestones'
                    : `Set a ${projectLabel.toLowerCase()} to choose a milestone`
                }
                ariaLabel="Milestone"
                readOnly={!canEdit || !task.projectId}
                disabled={propsPending}
              />
            </PropertyRow>

            <PropertyRow label={cycleLabel}>
              <EntityPicker
                options={cycleOptions}
                value={task.cycleId ?? null}
                onChange={(cycleId) => {
                  patchTask({ cycleId });
                }}
                placeholder={`Set ${cycleLabel.toLowerCase()}`}
                clearLabel={`No ${cycleLabel.toLowerCase()}`}
                searchPlaceholder={`Search ${cycleLabel.toLowerCase()}s…`}
                ariaLabel={cycleLabel}
                readOnly={!canEdit}
                disabled={propsPending}
              />
            </PropertyRow>

            <PropertyRow label="Estimate">
              {typeof task.estimate === 'number' ? (
                <span>
                  {task.estimate} {task.estimate === 1 ? 'point' : 'points'}
                </span>
              ) : (
                <span className="text-on-surface-variant">None</span>
              )}
            </PropertyRow>

            <PropertyRow label="Source">
              {provenance.source === 'linked' && provenance.externalUrl ? (
                <a
                  href={provenance.externalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary focus-visible:ring-ring inline-flex items-center gap-1 rounded text-sm underline-offset-4 hover:underline focus-visible:ring-1 focus-visible:outline-none"
                >
                  External link
                </a>
              ) : (
                <Badge variant="secondary">
                  {provenance.source === 'linked' ? 'Linked' : 'Native'}
                </Badge>
              )}
            </PropertyRow>

            <PropertyRow label="Created">
              <span className="text-on-surface-variant">{formatDate(task.createdAt)}</span>
            </PropertyRow>
          </div>
        </aside>
      </div>
    </div>
  );
}
