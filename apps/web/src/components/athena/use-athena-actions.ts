'use client';

import { useState } from 'react';

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

/** Shared personal-Athena mutations and application-owned live feedback. */
export function useAthenaActions({
  selectedId,
  transport,
  onSelected,
  onCreated = onSelected,
}: AthenaActionsOptions) {
  const [feedback, setFeedback] = useState<string | null>(null);
  const common = (message: string, success: (next: PersonalAthenaSessionDetail) => void) => ({
    invalidateKeys: [queryKeys.athena()],
    onMutate: () => {
      setFeedback(null);
    },
    onError: () => {
      setFeedback(message);
    },
    onSuccess: (next: PersonalAthenaSessionDetail) => {
      setFeedback(null);
      success(next);
    },
  });
  const message = useApiMutation<PersonalAthenaSessionDetail, string>({
    mutationFn: (body) =>
      unwrap(() => transport.message(selectedId, { body }), 'Could not steer this Athena work.'),
    ...common('Could not steer this Athena work.', onSelected),
  });
  const lifecycle = useApiMutation<PersonalAthenaSessionDetail, PersonalAthenaLifecycle>({
    mutationFn: (action) =>
      unwrap(() => transport.lifecycle(selectedId, action), 'Could not change this Athena work.'),
    ...common('Could not change this Athena work.', onSelected),
  });
  const decide = useApiMutation<
    PersonalAthenaSessionDetail,
    { readonly id: string; readonly option: string; readonly kind?: 'approval' | 'question' }
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
    feedback,
    pending: message.isPending || lifecycle.isPending || decide.isPending || create.isPending,
    message: message.mutate,
    lifecycle: lifecycle.mutate,
    decide: decide.mutate,
    create: create.mutate,
    createPending: create.isPending,
  } as const;
}
