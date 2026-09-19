'use client';

/**
 * The task masthead's actions: track time, and the overflow menu.
 *
 * @remarks
 * The timer is the one primary action. It is deliberately unconditional on workflow state and on
 * edit rights: time tracking is the viewer's own record of what they did, so it is not a content
 * mutation, and a task being blocked, done, or someone else's does not stop a person having spent
 * real time on it.
 */
import type { TaskDetail } from '@docket/work/task-model';
import type { PickerOption } from '@docket/ui/components';
import { ControlGroup } from '@docket/ui/primitives';
import type { JSX } from 'react';

import { TaskTimerButton } from '@/components/time-tracking';
import type { TaskMutations } from '@/lib/use-task-mutations';

import type { TaskDeletePrompt } from './task-delete-dialog';
import { TaskHeaderOverflowMenu } from './task-header-controls';

/** Props for {@link TaskActions}. */
export interface TaskActionsProps {
  readonly task: TaskDetail;
  readonly memberOptions: readonly PickerOption[];
  readonly canEdit: boolean;
  readonly canManage: boolean;
  readonly mutations: Pick<TaskMutations, 'patchTask' | 'setPriority' | 'priorityPending'>;
  /** The delete prompt the menu's Delete item opens; nothing is removed until it is confirmed. */
  readonly deletePrompt: TaskDeletePrompt;
}

/**
 * Render the masthead's action group.
 *
 * @param props - See {@link TaskActionsProps}.
 * @returns the timer button beside the overflow menu.
 */
export function TaskActions({
  task,
  memberOptions,
  canEdit,
  canManage,
  mutations,
  deletePrompt,
}: TaskActionsProps): JSX.Element {
  return (
    <ControlGroup controlSize="xl">
      <TaskTimerButton taskId={task.id} title={task.title} />
      <TaskHeaderOverflowMenu
        taskId={task.id}
        title={task.title}
        priority={task.priority}
        priorityPending={mutations.priorityPending}
        memberOptions={memberOptions}
        assigneeId={task.assigneeId ?? null}
        canEdit={canEdit}
        canManage={canManage}
        onPriorityChange={(priority) => {
          void mutations.setPriority(priority);
        }}
        onAssigneeChange={(assigneeId) => {
          mutations.patchTask({ assigneeId });
        }}
        onDelete={() => {
          deletePrompt.onOpenChange(true);
        }}
      />
    </ControlGroup>
  );
}
