'use client';

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
  const common = (failureTitle: string, success: (next: PersonalAthenaSessionDetail) => void) => ({
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

  return {
    pending: sendMessage.isPending || lifecycle.isPending || decide.isPending || create.isPending,
    sendMessage: sendMessage.mutate,
    lifecycle: lifecycle.mutate,
    decide: decide.mutate,
    create: create.mutate,
    createPending: create.isPending,
  } as const;
}
