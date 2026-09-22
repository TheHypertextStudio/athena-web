'use client';

import type { TaskDetail } from '@docket/work/task-model';
import { Button } from '@docket/ui/primitives';
import type { JSX } from 'react';

import { TemplateAwareEntityDocument } from '@/components/editor/apply-description-template';

import type { DescriptionExpansion } from './use-description-expansion';

/** Props for the task's description. */
export interface TaskDetailsProps {
  readonly orgId: string;
  readonly task: TaskDetail;
  readonly currentActorId?: string | null;
  readonly canEdit: boolean;
  readonly onSave: (description: string | null) => void;
  /** The expansion state, whose outcome and undo the strip under the description reports. */
  readonly expansion: DescriptionExpansion;
}

/**
 * The task's description, edited in place, with the outcome of an expansion beneath it.
 *
 * @remarks
 * The description carries no heading and no expand button of its own: it sits directly under the
 * masthead as the body of the task, and expanding it is an action in the masthead's overflow
 * menu. Only the result of an expansion, and the one undo, appear here.
 *
 * @param props - See {@link TaskDetailsProps}.
 * @returns the description editor and, after an expansion, its undo strip.
 */
export function TaskDetails({
  orgId,
  task,
  currentActorId,
  canEdit,
  onSave,
  expansion,
}: TaskDetailsProps): JSX.Element {
  return (
    <section aria-label="Description" className="flex flex-col gap-3">
      <TemplateAwareEntityDocument
        orgId={orgId}
        kind="task"
        {...(currentActorId === undefined ? {} : { currentActorId })}
        teamId={task.teamId}
        value={task.description}
        canEdit={canEdit}
        onSave={onSave}
        placeholder="Add a description…"
        contents={false}
      />
      {expansion.notice ? (
        <div className="flex flex-wrap items-center gap-2" role="status" aria-live="polite">
          <p className="text-on-surface-variant text-body-medium">{expansion.notice}</p>
          {expansion.undoToken ? (
            <Button
              type="button"
              size="sm"
              variant="link"
              disabled={expansion.pending}
              onClick={expansion.undo}
            >
              Undo expansion
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
