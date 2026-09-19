'use client';

import type { PhoneCallUndoOut as AthenaUndoOut } from '@docket/athena/voice';
import { notifyFailure } from '@docket/ui/components';

import { presentFailure } from '@/components/feedback';
import {
  type PersonalAthenaLifecycle,
  type PersonalAthenaTransport,
} from '@/lib/athena/query-defs';
import type { PersonalAthenaContext, PersonalAthenaSessionDetail } from '@/lib/athena/presentation';
import { ApiRequestError, queryKeys, unwrap, useApiMutation } from '@/lib/query';

interface AthenaActionsOptions {
  readonly selectedId: string;
  readonly transport: PersonalAthenaTransport;
  readonly onSelected: (next: PersonalAthenaSessionDetail) => void;
  readonly onCreated?: (next: PersonalAthenaSessionDetail) => void;
}

/** Whether a failed mutation's problem carries the given code or fell back to its HTTP status. */
function isProblem(error: unknown, code: string, status: number): boolean {
  return error instanceof ApiRequestError && (error.code === code || error.status === status);
}

/** The notice title for a failed undo: the change may already be gone, or already superseded. */
function undoFailureTitle(error: unknown): string | null {
  if (isProblem(error, 'not_found', 404)) return 'This change is no longer here to undo.';
  if (isProblem(error, 'conflict', 409)) {
    return 'Someone changed this since; undo left it as it is.';
  }
  return null;
}

/** The notice title for a failed decision: a 409 means someone else already decided it. */
function decideFailureTitle(error: unknown): string | null {
  if (isProblem(error, 'conflict', 409)) return 'This decision was already made.';
  return null;
}

/**
 * Mutation options that name a failure by its Problem code when the operation has its own words
 * for that code, and otherwise present it the way every other write does.
 */
function namedFailure(fallbackTitle: string, titleFor: (error: unknown) => string | null) {
  return {
    failure: 'silent' as const,
    onError: (error: unknown) => {
      const title = titleFor(error);
      if (title === null) {
        presentFailure(error, fallbackTitle);
        return;
      }
      notifyFailure({ title, dedupeKey: `failure:${title}` });
    },
  };
}

/**
 * Shared personal-Athena mutations.
 *
 * @remarks
 * Each mutation reports its own failure as a notice, named by the operation it performs.
 */
export function useAthenaActions({
  selectedId,
  transport,
  onSelected,
  onCreated = onSelected,
}: AthenaActionsOptions) {
  const common = <T = PersonalAthenaSessionDetail>(
    failureTitle: string,
    success: (next: T) => void,
  ) => ({
    invalidateKeys: [queryKeys.athena()],
    failureTitle,
    onSuccess: success,
  });
  const sendMessage = useApiMutation<PersonalAthenaSessionDetail, string>({
    mutationFn: (body) =>
      unwrap(
        () => transport.sendMessage(selectedId, { body }),
        'Could not steer this Athena work.',
      ),
    ...common('Could not steer this Athena work.', onSelected),
  });
  const lifecycle = useApiMutation<PersonalAthenaSessionDetail, PersonalAthenaLifecycle>({
    mutationFn: (action) =>
      unwrap(() => transport.lifecycle(selectedId, action), 'Could not change this Athena work.'),
    ...common('Could not change this Athena work.', onSelected),
  });
  const decide = useApiMutation<
    PersonalAthenaSessionDetail,
    {
      readonly id: string;
      readonly option: string;
      readonly kind?: 'approval' | 'question' | undefined;
    }
  >({
    mutationFn: ({ id, option, kind }) => {
      if (kind === 'question') {
        return unwrap(
          () => transport.decide(selectedId, id, 'reply', { body: option }),
          'Could not record your answer.',
        );
      }
      return unwrap(
        () => transport.decide(selectedId, id, option === 'reject' ? 'reject' : 'approve'),
        'Could not record your decision.',
      );
    },
    ...common('Could not record your decision.', onSelected),
    ...namedFailure('Could not record your decision.', decideFailureTitle),
  });
  const create = useApiMutation<
    PersonalAthenaSessionDetail,
    { readonly prompt: string; readonly context?: PersonalAthenaContext }
  >({
    mutationFn: (input) =>
      unwrap(() => transport.create(input), 'Athena could not start this work.'),
    ...common('Athena could not start this work.', onCreated),
  });
  const undo = useApiMutation<AthenaUndoOut, string>({
    mutationFn: (changeSetId) =>
      unwrap(() => transport.undoChange(changeSetId), 'Could not undo this change.'),
    ...common<AthenaUndoOut>('Could not undo this change.', () => undefined),
    ...namedFailure('Could not undo this change.', undoFailureTitle),
  });

  return {
    pending: [sendMessage, lifecycle, decide, create, undo].some((m) => m.isPending),
    sendMessage: sendMessage.mutate,
    lifecycle: lifecycle.mutate,
    decide: decide.mutate,
    create: create.mutate,
    createPending: create.isPending,
    undo: undo.mutate,
    undoPending: undo.isPending,
  } as const;
}
