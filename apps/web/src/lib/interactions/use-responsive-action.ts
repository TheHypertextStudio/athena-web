'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  type InteractionStart,
  type InteractionTimeout,
  useInteractionReceipts,
} from './receipt-context';
import type { InteractionOutcome, InteractionRecovery } from './types';

/** The local feedback phase exposed by {@link useResponsiveAction}. */
export type ResponsiveActionPhase =
  | 'idle'
  | 'activated'
  | 'acknowledged'
  | 'progressing'
  | 'sustained'
  | 'needs_attention'
  | 'settled';

/** Accessible status props for the exact control or nearby local status region that owns an action. */
export interface ResponsiveActionStatusProps {
  /** Exposes the feedback as a polite local status update. */
  readonly role: 'status';
  /** Announces changed local feedback without taking focus. */
  readonly 'aria-live': 'polite';
  /** Marks only the action's exact trigger/status region as busy. */
  readonly 'aria-busy': boolean;
  /** Application-owned progress or recovery copy; never provider exception text. */
  readonly children: string | undefined;
}

/** The public local lifecycle returned by {@link useResponsiveAction}. */
export interface ResponsiveAction {
  /** The action's truthful local feedback phase. */
  readonly phase: ResponsiveActionPhase;
  /** Whether this exact trigger must suppress a duplicate activation. */
  readonly blocksTrigger: boolean;
  /** Accessible, application-owned local status props. */
  readonly statusProps: ResponsiveActionStatusProps;
  /** Activate work immediately and defer settlement until painted acknowledgement has been earned. */
  readonly run: (operation: () => Promise<void> | void) => Promise<void>;
}

/** Configuration for one exact trigger's responsive asynchronous action. */
export interface UseResponsiveActionOptions extends InteractionStart {
  /** Returns whether the caller-owned semantic DOM/ARIA acknowledgement is currently committed. */
  readonly acknowledgementPredicate: () => boolean;
}

interface PendingSettlement {
  readonly outcome: InteractionOutcome;
  readonly recovery?: InteractionRecovery;
}

const QUIET_PROGRESS_MS = 300;
const SUSTAINED_WORK_MS = 5_000;

/** Build application-owned feedback copy for a local action phase. */
function statusText(phase: ResponsiveActionPhase): string | undefined {
  if (phase === 'progressing') return 'Working…';
  if (phase === 'sustained') return 'Still working';
  if (phase === 'needs_attention') return 'Couldn’t complete. Try again.';
  return undefined;
}

/** Return whether this phase represents unresolved work for the exact action trigger. */
function isBlockingPhase(phase: ResponsiveActionPhase): boolean {
  return (
    phase === 'activated' ||
    phase === 'acknowledged' ||
    phase === 'progressing' ||
    phase === 'sustained'
  );
}

/**
 * Give one exact trigger truthful, local feedback for asynchronous work.
 *
 * @remarks
 * Activation is synchronous, but acknowledgement never comes from the handler or its promise.
 * The caller owns `acknowledgementPredicate`, which must describe committed DOM/ARIA state and
 * remain true through the receipt provider's double-frame marker. Quiet progress and sustained
 * feedback are local timer escalations; no global pending state or observation sink is installed.
 *
 * @param options - Closed receipt metadata and a caller-owned semantic acknowledgement predicate.
 * @returns The local phase, accessible status props, duplicate guard, and activation function.
 */
export function useResponsiveAction(options: UseResponsiveActionOptions): ResponsiveAction {
  const {
    startInteraction,
    acknowledgeAfterPaint,
    markProgress,
    settleInteraction,
    recoverInteraction,
    scheduleTimeout,
    clearScheduledTimeout,
  } = useInteractionReceipts();
  const [phase, setPhase] = useState<ResponsiveActionPhase>('idle');
  const phaseRef = useRef<ResponsiveActionPhase>(phase);
  const activeInvocationId = useRef<string | undefined>(undefined);
  const acknowledgement = useRef<(() => void) | undefined>(undefined);
  const operation = useRef<Promise<void> | undefined>(undefined);
  const pendingSettlement = useRef<PendingSettlement | undefined>(undefined);
  const hasAcknowledged = useRef(false);
  const quietElapsed = useRef(false);
  const sustainedElapsed = useRef(false);
  const quietTimer = useRef<InteractionTimeout | undefined>(undefined);
  const sustainedTimer = useRef<InteractionTimeout | undefined>(undefined);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const setLocalPhase = useCallback((nextPhase: ResponsiveActionPhase): void => {
    phaseRef.current = nextPhase;
    setPhase(nextPhase);
  }, []);

  const clearTimers = useCallback((): void => {
    if (quietTimer.current !== undefined) clearScheduledTimeout(quietTimer.current);
    if (sustainedTimer.current !== undefined) clearScheduledTimeout(sustainedTimer.current);
    quietTimer.current = undefined;
    sustainedTimer.current = undefined;
  }, [clearScheduledTimeout]);

  const settlePending = useCallback((): void => {
    const invocationId = activeInvocationId.current;
    const pending = pendingSettlement.current;
    if (!invocationId || !pending || !hasAcknowledged.current) return;
    pendingSettlement.current = undefined;
    clearTimers();
    if (pending.outcome === 'needs_attention') {
      recoverInteraction(invocationId, pending.recovery ?? 'retry');
      setLocalPhase('needs_attention');
    } else {
      settleInteraction(invocationId, pending.outcome, pending.recovery);
      setLocalPhase('settled');
    }
    activeInvocationId.current = undefined;
    hasAcknowledged.current = false;
    operation.current = undefined;
  }, [clearTimers, recoverInteraction, settleInteraction]);

  useEffect(() => {
    const invocationId = activeInvocationId.current;
    if (!invocationId || acknowledgement.current || phase !== 'activated') return;
    const painted = acknowledgeAfterPaint(invocationId, options.acknowledgementPredicate);
    acknowledgement.current = painted.cancel;
    void painted.done.then((receipt) => {
      acknowledgement.current = undefined;
      if (!receipt || activeInvocationId.current !== invocationId) return;
      hasAcknowledged.current = true;
      if (sustainedElapsed.current) {
        markProgress(invocationId);
        setLocalPhase('sustained');
      } else if (quietElapsed.current) {
        markProgress(invocationId);
        setLocalPhase('progressing');
      } else {
        setLocalPhase('acknowledged');
      }
      settlePending();
    });
  }, [
    acknowledgeAfterPaint,
    markProgress,
    options.acknowledgementPredicate,
    phase,
    setLocalPhase,
    settlePending,
  ]);

  useEffect(
    () => () => {
      acknowledgement.current?.();
      clearTimers();
    },
    [clearTimers],
  );

  const run = useCallback(
    (operationToRun: () => Promise<void> | void): Promise<void> => {
      if (operation.current) return operation.current;
      const invocation = startInteraction({
        interactionId: options.interactionId,
        category: options.category,
        routeTemplateId: options.routeTemplateId,
      });
      activeInvocationId.current = invocation.invocationId;
      pendingSettlement.current = undefined;
      hasAcknowledged.current = false;
      quietElapsed.current = false;
      sustainedElapsed.current = false;
      setLocalPhase('activated');

      quietTimer.current = scheduleTimeout(() => {
        quietElapsed.current = true;
        if (activeInvocationId.current !== invocation.invocationId) return;
        const current = phaseRef.current;
        if (current === 'acknowledged' || current === 'progressing') {
          markProgress(invocation.invocationId);
          setLocalPhase('progressing');
        }
      }, QUIET_PROGRESS_MS);
      sustainedTimer.current = scheduleTimeout(() => {
        sustainedElapsed.current = true;
        if (activeInvocationId.current !== invocation.invocationId) return;
        const current = phaseRef.current;
        if (current === 'acknowledged') {
          markProgress(invocation.invocationId);
          setLocalPhase('sustained');
        } else if (current === 'progressing') {
          setLocalPhase('sustained');
        }
      }, SUSTAINED_WORK_MS);

      let completion: Promise<void>;
      try {
        completion = Promise.resolve(operationToRun());
      } catch {
        completion = Promise.reject(new Error('Responsive action operation failed.'));
      }
      const tracked = completion.then(
        () => {
          pendingSettlement.current = { outcome: 'succeeded' };
          settlePending();
        },
        () => {
          pendingSettlement.current = { outcome: 'needs_attention', recovery: 'retry' };
          settlePending();
        },
      );
      operation.current = tracked;
      return tracked;
    },
    [
      markProgress,
      options.category,
      options.interactionId,
      options.routeTemplateId,
      scheduleTimeout,
      setLocalPhase,
      settlePending,
      startInteraction,
    ],
  );

  return {
    phase,
    blocksTrigger: isBlockingPhase(phase),
    statusProps: {
      role: 'status',
      'aria-live': 'polite',
      'aria-busy': isBlockingPhase(phase),
      children: statusText(phase),
    },
    run,
  };
}
