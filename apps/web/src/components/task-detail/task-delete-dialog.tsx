'use client';

/**
 * The prompt that confirms deleting a task, and the state that opens it.
 *
 * @remarks
 * Deleting removes the task along with its subtasks and dependency links and cannot be undone, so
 * it always asks first. A confirmed delete leaves the task's page for the workspace's work list.
 */
import { ConfirmDestructiveDialog } from '@docket/ui/components';
import { type JSX, useCallback, useState } from 'react';

import { useAppRouter } from '@/lib/interactions/navigation';
import type { TaskMutations } from '@/lib/use-task-mutations';

/** The open state of the delete prompt, and the handler that changes it. */
export interface TaskDeletePrompt {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

/**
 * Hold the delete prompt's open state.
 *
 * @param resetDelete - Clears a previous failure, so a reopened prompt never shows a stale one.
 * @returns the state and the change handler for {@link TaskDeleteDialog} and its opener.
 */
export function useTaskDeletePrompt(resetDelete: () => void): TaskDeletePrompt {
  const [open, setOpen] = useState(false);
  const onOpenChange = useCallback(
    (next: boolean): void => {
      resetDelete();
      setOpen(next);
    },
    [resetDelete],
  );
  return { open, onOpenChange };
}

/** Props for {@link TaskDeleteDialog}. */
export interface TaskDeleteDialogProps {
  readonly orgId: string;
  readonly prompt: TaskDeletePrompt;
  readonly mutations: Pick<TaskMutations, 'deleteTask' | 'deletePending' | 'deleteError'>;
}

/**
 * Render the delete confirmation.
 *
 * @param props - See {@link TaskDeleteDialogProps}.
 * @returns the dialog, closed until the prompt opens it.
 */
export function TaskDeleteDialog({ orgId, prompt, mutations }: TaskDeleteDialogProps): JSX.Element {
  const router = useAppRouter();
  return (
    <ConfirmDestructiveDialog
      open={prompt.open}
      onOpenChange={prompt.onOpenChange}
      title="Delete this task?"
      description="This removes the task from your lists and boards, along with its subtasks and dependency links. You can't undo this."
      confirmLabel="Delete task"
      pending={mutations.deletePending}
      error={mutations.deleteError}
      onConfirm={() => {
        mutations.deleteTask({
          onSuccess: () => {
            prompt.onOpenChange(false);
            router.push(`/orgs/${orgId}/my-work`);
          },
        });
      }}
    />
  );
}
