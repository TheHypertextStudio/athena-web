'use client';

import type { TaskDetail } from '@docket/types';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@docket/ui/primitives';
import type { JSX, ReactNode } from 'react';
import { useState } from 'react';

import { TemplateAwareEntityDocument } from '@/components/editor/apply-description-template';
import { api } from '@/lib/api';
import { queryKeys, unwrap, useApiMutation } from '@/lib/query';

/** Props for the description and secondary task details. */
export interface TaskDetailsProps {
  readonly orgId: string;
  readonly taskId: string;
  readonly task: TaskDetail;
  readonly currentActorId?: string | null;
  readonly canEdit: boolean;
  readonly onSave: (description: string | null) => void;
  /** Less-frequent task fields that do not belong beside the primary description. */
  readonly details: ReactNode;
}

/** Keep one task's description and secondary details in the document flow. */
export function TaskDetails({
  orgId,
  taskId,
  task,
  currentActorId,
  canEdit,
  onSave,
  details,
}: TaskDetailsProps): JSX.Element {
  const queryClient = useQueryClient();
  const [undoToken, setUndoToken] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const invalidateKeys = [
    queryKeys.task(orgId, taskId),
    queryKeys.tasks(orgId),
    queryKeys.taskActivity(orgId, taskId),
    queryKeys.entityMentions(orgId, 'task', taskId),
  ];
  const expandMutation = useApiMutation({
    mutationFn: () =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].tasks[':id'].expand.$post({
            param: { orgId, id: taskId },
            json: {},
          }),
        'Could not expand the description.',
      ),
    invalidateKeys,
  });
  const undoMutation = useApiMutation({
    mutationFn: (token: string) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].tasks[':id'].expand.undo.$post({
            param: { orgId, id: taskId },
            json: { undoToken: token },
          }),
        'Could not undo the expansion.',
      ),
    invalidateKeys,
  });

  function expand(): void {
    setError(null);
    setNotice(null);
    expandMutation.mutate(undefined, {
      onSuccess: (result) => {
        queryClient.setQueryData<TaskDetail>(queryKeys.task(orgId, taskId), result.task);
        setUndoToken(result.undoToken);
        setNotice(result.undoToken ? 'Description expanded.' : 'No changes needed.');
      },
      onError: () => {
        setError('Could not expand the description. Try again.');
      },
    });
  }

  function undo(): void {
    if (undoToken === null) return;
    setError(null);
    setNotice(null);
    undoMutation.mutate(undoToken, {
      onSuccess: (result) => {
        queryClient.setQueryData<TaskDetail>(queryKeys.task(orgId, taskId), result.task);
        setUndoToken(null);
        setNotice('Expansion undone.');
      },
      onError: () => {
        setError('Could not undo the expansion. Try again.');
      },
    });
  }

  return (
    <>
      <section aria-labelledby="description-heading" className="flex flex-col gap-3">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <h2 id="description-heading" className="text-on-surface text-title-small">
            Description
          </h2>
          {canEdit ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={expandMutation.isPending || undoMutation.isPending}
              onClick={expand}
            >
              {expandMutation.isPending ? 'Expanding…' : 'Expand'}
            </Button>
          ) : null}
        </div>
        <TemplateAwareEntityDocument
          orgId={orgId}
          kind="task"
          {...(currentActorId === undefined ? {} : { currentActorId })}
          teamId={task.teamId}
          value={task.description}
          canEdit={canEdit}
          onSave={onSave}
          placeholder="Add a description…"
        />
        {notice ? (
          <div className="flex flex-wrap items-center gap-2" role="status" aria-live="polite">
            <p className="text-on-surface-variant text-body-medium">{notice}</p>
            {undoToken ? (
              <Button type="button" size="sm" variant="link" onClick={undo}>
                Undo expansion
              </Button>
            ) : null}
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="text-error text-body-medium">
            {error}
          </p>
        ) : null}
      </section>

      <details className="bg-surface-container-low rounded-xl">
        <summary className="text-on-surface text-label-large flex min-h-11 cursor-pointer list-none items-center px-4 [&::-webkit-details-marker]:hidden">
          Details
        </summary>
        <div className="px-4 pb-4">{details}</div>
      </details>
    </>
  );
}
