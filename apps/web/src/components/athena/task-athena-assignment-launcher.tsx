'use client';

/** Contextual durable task work lives with Athena's conversation, not the task's controls. */
import { Button } from '@docket/ui/primitives';
import { type JSX, useState } from 'react';

import type { PersonalAthenaContext } from '@/lib/athena/presentation';

import { TaskAthenaAssignmentDialog } from './task-athena-assignment-dialog';

/** The task shown in Athena's current page context. */
export interface TaskAthenaAssignmentLauncherProps {
  readonly organizationId: string;
  readonly taskId: string;
  readonly taskTitle: string;
}

/** Resolve an assignment target only while the current page's task is attached to Athena. */
export function assignmentTargetFromContext(
  context: PersonalAthenaContext | null,
  attached: boolean,
): TaskAthenaAssignmentLauncherProps | null {
  if (!attached || !context?.workspaceId || context.source?.type !== 'task') return null;
  return {
    organizationId: context.workspaceId,
    taskId: context.source.id,
    taskTitle: context.source.label ?? 'this task',
  };
}

/** Open the owner-bound assignment prompt from Athena's composer. */
export function TaskAthenaAssignmentLauncher({
  organizationId,
  taskId,
  taskTitle,
}: TaskAthenaAssignmentLauncherProps): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        controlSize="md"
        onClick={() => {
          setOpen(true);
        }}
      >
        Work on this task
      </Button>
      {open ? (
        <TaskAthenaAssignmentDialog
          open={open}
          onOpenChange={setOpen}
          organizationId={organizationId}
          taskId={taskId}
          taskTitle={taskTitle}
        />
      ) : null}
    </>
  );
}
