'use client';

import {
  createContext,
  type JSX,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { createInteractionReceiptStore, type InteractionReceiptStore } from './receipt-store';
import type {
  InteractionInvocation,
  InteractionOutcome,
  InteractionReceipt,
  InteractionRecovery,
} from './types';

/** An opaque handle returned by the timer scheduler used for local feedback escalation. */
export type InteractionTimeout = ReturnType<typeof globalThis.setTimeout> | number;

/** A cancellation handle and completion signal for one attempted painted acknowledgement. */
export interface PaintedAcknowledgement {
  /** Resolve after a predicate survives the second animation frame, or with `undefined` if it does not. */
  readonly done: Promise<InteractionReceipt | undefined>;
  /** Prevent an acknowledgement that has not completed from observing another frame. */
  readonly cancel: () => void;
}

/** The closed receipt metadata needed to create a fresh local invocation. */
export type InteractionStart = Omit<
  InteractionInvocation,
  'invocationId' | 'parentInvocationId'
> & {
  /** Optional page-lifetime-only parent correlation for a child interaction. */
  readonly parentInvocationId?: string;
};

/** The private app-wide receipt lifecycle contract available to client interaction owners. */
export interface InteractionReceiptContextValue {
  /** Create and synchronously record a fresh page-lifetime interaction invocation. */
  readonly startInteraction: (interaction: InteractionStart) => InteractionInvocation;
  /** Acknowledge only after a semantic predicate survives two animation-frame callbacks. */
  readonly acknowledgeAfterPaint: (
    invocationId: string,
    predicate: () => boolean,
  ) => PaintedAcknowledgement;
  /** Record quiet, durable work after the local feedback threshold. */
  readonly markProgress: (invocationId: string) => InteractionReceipt;
  /** Record a closed terminal outcome once semantic acknowledgement has occurred. */
  readonly settleInteraction: (
    invocationId: string,
    outcome: InteractionOutcome,
    recovery?: InteractionRecovery,
  ) => InteractionReceipt;
  /** Abandon a live receipt without promoting settlement into acknowledgement. */
  readonly abandonInteraction: (invocationId: string) => InteractionReceipt;
  /** Record an application-owned recovery affordance for an acknowledged interaction. */
  readonly recoverInteraction: (
    invocationId: string,
    recovery: InteractionRecovery,
  ) => InteractionReceipt;
  /** Return the current local receipt for an ephemeral invocation without serializing its id. */
  readonly receiptFor: (invocationId: string) => InteractionReceipt | undefined;
  /** Schedule local escalation without installing a global observer or production sink. */
  readonly scheduleTimeout: (callback: () => void, delay: number) => InteractionTimeout;
  /** Cancel a local escalation timer. */
  readonly clearScheduledTimeout: (handle: InteractionTimeout) => void;
}

/** Props for {@link InteractionReceiptProvider}. */
export interface InteractionReceiptProviderProps {
  /** The application subtree that can own receipt lifecycles. */
  readonly children: ReactNode;
  /** Clock injected for deterministic timestamps. */
  readonly now?: () => number;
  /** Animation-frame scheduler injected for deterministic painted acknowledgement. */
  readonly requestFrame?: (callback: FrameRequestCallback) => number;
  /** Cancels an injected animation frame. */
  readonly cancelFrame?: (handle: number) => void;
  /** Local timer scheduler injected for deterministic feedback escalation. */
  readonly scheduleTimeout?: (callback: () => void, delay: number) => InteractionTimeout;
  /** Cancels an injected local escalation timer. */
  readonly clearScheduledTimeout?: (handle: InteractionTimeout) => void;
  /** Creates an ephemeral page-lifetime correlation value; injectable for deterministic tests. */
  readonly createInvocationId?: () => string;
}

const InteractionReceiptContext = createContext<InteractionReceiptContextValue | null>(null);

/** Create an ephemeral correlation value without adding it to an observation payload. */
function defaultInvocationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `interaction-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Request a browser paint marker, falling back to a zero-delay task in non-browser test environments. */
function defaultRequestFrame(callback: FrameRequestCallback): number {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(callback);
  return globalThis.setTimeout(() => {
    callback(Date.now());
  }, 0) as unknown as number;
}

/** Cancel a default browser paint marker or its non-browser fallback. */
function defaultCancelFrame(handle: number): void {
  if (typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(handle);
    return;
  }
  globalThis.clearTimeout(handle);
}

/** Copy a receipt before exposing it through the React contract. */
function copyReceipt(receipt: InteractionReceipt): InteractionReceipt {
  return { ...receipt };
}

/**
 * Mount the app's local interaction receipt lifecycle.
 *
 * @remarks
 * This provider is deliberately distinct from the existing action {@link InteractionProvider}.
 * It owns no action registry and sends no production observation data. Acknowledgement is earned
 * only when the caller's semantic predicate remains true through two frame callbacks.
 *
 * @param props - The app subtree and deterministic scheduling seams.
 * @returns The receipt lifecycle context provider.
 */
export function InteractionReceiptProvider({
  children,
  now,
  requestFrame = defaultRequestFrame,
  cancelFrame = defaultCancelFrame,
  scheduleTimeout = globalThis.setTimeout,
  clearScheduledTimeout = globalThis.clearTimeout,
  createInvocationId = defaultInvocationId,
}: InteractionReceiptProviderProps): JSX.Element {
  const [store] = useState<InteractionReceiptStore>(() => createInteractionReceiptStore({ now }));
  const receipts = useRef(new Map<string, InteractionReceipt>());
  const acknowledgements = useRef(new Set<() => void>());

  const startInteraction = useCallback(
    (interaction: InteractionStart): InteractionInvocation => {
      const invocation: InteractionInvocation = {
        ...interaction,
        invocationId: createInvocationId(),
      };
      const receipt = store.activate(invocation);
      receipts.current.set(invocation.invocationId, receipt);
      return invocation;
    },
    [createInvocationId, store],
  );

  const acknowledgeAfterPaint = useCallback(
    (invocationId: string, predicate: () => boolean): PaintedAcknowledgement => {
      let firstFrame: number | undefined;
      let secondFrame: number | undefined;
      let settled = false;
      let resolveDone: (receipt: InteractionReceipt | undefined) => void = () => undefined;
      const done = new Promise<InteractionReceipt | undefined>((resolve) => {
        resolveDone = resolve;
      });

      const finish = (receipt: InteractionReceipt | undefined): void => {
        if (settled) return;
        settled = true;
        acknowledgements.current.delete(cancel);
        resolveDone(receipt);
      };
      const cancel = (): void => {
        if (firstFrame !== undefined) cancelFrame(firstFrame);
        if (secondFrame !== undefined) cancelFrame(secondFrame);
        finish(undefined);
      };

      if (!predicate()) {
        finish(undefined);
        return { done, cancel };
      }

      acknowledgements.current.add(cancel);
      firstFrame = requestFrame(() => {
        firstFrame = undefined;
        if (!predicate()) {
          finish(undefined);
          return;
        }
        secondFrame = requestFrame(() => {
          secondFrame = undefined;
          if (!predicate()) {
            finish(undefined);
            return;
          }
          try {
            const receipt = store.acknowledge(invocationId);
            receipts.current.set(invocationId, receipt);
            finish(receipt);
          } catch {
            finish(undefined);
          }
        });
      });

      return { done, cancel };
    },
    [cancelFrame, requestFrame, store],
  );

  const markProgress = useCallback(
    (invocationId: string): InteractionReceipt => {
      const receipt = store.progress(invocationId);
      receipts.current.set(invocationId, receipt);
      return receipt;
    },
    [store],
  );

  const settleInteraction = useCallback(
    (
      invocationId: string,
      outcome: InteractionOutcome,
      recovery?: InteractionRecovery,
    ): InteractionReceipt => {
      const receipt = store.settle(invocationId, outcome, recovery);
      receipts.current.set(invocationId, receipt);
      return receipt;
    },
    [store],
  );

  const abandonInteraction = useCallback(
    (invocationId: string): InteractionReceipt => {
      const receipt = store.abandon(invocationId);
      receipts.current.set(invocationId, receipt);
      return receipt;
    },
    [store],
  );

  const recoverInteraction = useCallback(
    (invocationId: string, recovery: InteractionRecovery): InteractionReceipt =>
      settleInteraction(invocationId, 'needs_attention', recovery),
    [settleInteraction],
  );

  const receiptFor = useCallback((invocationId: string): InteractionReceipt | undefined => {
    const receipt = receipts.current.get(invocationId);
    return receipt === undefined ? undefined : copyReceipt(receipt);
  }, []);

  useEffect(
    () => () => {
      for (const cancel of acknowledgements.current) cancel();
      const unresolved = [...receipts.current.entries()].filter(
        ([, receipt]) => receipt.phase !== 'settled',
      );
      store.teardown();
      for (const [invocationId, receipt] of unresolved) {
        const abandoned = store
          .snapshot()
          .completed.find(
            (candidate) =>
              candidate.phase === 'settled' &&
              candidate.outcome === 'abandoned' &&
              candidate.startedAt === receipt.startedAt &&
              candidate.interactionId === receipt.interactionId &&
              candidate.category === receipt.category &&
              candidate.routeTemplateId === receipt.routeTemplateId,
          );
        if (abandoned) receipts.current.set(invocationId, abandoned);
      }
    },
    [store],
  );

  const value = useMemo<InteractionReceiptContextValue>(
    () => ({
      startInteraction,
      acknowledgeAfterPaint,
      markProgress,
      settleInteraction,
      abandonInteraction,
      recoverInteraction,
      receiptFor,
      scheduleTimeout,
      clearScheduledTimeout,
    }),
    [
      acknowledgeAfterPaint,
      abandonInteraction,
      clearScheduledTimeout,
      markProgress,
      receiptFor,
      recoverInteraction,
      scheduleTimeout,
      settleInteraction,
      startInteraction,
    ],
  );

  return <InteractionReceiptContext value={value}>{children}</InteractionReceiptContext>;
}

/** Return the app-wide receipt lifecycle contract. */
export function useInteractionReceipts(): InteractionReceiptContextValue {
  const context = useContext(InteractionReceiptContext);
  if (context === null) {
    throw new Error('No interaction receipt provider is mounted.');
  }
  return context;
}

/**
 * Read receipt ownership when an optional integration boundary may be mounted outside this tree.
 *
 * @returns The receipt contract, or `null` for isolated action-registry tests and stories.
 */
export function useOptionalInteractionReceipts(): InteractionReceiptContextValue | null {
  return useContext(InteractionReceiptContext);
}
