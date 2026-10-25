'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  LabelTemplateConversionChoices,
  LabelTemplateConversionReview,
  LabelTemplateConversionReceipt,
} from '@docket/work/work-template-contract';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from '@/lib/auth-client';
import { UserFacingError, userErrorMessage } from '@/lib/problem';
import { useConversionTransport, conversionReceiptDef } from './queries';
import {
  conversionAttemptKey,
  readConversionAttempt,
  clearConversionAttempt,
  resumeConversionCommand,
  confirmConversionCommand,
  type ConversionCommandScope,
} from './command';

interface State {
  readonly owner: string;
  readonly pending: boolean;
  readonly phase: 'checking' | 'ready' | 'unknown';
  readonly review: LabelTemplateConversionReview | null;
  readonly receipt: LabelTemplateConversionReceipt | null;
  readonly error: string | null;
  readonly choices: LabelTemplateConversionChoices | null;
}
const initial = (owner: string): State => ({
  owner,
  pending: false,
  phase: 'checking',
  review: null,
  receipt: null,
  error: null,
  choices: null,
});
/** Bind tab recovery to the actual account, session and exact published source. */
function useScope(
  orgId: string,
  templateId: string,
  versionId: string,
): ConversionCommandScope | null {
  const { data: session } = useSession(),
    userId = session?.user.id,
    sessionId = session?.session.id;
  return useMemo(
    () => (userId && sessionId ? { orgId, templateId, versionId, userId, sessionId } : null),
    [orgId, templateId, versionId, userId, sessionId],
  );
}
/** Keep current account state and ignore old in-flight responses after a session or source change. */
function useOwnedState(scope: ConversionCommandScope | null) {
  const owner = scope ? conversionAttemptKey(scope) : '',
    currentOwner = useRef(owner);
  currentOwner.current = owner;
  const [stored, setStored] = useState<State>(() => initial(owner));
  const state = stored.owner === owner ? stored : initial(owner);
  const update = useCallback(
    (patch: Partial<State>): void => {
      setStored((value) =>
        currentOwner.current === owner
          ? { ...(value.owner === owner ? value : initial(owner)), ...patch, owner }
          : value,
      );
    },
    [owner],
  );
  return { state, update, isCurrent: () => currentOwner.current === owner };
}
function useReceiptLookup(orgId: string) {
  const client = useQueryClient();
  return useCallback(
    async (requestId: string) => {
      try {
        return await client.fetchQuery(conversionReceiptDef(orgId, requestId));
      } catch (error) {
        if (error instanceof UserFacingError && error.status === 404) return null;
        throw error;
      }
    },
    [client, orgId],
  );
}
type Update = (patch: Partial<State>) => void;
function useRecovery(
  scope: ConversionCommandScope | null,
  lookup: ReturnType<typeof useReceiptLookup>,
  update: Update,
) {
  useEffect(() => {
    if (!scope) return;
    let valid = true;
    void resumeConversionCommand(scope, lookup)
      .then((result) => {
        if (valid)
          update({ ...result, receipt: result.receipt ?? null, error: result.error ?? null });
      })
      .catch((error: unknown) => {
        if (valid)
          update({
            phase: 'unknown',
            error: userErrorMessage(error, 'The saved request could not be checked.'),
          });
      });
    return () => {
      valid = false;
    };
  }, [scope, lookup, update]);
}
function usePerformer(scope: ConversionCommandScope | null, state: State, update: Update) {
  const active = useRef<string | null>(null);
  async function perform(action: () => Promise<Partial<State>>): Promise<void> {
    if (!scope || active.current === state.owner) return;
    active.current = state.owner;
    update({ pending: true, error: null });
    try {
      update(await action());
    } catch (error) {
      update({
        error: userErrorMessage(
          error,
          'This action could not be completed. Your selection is still here.',
        ),
      });
    } finally {
      if (active.current === state.owner) active.current = null;
      update({ pending: false });
    }
  }
  return { perform, isActive: () => active.current === state.owner };
}
/** A focused reviewed command with durable original-request reconciliation before source reads. */
export function useConversionCommand(orgId: string, templateId: string, versionId: string) {
  const scope = useScope(orgId, templateId, versionId),
    transport = useConversionTransport(orgId),
    lookup = useReceiptLookup(orgId);
  const { state, update } = useOwnedState(scope),
    { perform, isActive } = usePerformer(scope, state, update);
  useRecovery(scope, lookup, update);
  async function check(): Promise<void> {
    if (!scope) return;
    await perform(async () => {
      const result = await resumeConversionCommand(scope, lookup);
      return { ...result, receipt: result.receipt ?? null, error: result.error ?? null };
    });
  }
  async function prepareReview(choices: LabelTemplateConversionChoices): Promise<void> {
    if (state.phase !== 'ready' || state.receipt) return;
    await perform(async () => ({
      review: await transport.preview.mutateAsync(choices),
      phase: 'ready',
    }));
  }
  async function confirm(choices: LabelTemplateConversionChoices): Promise<void> {
    if (!scope || !state.review || state.receipt || state.phase !== 'ready') return;
    const checked = state.review;
    await perform(async () => {
      const result = await confirmConversionCommand(scope, choices, checked.reviewFingerprint, {
        submit: (input) => transport.confirm.mutateAsync(input),
        lookup,
      });
      return {
        ...result,
        receipt: result.receipt ?? null,
        review: result.needsReview ? null : checked,
        error: result.error ?? null,
      };
    });
  }
  async function undo(): Promise<void> {
    if (!scope || !state.receipt) return;
    await perform(async () => {
      const request = readConversionAttempt(scope);
      if (!request) throw new UserFacingError('The saved request could not be found.');
      return { receipt: await transport.undo.mutateAsync(request.requestId) };
    });
  }
  function reset(): void {
    if (!scope || isActive() || !state.receipt) return;
    try {
      clearConversionAttempt(scope);
      update({ ...initial(state.owner), phase: 'ready' });
    } catch (error) {
      update({ error: userErrorMessage(error, 'Could not start another batch.') });
    }
  }
  return {
    ...state,
    ready: scope !== null && state.phase === 'ready' && !state.receipt,
    check,
    prepareReview,
    confirm,
    undo,
    reset,
    back: () => {
      if (!isActive()) update({ review: null, error: null });
    },
  };
}
