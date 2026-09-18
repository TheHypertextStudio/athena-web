'use client';

import type { PhoneCallUndoOut as AthenaUndoOut } from '@docket/athena/voice';

import {
  type PersonalAthenaLifecycle,
  type PersonalAthenaTransport,
} from '@/lib/athena/query-defs';
import type { PersonalAthenaContext, PersonalAthenaSessionDetail } from '@/lib/athena/presentation';
import { queryKeys, unwrap, useApiMutation } from '@/lib/query';

interface AthenaActionsOptions {
  readonly selectedId: string;
  readonly transport: PersonalAthenaTransport;
  readonly onSelected: (next: PersonalAthenaSessionDetail) => void;
  readonly onCreated?: (next: PersonalAthenaSessionDetail) => void;
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
