'use client';

import { type Priority } from '@docket/types';
import { ActorAvatar, ActorPicker, type ActorKind, type PickerOption } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { Skeleton, SkeletonChip, SkeletonText } from '@docket/ui/primitives';
import { useRouter } from 'next/navigation';
import { useAppParams } from '@/lib/app-location';
import { type JSX, useCallback, useMemo, useState } from 'react';

import { useDocumentTitle } from '@/components/tabs/use-document-title';
import { useRegisterTabTitle } from '@/components/tabs/use-register-tab-title';
import TaskGraphPanel from '@/components/canvas/task-graph-panel';
import { ConfirmDeleteDialog } from '@/components/confirm-delete-dialog';
import { ApplyDescriptionTemplateControl } from '@/components/editor/apply-description-template';
import { EditableTitle } from '@/components/editor/editable-title';
import { EntityDocument } from '@/components/editor/entity-document';
import { formatWindow } from '@/components/cycles/format-window';
import { Dependencies } from '@/components/task-detail/Dependencies';
import { CommentActivityFeed } from '@/components/task-detail/CommentActivityFeed';
import { PriorityPicker } from '@/components/task-detail/PriorityPicker';
import { StatusPicker } from '@/components/task-detail/StatusPicker';
import { Subtasks } from '@/components/task-detail/Subtasks';
import { MailAttachmentsPanel } from '@/components/athena/mail-attachments-panel';
import TaskAttachments from '@/components/task-detail/TaskAttachments';
import { TaskActivitySection } from '@/components/task-detail/task-activity-section';
import {
  TaskHeaderControls,
  TaskHeaderOverflowMenu,
} from '@/components/task-detail/task-header-controls';
import { TaskTimerButton } from '@/components/time-tracking';
import { TaskPropertiesRail } from '@/components/task-detail/task-properties-rail';
import {
  cycleOptions as toCycleOptions,
  labelOptions as toLabelOptions,
  memberActorOptions,
  programOptions as toProgramOptions,
  projectOptions as toProjectOptions,
} from '@/components/pickers/options';
import { labelsDef, useCreateLabel } from '@/components/labels/queries';
import { useApiListQuery } from '@/lib/query';
import { useEstimationScale } from '@/lib/use-estimation-scale';
import { useTaskDetail } from '@/lib/use-task-detail';
import { useTaskMutations } from '@/lib/use-task-mutations';
import { useOrgCapability } from '@/lib/use-org-capability';
import { useRenameTask } from '@/lib/use-rename-task';
import { useCategoryOf } from '@/components/entity-display/use-work-status';
import { TaskRepeatingWorkBacklink } from '@/components/recurrence/repeating-work-backlink';
import { useSession } from '@/lib/auth-client';

interface TaskFeedActor {
  name: string;
  kind: ActorKind;
  avatarUrl?: string | null | undefined;
}

/** TaskDetailPage renders the authenticated task page. */
export default function TaskDetailPage(): JSX.Element {
  const router = useRouter();
  const params = useAppParams<{ orgId: string; taskId: string }>();
  const { orgId, taskId } = params;

  const projectLabel = useVocabulary('project');
  const programLabel = useVocabulary('program');
  const cycleLabel = useVocabulary('cycle');
  const categoryOf = useCategoryOf('task');

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
    comments,
    activities,
    detailKey,
    commentsKey,
    isPending,
    isError,
    error,
  } = useTaskDetail(orgId, taskId);

  const { data: session } = useSession();
  const currentActorId =
    members.find((member) => member.userId === session?.user.id)?.actorId ?? null;

  // The tab bar and the browser tab both follow the name on screen, including through a rename.
  useRegisterTabTitle('task', orgId, taskId, task?.title);
  useDocumentTitle(task?.title);

  const {
    setState,
    setPriority,
    patchTask,
    addSubtask,
    toggleSubtask,
    addComment,
    deleteTask,
    resetDelete,
    actionError,
    statusPending,
    priorityPending,
    deletePending,
    deleteError,
  } = useTaskMutations(orgId, taskId, detailKey, commentsKey);

  const { scale: estimationScale } = useEstimationScale(orgId);

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
  const canComment = useOrgCapability(members, roles, 'comment');
  const canManage = useOrgCapability(members, roles, 'manage');
  // Rename any subtask in place (an arbitrary task by id), then re-read this task's detail so the
  // refreshed subtask titles flow back in.
  const renameSubtask = useRenameTask(orgId, [detailKey]);
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
    () => toCycleOptions(cycles, formatWindow),
    [cycles],
  );
  const labelsQ = useApiListQuery(labelsDef(orgId));
  const labelOptions = useMemo<readonly PickerOption[]>(
    () => toLabelOptions(labelsQ.data?.items ?? []),
    [labelsQ.data],
  );
  const createLabel = useCreateLabel(orgId);
  // Inline creation attaches as it creates: the user typed the name into *this* task's picker,
  // so leaving them to then find and tick it would be a second step nobody asked for.
  const onCreateLabel = useCallback(
    (name: string): void => {
      createLabel.mutate(
        { name },
        {
          onSuccess: (created) => {
            patchTask({ labels: [...(task?.labels ?? []).map((l) => l.id), created.id] });
          },
        },
      );
    },
    [createLabel, patchTask, task?.labels],
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
    // placeholder: the task's own record — its title, the state/priority/assignee controls whose
    // current values are the whole point of rendering them, its description, and its subtasks,
    // comments and relations. The route carries only a task id.
    return (
      // The same container, header block and two-column split the loaded page uses, so nothing
      // moves when the read resolves. A single column here was the visible bug: the content
      // column jumped left the moment the 18rem property rail appeared beside it.
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 @2xl:p-6 @4xl:p-8">
        <header className="flex flex-col gap-4">
          <SkeletonText scale="title" className="w-2/3 max-w-lg" />
          <div className="flex flex-wrap gap-2">
            <SkeletonChip className="w-32" />
            <SkeletonChip className="w-32" />
            <SkeletonChip className="w-24" />
          </div>
        </header>
        <div className="grid grid-cols-1 gap-6 @4xl:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="flex flex-col gap-6">
            <Skeleton className="h-32 w-full rounded-lg" />
            <Skeleton className="h-48 w-full rounded-lg" />
          </div>
          <Skeleton className="h-64 w-full rounded-lg" />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mx-auto w-full max-w-6xl p-4 @2xl:p-6 @4xl:p-8">
        <p
          role="alert"
          className="border-outline-variant text-error text-body-medium rounded-lg border p-4"
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
            ariaLabel="Task title"
            className="text-on-surface text-title-large leading-tight"
          />
        </h1>

        <TaskHeaderControls
          status={
            <StatusPicker
              current={task.state}
              states={workflowStates}
              currentType={categoryOf(task.state)}
              onSelect={(stateKey) => {
                void setState(stateKey);
              }}
              pending={statusPending}
            />
          }
          priority={
            <PriorityPicker
              current={task.priority}
              onSelect={(priority: Priority) => {
                void setPriority(priority);
              }}
              pending={priorityPending}
            />
          }
          assignee={
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
              triggerClassName="min-w-0 shrink"
              readOnly={!canEdit}
            />
          }
          delegate={
            delegate ? (
              <span className="text-body-medium flex min-w-0 items-center gap-1.5 whitespace-nowrap">
                <span className="text-on-surface-variant text-xs">delegate</span>
                <ActorAvatar
                  kind={delegate.kind}
                  name={delegate.name}
                  avatarUrl={delegate.avatarUrl}
                />
                <span className="text-on-surface-variant truncate">{delegate.name}</span>
              </span>
            ) : null
          }
          actions={
            // Track this task. Deliberately unconditional on workflow state and on `canEdit`:
            // time tracking is the viewer's own personal record of what they did, so it is not a
            // content mutation and a task being blocked, done or someone else's does not stop a
            // person having spent real time on it.
            <TaskTimerButton taskId={taskId} title={task.title} controlSize="md" />
          }
          overflow={
            <TaskHeaderOverflowMenu
              taskId={taskId}
              title={task.title}
              athenaContext={{
                workspaceId: orgId,
                source: { type: 'task', id: taskId, label: task.title },
              }}
              priority={task.priority}
              priorityPending={priorityPending}
              memberOptions={memberOptions}
              assigneeId={task.assigneeId ?? null}
              canEdit={canEdit}
              canManage={canManage}
              onPriorityChange={(priority) => {
                void setPriority(priority);
              }}
              onAssigneeChange={(assigneeId) => {
                patchTask({ assigneeId });
              }}
              onDelete={() => {
                changeConfirmDeleteOpen(true);
              }}
            />
          }
        />

        {actionError ? (
          <p role="alert" className="text-error text-body-medium">
            {actionError}
          </p>
        ) : null}
      </header>

      <TaskRepeatingWorkBacklink orgId={orgId} entityId={taskId} />

      <div className="grid grid-cols-1 gap-6 @4xl:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex min-w-0 flex-col gap-6">
          {/*
           * A task's description is an editor, not a read-out. It used to render as an inert
           * paragraph that said "No description." in placeholder grey next to an editable title —
           * which taught people the region was editable and then did nothing when they clicked
           * it, and left no way at all to add a description from here.
           */}
          <section aria-labelledby="description-heading" className="flex flex-col gap-2">
            <h2 id="description-heading" className="sr-only">
              Description
            </h2>
            <EntityDocument
              value={task.description}
              canEdit={canEdit}
              onSave={(description) => {
                patchTask({ description: description ?? '' });
              }}
              placeholder="Add a description…"
              headerActions={
                <ApplyDescriptionTemplateControl
                  orgId={orgId}
                  kind="task"
                  canEdit={canEdit}
                  current={task.description}
                  currentActorId={currentActorId}
                  teamId={task.teamId}
                  onApply={(description) => {
                    patchTask({ description });
                  }}
                />
              }
            />
          </section>

          <Subtasks
            subtasks={task.subtasks}
            onAdd={addSubtask}
            onToggle={(subtask, done) => toggleSubtask(subtask.id, done)}
            onOpen={openTask}
            onRename={renameSubtask}
            canEdit={canEdit}
          />

          <TaskAttachments orgId={orgId} taskId={taskId} canEdit={canEdit} />
          <MailAttachmentsPanel subjectType="task" subjectId={taskId} organizationId={orgId} />

          <Dependencies
            blocking={task.blocking}
            blockedBy={task.blockedBy}
            projectName={projectName}
            projectLabel={projectLabel}
            onOpen={openTask}
            canEdit={canEdit}
            onRename={renameSubtask}
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

          <CommentActivityFeed
            comments={comments}
            activities={activities}
            resolveActor={resolveActor}
            onComment={addComment}
            canComment={canComment}
          />

          <TaskActivitySection orgId={orgId} taskId={taskId} />
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
          labelOptions={labelOptions}
          onCreateLabel={onCreateLabel}
          estimationScale={estimationScale}
          canEdit={canEdit}
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
