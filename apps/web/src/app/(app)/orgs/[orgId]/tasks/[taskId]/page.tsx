'use client';

import {
  ActorId,
  type AgentOut,
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
import { useParams, useRouter } from 'next/navigation';
import { type JSX, useCallback, useEffect, useMemo, useState } from 'react';

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
import { readError, readProblem } from '@/lib/problem';
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
 * inline. Entity nouns route through {@link useVocabulary}. All mutations re-read the
 * affected slice. Data is fetched at runtime, so the production build needs no server.
 */
export default function TaskDetailPage(): JSX.Element {
  const router = useRouter();
  const params = useParams<{ orgId: string; taskId: string }>();
  const { orgId, taskId } = params;

  const projectLabel = useVocabulary('project');
  const programLabel = useVocabulary('program');
  const cycleLabel = useVocabulary('cycle');

  const [task, setTask] = useState<TaskDetail | null>(null);
  const [workflowStates, setWorkflowStates] = useState<readonly WorkflowState[] | null>(null);
  const [projects, setProjects] = useState<readonly ProjectOut[]>([]);
  const [programs, setPrograms] = useState<readonly ProgramOut[]>([]);
  const [members, setMembers] = useState<readonly MemberOut[]>([]);
  const [agents, setAgents] = useState<readonly AgentOut[]>([]);
  const [milestones, setMilestones] = useState<readonly MilestoneOut[]>([]);
  const [cycles, setCycles] = useState<readonly CycleOut[]>([]);
  const [roles, setRoles] = useState<readonly RoleOut[]>([]);
  const [comments, setComments] = useState<readonly CommentOut[]>([]);
  const [activities, setActivities] = useState<readonly SessionActivityOut[]>([]);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusPending, setStatusPending] = useState(false);
  const [priorityPending, setPriorityPending] = useState(false);
  // Pending flag for the right-rail property pickers (assignee/project/program/…/labels).
  const [propsPending, setPropsPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  /** Load the task detail and every slice the surface composes. */
  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    try {
      const taskRes = await api.v1.orgs[':orgId'].tasks[':id'].$get({
        param: { orgId, id: taskId },
      });
      if (!taskRes.ok) {
        setLoadError(await readProblem(taskRes, 'Could not load this task.'));
        return;
      }
      const detail = await taskRes.json();
      setTask(detail);

      const [
        teamRes,
        projectsRes,
        programsRes,
        membersRes,
        agentsRes,
        milestonesRes,
        cyclesRes,
        rolesRes,
        commentsRes,
        sessionsRes,
      ] = await Promise.all([
        api.v1.orgs[':orgId'].teams[':teamId'].$get({
          param: { orgId, teamId: detail.teamId },
        }),
        api.v1.orgs[':orgId'].projects.$get({ param: { orgId } }),
        api.v1.orgs[':orgId'].programs.$get({ param: { orgId } }),
        api.v1.orgs[':orgId'].members.$get({ param: { orgId } }),
        api.v1.orgs[':orgId'].agents.$get({ param: { orgId } }),
        api.v1.orgs[':orgId'].milestones.$get({ param: { orgId }, query: {} }),
        api.v1.orgs[':orgId'].cycles.$get({ param: { orgId } }),
        api.v1.orgs[':orgId'].roles.$get({ param: { orgId } }),
        api.v1.orgs[':orgId'].comments.$get({
          param: { orgId },
          query: { subjectType: 'task', subjectId: taskId },
        }),
        api.v1.orgs[':orgId'].sessions.$get({ param: { orgId }, query: {} }),
      ]);

      if (teamRes.ok) setWorkflowStates((await teamRes.json()).workflowStates);
      if (projectsRes.ok) setProjects((await projectsRes.json()).items);
      if (programsRes.ok) setPrograms((await programsRes.json()).items);
      if (membersRes.ok) setMembers((await membersRes.json()).items);
      if (agentsRes.ok) setAgents((await agentsRes.json()).items);
      if (milestonesRes.ok) setMilestones((await milestonesRes.json()).items);
      if (cyclesRes.ok) setCycles((await cyclesRes.json()).items);
      if (rolesRes.ok) setRoles((await rolesRes.json()).items);
      if (commentsRes.ok) setComments((await commentsRes.json()).items);

      // The task's agent session (if any) carries the inline activity stream. Sessions are
      // listed org-wide, so pick the most recent one bound to this task, then read its
      // ordered activity. Absent a session, the feed shows comments only.
      if (sessionsRes.ok) {
        const { items: sessionItems } = await sessionsRes.json();
        const taskSession = sessionItems.find((session) => session.taskId === taskId);
        if (taskSession) {
          const activityRes = await api.v1.orgs[':orgId'].sessions[':id'].activity.$get({
            param: { orgId, id: taskSession.id },
          });
          if (activityRes.ok) setActivities((await activityRes.json()).items);
          else setActivities([]);
        } else {
          setActivities([]);
        }
      }
    } catch (caught) {
      setLoadError(readError(caught, 'Something went wrong loading this task.'));
    } finally {
      setLoading(false);
    }
  }, [orgId, taskId]);

  useEffect(() => {
    void load();
  }, [load]);

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

  /** Change the task's workflow state, then re-read the detail. */
  const setState = useCallback(
    async (stateKey: string): Promise<void> => {
      setActionError(null);
      setStatusPending(true);
      try {
        const res = await api.v1.orgs[':orgId'].tasks[':id'].state.$post({
          param: { orgId, id: taskId },
          json: { state: stateKey },
        });
        if (!res.ok) {
          setActionError(await readProblem(res, 'Could not update the status.'));
          return;
        }
        await load();
      } catch (caught) {
        setActionError(readError(caught, 'Something went wrong updating the status.'));
      } finally {
        setStatusPending(false);
      }
    },
    [orgId, taskId, load],
  );

  /** Change the task's priority, then re-read the detail. */
  const setPriority = useCallback(
    async (priority: Priority): Promise<void> => {
      setActionError(null);
      setPriorityPending(true);
      try {
        const res = await api.v1.orgs[':orgId'].tasks[':id'].$patch({
          param: { orgId, id: taskId },
          json: { priority },
        });
        if (!res.ok) {
          setActionError(await readProblem(res, 'Could not update the priority.'));
          return;
        }
        await load();
      } catch (caught) {
        setActionError(readError(caught, 'Something went wrong updating the priority.'));
      } finally {
        setPriorityPending(false);
      }
    },
    [orgId, taskId, load],
  );

  /**
   * Optimistically patch a right-rail task property (assignee / project / program / milestone /
   * cycle / due date): apply the change locally, fire the PATCH, roll back on failure.
   *
   * @remarks
   * Each field is a nullable relation/date the {@link TaskUpdate} DTO accepts; `null` clears it.
   * The optimistic snapshot and the request share one branded body so they never drift, and the
   * picker is disabled (`propsPending`) while the request is in flight.
   */
  const patchTask = useCallback(
    async (patch: {
      assigneeId?: string | null;
      projectId?: string | null;
      programId?: string | null;
      milestoneId?: string | null;
      cycleId?: string | null;
      dueDate?: string | null;
    }): Promise<void> => {
      if (!task) return;
      const previous = task;
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
      setTask({ ...task, ...body });
      setActionError(null);
      setPropsPending(true);
      try {
        const res = await api.v1.orgs[':orgId'].tasks[':id'].$patch({
          param: { orgId, id: taskId },
          json: body,
        });
        if (!res.ok) {
          setTask(previous);
          setActionError(await readProblem(res, 'Could not update the task.'));
          return;
        }
        // The patch read-back carries only the base task shape; preserve the detail-only fields
        // (dependencies, subtasks) from the prior detail while adopting the updated columns.
        const updated = await res.json();
        setTask((current) =>
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
      } catch (caught) {
        setTask(previous);
        setActionError(readError(caught, 'Something went wrong updating the task.'));
      } finally {
        setPropsPending(false);
      }
    },
    [task, orgId, taskId],
  );

  /** Add a subtask under this task by title, then re-read the detail. */
  const addSubtask = useCallback(
    async (title: string): Promise<void> => {
      setActionError(null);
      try {
        const res = await api.v1.orgs[':orgId'].tasks[':id'].subtasks.$post({
          param: { orgId, id: taskId },
          json: { title },
        });
        if (!res.ok) {
          setActionError(await readProblem(res, 'Could not add the subtask.'));
          return;
        }
        await load();
      } catch (caught) {
        setActionError(readError(caught, 'Something went wrong adding the subtask.'));
      }
    },
    [orgId, taskId, load],
  );

  /** Toggle a subtask's completion via its own state transition, then re-read the detail. */
  const toggleSubtask = useCallback(
    async (subtaskId: string, done: boolean): Promise<void> => {
      setActionError(null);
      try {
        const res = await api.v1.orgs[':orgId'].tasks[':id'].state.$post({
          param: { orgId, id: subtaskId },
          json: { state: done ? 'done' : 'todo' },
        });
        if (!res.ok) {
          setActionError(await readProblem(res, 'Could not update the subtask.'));
          return;
        }
        await load();
      } catch (caught) {
        setActionError(readError(caught, 'Something went wrong updating the subtask.'));
      }
    },
    [orgId, taskId, load],
  );

  /** Post a comment on this task, then re-read the comment stream. */
  const addComment = useCallback(
    async (body: string): Promise<void> => {
      setActionError(null);
      try {
        const res = await api.v1.orgs[':orgId'].comments.$post({
          param: { orgId },
          json: { subjectType: 'task', subjectId: taskId, body },
        });
        if (!res.ok) {
          setActionError(await readProblem(res, 'Could not post the comment.'));
          return;
        }
        const commentsRes = await api.v1.orgs[':orgId'].comments.$get({
          param: { orgId },
          query: { subjectType: 'task', subjectId: taskId },
        });
        if (commentsRes.ok) setComments((await commentsRes.json()).items);
      } catch (caught) {
        setActionError(readError(caught, 'Something went wrong posting the comment.'));
      }
    },
    [orgId, taskId],
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

  if (loading) {
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

  if (loadError) {
    return (
      <div className="mx-auto w-full max-w-6xl p-4 @2xl:p-6 @4xl:p-8">
        <p
          role="alert"
          className="border-outline-variant text-destructive rounded-lg border p-4 text-sm"
        >
          {loadError}
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
              void patchTask({ assigneeId });
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
              void patchTask({ dueDate });
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
          <h2
            id="properties-heading"
            className="text-on-surface-variant mb-2 text-xs font-medium tracking-wide uppercase"
          >
            Properties
          </h2>
          <div className="divide-outline-variant flex flex-col divide-y">
            <PropertyRow label={projectLabel}>
              <EntityPicker
                options={projectOptions}
                value={task.projectId ?? null}
                onChange={(projectId) => {
                  void patchTask({ projectId });
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
                  void patchTask({ programId });
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
                  void patchTask({ milestoneId });
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
                  void patchTask({ cycleId });
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
