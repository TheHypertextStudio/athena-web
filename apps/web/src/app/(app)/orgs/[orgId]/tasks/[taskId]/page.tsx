'use client';

import { type Priority } from '@docket/types';
import {
  ActorAvatar,
  ActorPicker,
  DatePicker,
  type ActorKind,
  type PickerOption,
} from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { Ellipsis, Trash2 } from '@docket/ui/icons';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Separator,
  Skeleton,
} from '@docket/ui/primitives';
import { useParams, useRouter } from 'next/navigation';
import { type JSX, useCallback, useMemo, useState } from 'react';

import TaskGraphPanel from '@/components/canvas/task-graph-panel';
import { ConfirmDeleteDialog } from '@/components/confirm-delete-dialog';
import { EditableTitle } from '@/components/editor/editable-title';
import { formatWindow } from '@/components/cycles/format-window';
import { Dependencies } from '@/components/task-detail/Dependencies';
import { PriorityPicker } from '@/components/task-detail/PriorityPicker';
import { StatusPicker } from '@/components/task-detail/StatusPicker';
import { Subtasks } from '@/components/task-detail/Subtasks';
import TaskAttachments from '@/components/task-detail/TaskAttachments';
import { TaskPropertiesRail } from '@/components/task-detail/task-properties-rail';
import {
  cycleOptions as toCycleOptions,
  memberActorOptions,
  programOptions as toProgramOptions,
  projectOptions as toProjectOptions,
} from '@/components/property-pickers/options';
import { formatCalendarDate } from '@/lib/format-date';
import { useTaskDetail } from '@/lib/use-task-detail';
import { useTaskMutations } from '@/lib/use-task-mutations';
import { useOrgCapability } from '@/lib/use-org-capability';
import { stateTypeOf } from '@/lib/work-state';

function isoDateOf(value: string): string {
  return value.slice(0, 10);
}

interface TaskFeedActor {
  name: string;
  kind: ActorKind;
  avatarUrl?: string | null;
}

/** TaskDetailPage renders the authenticated task page. */
export default function TaskDetailPage(): JSX.Element {
  const router = useRouter();
  const params = useParams<{ orgId: string; taskId: string }>();
  const { orgId, taskId } = params;

  const projectLabel = useVocabulary('project');
  const programLabel = useVocabulary('program');
  const cycleLabel = useVocabulary('cycle');

  const {
    task,
    workflowStates,
    projects,
    programs,
    members,
    agents,
    milestones,
    cycles,
    roles,
    detailKey,
    isPending,
    isError,
    error,
  } = useTaskDetail(orgId, taskId);

  const {
    setState,
    setPriority,
    patchTask,
    addSubtask,
    toggleSubtask,
    deleteTask,
    resetDelete,
    actionError,
    propsPending,
    statusPending,
    priorityPending,
    deletePending,
    deleteError,
  } = useTaskMutations(orgId, taskId, detailKey, detailKey);

  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const resolveActor = useCallback(
    (actorId: string | null | undefined): TaskFeedActor => {
      if (!actorId) return { name: 'Unknown', kind: 'human' };
      const member = members.find((m) => m.actorId === actorId);
      if (member) return { name: member.displayName, kind: 'human', avatarUrl: member.avatar };
      if (agents.some((a) => a.actorId === actorId)) return { name: 'Agent', kind: 'agent' };
      return { name: 'Unknown', kind: 'human' };
    },
    [members, agents],
  );

  const projectName = useCallback(
    (projectId: string): string => projects.find((p) => p.id === projectId)?.name ?? projectLabel,
    [projects, projectLabel],
  );

  const delegate = useMemo(
    () => (task?.delegateId ? resolveActor(task.delegateId) : null),
    [task, resolveActor],
  );

  const canEdit = useOrgCapability(members, roles, 'contribute');
  const canManage = useOrgCapability(members, roles, 'manage');
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
  const milestoneOptions = useMemo<readonly PickerOption[]>(
    () =>
      milestones
        .filter((m) => m.projectId === task?.projectId)
        .map((m) => ({ value: m.id, label: m.name })),
    [milestones, task?.projectId],
  );

  const openTask = useCallback(
    (id: string): void => {
      router.push(`/orgs/${orgId}/tasks/${id}`);
    },
    [router, orgId],
  );

  const changeConfirmDeleteOpen = useCallback(
    (open: boolean): void => {
      // Clear any prior failure so a reopened dialog never shows a stale error.
      resetDelete();
      setConfirmDeleteOpen(open);
    },
    [resetDelete],
  );

  if (isPending) {
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

  if (isError) {
    return (
      <div className="mx-auto w-full max-w-6xl p-4 @2xl:p-6 @4xl:p-8">
        <p
          role="alert"
          className="border-outline-variant text-destructive text-body-medium rounded-lg border p-4"
        >
          {error}
        </p>
      </div>
    );
  }

  if (!task) {
    return (
      <div className="mx-auto w-full max-w-6xl p-4 @2xl:p-6 @4xl:p-8">
        <p className="border-outline-variant text-on-surface-variant text-body-medium rounded-lg border border-dashed p-6 text-center">
          This task could not be found.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 @2xl:p-6 @4xl:p-8">
      <header className="flex flex-col gap-4">
        <h1 className="leading-tight">
          <EditableTitle
            value={task.title}
            onSave={(title) => {
              patchTask({ title });
            }}
            canEdit={canEdit}
            saving={propsPending}
            ariaLabel="Task title"
            className="text-on-surface text-title-large leading-tight"
          />
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
            onSelect={(priority: Priority) => {
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
            <span className="text-body-medium flex items-center gap-1.5">
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
          {canManage ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="ml-auto h-8 w-8"
                  aria-label="Task actions"
                >
                  <Ellipsis className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[12rem]">
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={() => {
                    changeConfirmDeleteOpen(true);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                  Delete task
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>

        {actionError ? (
          <p role="alert" className="text-destructive text-body-medium">
            {actionError}
          </p>
        ) : null}
      </header>

      <div className="grid grid-cols-1 gap-6 @4xl:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <section aria-labelledby="description-heading" className="flex flex-col gap-2">
            <h2 id="description-heading" className="sr-only">
              Description
            </h2>
            {task.description ? (
              <p className="text-on-surface text-body-medium leading-relaxed whitespace-pre-wrap">
                {task.description}
              </p>
            ) : (
              <p className="text-on-surface-variant text-body-medium">No description.</p>
            )}
          </section>

          <Subtasks
            subtasks={task.subtasks}
            onAdd={addSubtask}
            onToggle={(subtask, done) => toggleSubtask(subtask.id, done)}
            onOpen={openTask}
            canEdit
          />

          <TaskAttachments orgId={orgId} taskId={taskId} canEdit={canEdit} />

          <Dependencies
            blocking={task.blocking}
            blockedBy={task.blockedBy}
            projectName={projectName}
            projectLabel={projectLabel}
            onOpen={openTask}
          />

          <section className="flex flex-col gap-2">
            <h2 className="text-on-surface text-title-small font-medium">Dependency map</h2>
            <div className="bg-surface-container h-80 overflow-hidden rounded-xl">
              <TaskGraphPanel
                scope={{ orgId, rootTaskId: taskId, depth: 2 }}
                density="compact"
                onExpand={() => {
                  router.push(`/orgs/${orgId}/graph?rootTaskId=${taskId}`);
                }}
              />
            </div>
          </section>
        </div>

        <TaskPropertiesRail
          task={task}
          projectLabel={projectLabel}
          programLabel={programLabel}
          cycleLabel={cycleLabel}
          projectOptions={projectOptions}
          programOptions={programOptions}
          milestoneOptions={milestoneOptions}
          cycleOptions={cycleOptions}
          canEdit={canEdit}
          propsPending={propsPending}
          onPatch={patchTask}
        />
      </div>

      <ConfirmDeleteDialog
        open={confirmDeleteOpen}
        onOpenChange={changeConfirmDeleteOpen}
        title="Delete this task?"
        description="This removes the task from your lists and boards, along with its subtasks and dependency links. You can't undo this."
        confirmLabel="Delete task"
        pending={deletePending}
        error={deleteError}
        onConfirm={() => {
          deleteTask({
            onSuccess: () => {
              setConfirmDeleteOpen(false);
              router.push(`/orgs/${orgId}/my-work`);
            },
          });
        }}
      />
    </div>
  );
}
