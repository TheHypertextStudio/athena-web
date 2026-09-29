'use client';

/** Ask Athena to work on a task while keeping its eventual change subject to review. */
import { notify } from '@docket/ui/components';
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Text,
  Textarea,
} from '@docket/ui/primitives';
import { type JSX, useRef, useState } from 'react';

import { userErrorMessage } from '@/lib/problem';
import DocketLink from '@/components/docket-link';

import { useTaskAthenaAssignment } from './task-athena-assignment-mutations';

/** Props for the owner-authenticated task assignment prompt. */
export interface TaskAthenaAssignmentDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly organizationId: string;
  readonly taskId: string;
  readonly taskTitle: string;
}

/** Keep the assignment request and the objective inside this one prompt. */
function useAssignmentPrompt({
  organizationId,
  taskId,
  onOpenChange,
}: Pick<TaskAthenaAssignmentDialogProps, 'organizationId' | 'taskId' | 'onOpenChange'>) {
  const [objective, setObjective] = useState('');
  const submitting = useRef(false);
  const assignment = useTaskAthenaAssignment(organizationId, taskId);

  const changeOpen = (next: boolean): void => {
    if (assignment.isPending) return;
    if (!next) {
      setObjective('');
      assignment.reset();
    }
    onOpenChange(next);
  };

  const start = (): void => {
    const trimmed = objective.trim();
    if (trimmed.length === 0 || submitting.current) return;
    submitting.current = true;
    assignment.mutate(trimmed, {
      onSuccess: () => {
        setObjective('');
        onOpenChange(false);
        notify({
          title: 'Athena started work on this task',
          detail: 'You can review its proposal before anything changes.',
          tone: 'positive',
          action: { label: 'Open Athena', href: '/athena' },
        });
      },
      onSettled: () => {
        submitting.current = false;
      },
    });
  };

  const error = assignment.error
    ? userErrorMessage(assignment.error, 'Could not start Athena on this task. Try again.')
    : null;
  return { objective, setObjective, pending: assignment.isPending, error, changeOpen, start };
}

/**
 * Collect an objective and start one durable assignment on the selected Athena runtime.
 *
 * @param props - The task identity and controlled dialog state.
 * @returns A prompt that keeps the objective available when submission fails.
 */
export function TaskAthenaAssignmentDialog({
  open,
  onOpenChange,
  organizationId,
  taskId,
  taskTitle,
}: TaskAthenaAssignmentDialogProps): JSX.Element {
  const prompt = useAssignmentPrompt({ organizationId, taskId, onOpenChange });

  return (
    <Dialog open={open} onOpenChange={prompt.changeOpen}>
      <DialogContent presentation={{ kind: 'centered', size: 'standard', height: 'content' }}>
        <DialogHeader>
          <DialogTitle>Ask Athena to work on this task</DialogTitle>
          <DialogDescription>
            Athena will work on “{taskTitle}” using the runtime selected in Settings. You will
            review its proposal before Docket changes the task.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <Field label="What should Athena do?">
            <Textarea
              controlSize="lg"
              value={prompt.objective}
              maxLength={4_000}
              rows={4}
              disabled={prompt.pending}
              onChange={(event) => {
                prompt.setObjective(event.currentTarget.value);
              }}
            />
          </Field>
          {prompt.error ? (
            <div className="flex flex-col items-start gap-1">
              <Text as="p" token="body-small" tone="error" role="alert">
                {prompt.error}
              </Text>
              <Button asChild variant="link" controlSize="md">
                <DocketLink href="/settings/athena">Check Athena Settings</DocketLink>
              </Button>
            </div>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button
            variant="ghost"
            controlSize="lg"
            disabled={prompt.pending}
            onClick={() => {
              prompt.changeOpen(false);
            }}
          >
            Cancel
          </Button>
          <Button
            controlSize="lg"
            disabled={prompt.objective.trim().length === 0 || prompt.pending}
            onClick={prompt.start}
          >
            {prompt.pending ? 'Starting…' : 'Start work'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
