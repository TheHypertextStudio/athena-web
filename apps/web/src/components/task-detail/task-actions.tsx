'use client';

/**
 * The task masthead's actions: track time, and the overflow menu.
 *
 * @remarks
 * The timer is the one primary action. It is deliberately unconditional on workflow state and on
 * edit rights: time tracking is the viewer's own record of what they did, so it is not a content
 * mutation, and a task being blocked, done, or someone else's does not stop a person having spent
 * real time on it.
 *
 * The overflow menu holds only what has no better home on the page: expanding the description,
 * copying the link, and deleting. Properties are edited where they are shown, so the menu carries
 * no duplicate of any of them.
 */
import type { TaskDetail } from '@docket/work/task-model';
import { Copy, Ellipsis, Sparkles, Trash2 } from '@docket/ui/icons';
import {
  Button,
  ControlGroup,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@docket/ui/primitives';
import type { JSX } from 'react';

import { copyObjects } from '@/components/actions/copy-object-action';
import { useCopyOutcome } from '@/components/clipboard';
import { TaskTimerButton } from '@/components/time-tracking';
import { canWriteClipboard } from '@/lib/clipboard/write';
import type { TaskMutations } from '@/lib/use-task-mutations';

import { TaskDeleteDialog, type TaskDeletePrompt, useTaskDeletePrompt } from './task-delete-dialog';
import type { DescriptionExpansion } from './use-description-expansion';

/** Props for {@link TaskOverflowMenu}. */
export interface TaskOverflowMenuProps {
  readonly orgId: string;
  readonly task: TaskDetail;
  readonly canEdit: boolean;
  readonly canManage: boolean;
  readonly expansion: DescriptionExpansion;
  /** The prompt the Delete item opens; nothing is removed until it is confirmed. */
  readonly deletePrompt: TaskDeletePrompt;
}

/**
 * The overflow menu: expand the description, copy the link, delete the task.
 *
 * @param props - See {@link TaskOverflowMenuProps}.
 * @returns the menu, or nothing when the viewer has none of its actions.
 */
export function TaskOverflowMenu({
  orgId,
  task,
  canEdit,
  canManage,
  expansion,
  deletePrompt,
}: TaskOverflowMenuProps): JSX.Element | null {
  const reportOutcome = useCopyOutcome();
  const canCopy = canWriteClipboard();
  const copyLink = async (): Promise<void> => {
    const object = { kind: 'task', id: task.id, organizationId: orgId, title: task.title } as const;
    await copyObjects([object], reportOutcome);
  };
  if (!canEdit && !canCopy && !canManage) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" iconOnly aria-label="Task actions">
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" width="md">
        {canEdit ? (
          <DropdownMenuItem disabled={expansion.pending} onSelect={expansion.expand}>
            <Sparkles className="size-4" />
            Expand description
          </DropdownMenuItem>
        ) : null}
        {canCopy ? (
          <DropdownMenuItem
            onSelect={() => {
              void copyLink();
            }}
          >
            <Copy className="size-4" />
            Copy link
          </DropdownMenuItem>
        ) : null}
        {canManage ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              destructive
              onSelect={() => {
                deletePrompt.onOpenChange(true);
              }}
            >
              <Trash2 className="size-4" />
              Delete task
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Props for {@link TaskActions}. */
export interface TaskActionsProps {
  readonly orgId: string;
  readonly task: TaskDetail;
  readonly canEdit: boolean;
  readonly canManage: boolean;
  readonly mutations: Pick<
    TaskMutations,
    'resetDelete' | 'deleteTask' | 'deletePending' | 'deleteError'
  >;
  readonly expansion: DescriptionExpansion;
}

/**
 * Render the masthead's action group, with the prompt that confirms a delete.
 *
 * @param props - See {@link TaskActionsProps}.
 * @returns the timer button beside the overflow menu.
 */
export function TaskActions({
  orgId,
  task,
  canEdit,
  canManage,
  mutations,
  expansion,
}: TaskActionsProps): JSX.Element {
  const deletePrompt = useTaskDeletePrompt(mutations.resetDelete);
  return (
    <>
      <ControlGroup controlSize="xl">
        <TaskTimerButton taskId={task.id} title={task.title} emphasis="prominent" />
        <TaskOverflowMenu
          orgId={orgId}
          task={task}
          canEdit={canEdit}
          canManage={canManage}
          expansion={expansion}
          deletePrompt={deletePrompt}
        />
      </ControlGroup>
      <TaskDeleteDialog orgId={orgId} prompt={deletePrompt} mutations={mutations} />
    </>
  );
}
