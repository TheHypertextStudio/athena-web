import { INTERACTION_CATALOG, ROUTE_TEMPLATE_IDS } from './catalog';
import type {
  InteractionInvocation,
  InteractionLeakFailure,
  InteractionOutcome,
  InteractionReceipt,
  InteractionReceiptSnapshot,
  InteractionRecovery,
} from './types';

/** The maximum number of in-flight receipts retained by one page-lifetime store. */
export const MAX_LIVE_RECEIPTS = 128;

/** The maximum number of settled receipts retained by one page-lifetime store. */
export const MAX_COMPLETED_RECEIPTS = 512;

/** Construction options for an interaction receipt store. */
export interface InteractionReceiptStoreOptions {
  /** Clock used to stamp lifecycle changes; injectable for deterministic tests. */
  readonly now?: (() => number) | undefined;
  /** Observes the metadata-only failure emitted by the built-in development/test reporter. */
  readonly onLeak?: ((failure: InteractionLeakFailure) => void) | undefined;
  /** Explicit runtime mode, primarily for deterministic development/test diagnostics. */
  readonly environment?: 'development' | 'production' | 'test' | undefined;
}

/** A bounded local trace of named interaction lifecycles. */
export interface InteractionReceiptStore {
  /** Activate a new receipt and retain its invocation correlation only in local memory. */
  activate: (invocation: InteractionInvocation) => InteractionReceipt;
  /** Record a committed acknowledgement for one activated receipt. */
  acknowledge: (invocationId: string) => InteractionReceipt;
  /** Record durable progress after acknowledgement without creating a second receipt. */
  progress: (invocationId: string) => InteractionReceipt;
  /** Settle acknowledged or progressing work with one closed terminal outcome. */
  settle: (
    invocationId: string,
    outcome: InteractionOutcome,
    recovery?: InteractionRecovery,
  ) => InteractionReceipt;
  /** Abandon a live receipt without treating an invalid synchronous edge as acknowledgement. */
  abandon: (invocationId: string) => InteractionReceipt;
  /** Return a local-only invocation for child/root correlation; never use this for diagnostics. */
  invocationFor: (invocationId: string) => InteractionInvocation | undefined;
  /** Mark unresolved page-lifetime work as abandoned during teardown. */
  teardown: () => void;
  /** Return a serialization-safe, bounded diagnostic view with no invocation correlation. */
  snapshot: () => InteractionReceiptSnapshot;
}

interface StoredReceipt {
  readonly invocation: InteractionInvocation;
  receipt: InteractionReceipt;
}

const INVALID_INVOCATION = 'Invalid interaction invocation.';
const INVALID_TRANSITION = 'Invalid interaction receipt transition.';
const LIVE_CAPACITY_LEAK_MESSAGE = 'Interaction receipt live capacity exceeded.';
const OUTCOMES = new Set<InteractionOutcome>([
  'succeeded',
  'needs_attention',
  'failed',
  'handed_off',
  'superseded',
  'abandoned',
  'timed_out',
]);
const RECOVERIES = new Set<InteractionRecovery>([
  'retry',
  'revert',
  'reconnect',
  'reauthenticate',
  'continue',
]);

/** Build a private copy of an invocation without accepting untyped object properties. */
function copyInvocation(invocation: InteractionInvocation): InteractionInvocation {
  return {
    interactionId: invocation.interactionId,
    category: invocation.category,
    routeTemplateId: invocation.routeTemplateId,
    invocationId: invocation.invocationId,
    ...(invocation.parentInvocationId ? { parentInvocationId: invocation.parentInvocationId } : {}),
  };
}

/** Build a privacy-safe receipt copy from the fields this domain owns. */
function copyReceipt(receipt: InteractionReceipt): InteractionReceipt {
  return {
    interactionId: receipt.interactionId,
    category: receipt.category,
    routeTemplateId: receipt.routeTemplateId,
    phase: receipt.phase,
    startedAt: receipt.startedAt,
    ...(receipt.acknowledgedAt === undefined ? {} : { acknowledgedAt: receipt.acknowledgedAt }),
    ...(receipt.progressAt === undefined ? {} : { progressAt: receipt.progressAt }),
    ...(receipt.settledAt === undefined ? {} : { settledAt: receipt.settledAt }),
    ...(receipt.outcome === undefined ? {} : { outcome: receipt.outcome }),
    ...(receipt.recovery === undefined ? {} : { recovery: receipt.recovery }),
  };
}

/** Return whether an invocation uses a catalog entry with its declared category. */
function isCatalogedInvocation(invocation: InteractionInvocation): boolean {
  return INTERACTION_CATALOG.some(
    (entry) => entry.id === invocation.interactionId && entry.category === invocation.category,
  );
}

/** Return whether a receipt names an allowlisted route shape. */
function isRouteTemplate(routeTemplateId: string): boolean {
  return ROUTE_TEMPLATE_IDS.some((candidate) => candidate === routeTemplateId);
}

/** Return whether this runtime must surface a live-receipt capacity failure. */
function reportsLeaks(environment: InteractionReceiptStoreOptions['environment']): boolean {
  return (environment ?? process.env.NODE_ENV) !== 'production';
}

/** Emit the fixed, metadata-free development/test failure for an exhausted live receipt trace. */
function reportLiveCapacityLeak(): void {
  console.error(LIVE_CAPACITY_LEAK_MESSAGE);
}

/**
 * Create an isolated, bounded interaction-receipt lifecycle store.
 *
 * @remarks
 * The store is intentionally local and side-effect-free except for its explicit development/test
 * built-in development/test leak reporter and optional observer. It copies only allowlisted fields
 * into receipts and snapshots, so callers cannot accidentally put user-controlled payloads or
 * ephemeral correlation identifiers in diagnostics.
 *
 * @param options - Clock and development/test diagnostic configuration.
 * @returns A page-lifetime receipt store.
 */
export function createInteractionReceiptStore(
  options: InteractionReceiptStoreOptions = {},
): InteractionReceiptStore {
  const now = options.now ?? Date.now;
  const live: StoredReceipt[] = [];
  const completed: StoredReceipt[] = [];
  const records = new Map<string, StoredReceipt>();

  const complete = (stored: StoredReceipt, outcome: InteractionOutcome): InteractionReceipt => {
    const liveIndex = live.indexOf(stored);
    if (liveIndex !== -1) live.splice(liveIndex, 1);
    stored.receipt = {
      ...stored.receipt,
      phase: 'settled',
      settledAt: now(),
      outcome,
    };
    completed.push(stored);
    while (completed.length > MAX_COMPLETED_RECEIPTS) {
      const evicted = completed.shift();
      if (evicted) records.delete(evicted.invocation.invocationId);
    }
    return copyReceipt(stored.receipt);
  };

  const liveReceipt = (invocationId: string): StoredReceipt => {
    const stored = records.get(invocationId);
    if (!stored || !live.includes(stored)) throw new Error(INVALID_TRANSITION);
    return stored;
  };

  return {
    activate: (input) => {
      if (
        !isCatalogedInvocation(input) ||
        !isRouteTemplate(input.routeTemplateId) ||
        input.invocationId.length === 0 ||
        records.has(input.invocationId) ||
        (input.parentInvocationId !== undefined && !records.has(input.parentInvocationId))
      ) {
        throw new Error(INVALID_INVOCATION);
      }

      if (live.length === MAX_LIVE_RECEIPTS) {
        const oldest = live[0];
        if (!oldest) throw new Error(INVALID_TRANSITION);
        complete(oldest, 'timed_out');
        if (reportsLeaks(options.environment)) {
          const failure = { code: 'live-capacity-exceeded' } as const;
          reportLiveCapacityLeak();
          options.onLeak?.(failure);
        }
      }

      const invocation = copyInvocation(input);
      const stored: StoredReceipt = {
        invocation,
        receipt: {
          interactionId: invocation.interactionId,
          category: invocation.category,
          routeTemplateId: invocation.routeTemplateId,
          phase: 'activated',
          startedAt: now(),
        },
      };
      records.set(invocation.invocationId, stored);
      live.push(stored);
      return copyReceipt(stored.receipt);
    },
    acknowledge: (invocationId) => {
      const stored = liveReceipt(invocationId);
      if (stored.receipt.phase !== 'activated') throw new Error(INVALID_TRANSITION);
      stored.receipt = { ...stored.receipt, phase: 'acknowledged', acknowledgedAt: now() };
      return copyReceipt(stored.receipt);
    },
    progress: (invocationId) => {
      const stored = liveReceipt(invocationId);
      if (stored.receipt.phase !== 'acknowledged' && stored.receipt.phase !== 'progressing') {
        throw new Error(INVALID_TRANSITION);
      }
      stored.receipt = { ...stored.receipt, phase: 'progressing', progressAt: now() };
      return copyReceipt(stored.receipt);
    },
    settle: (invocationId, outcome, recovery) => {
      const stored = liveReceipt(invocationId);
      if (
        (stored.receipt.phase !== 'acknowledged' && stored.receipt.phase !== 'progressing') ||
        !OUTCOMES.has(outcome) ||
        (recovery !== undefined && (outcome !== 'needs_attention' || !RECOVERIES.has(recovery)))
      ) {
        throw new Error(INVALID_TRANSITION);
      }
      if (recovery !== undefined) stored.receipt = { ...stored.receipt, recovery };
      return complete(stored, outcome);
    },
    abandon: (invocationId) => complete(liveReceipt(invocationId), 'abandoned'),
    invocationFor: (invocationId) => {
      const stored = records.get(invocationId);
      return stored ? copyInvocation(stored.invocation) : undefined;
    },
    teardown: () => {
      for (const stored of [...live]) complete(stored, 'abandoned');
    },
    snapshot: () => ({
      live: live.map((stored) => copyReceipt(stored.receipt)),
      completed: completed.map((stored) => copyReceipt(stored.receipt)),
    }),
  };
}
