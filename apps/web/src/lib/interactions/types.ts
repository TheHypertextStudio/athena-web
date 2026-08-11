import type { INTERACTION_CATALOG, ROUTE_TEMPLATE_IDS } from './catalog';

/** A stable, closed identifier for one named interaction lifecycle. */
export type InteractionId = (typeof INTERACTION_CATALOG)[number]['id'];

/** The acknowledgement class that owns an interaction lifecycle. */
export type InteractionCategory = (typeof INTERACTION_CATALOG)[number]['category'];

/** A permitted route shape, never a concrete pathname or URL. */
export type RouteTemplateId = (typeof ROUTE_TEMPLATE_IDS)[number];

/** The observable stage of an interaction receipt. */
export type InteractionPhase = 'activated' | 'acknowledged' | 'progressing' | 'settled';

/** The terminal resolution recorded for an interaction. */
export type InteractionOutcome =
  | 'succeeded'
  | 'needs_attention'
  | 'failed'
  | 'handed_off'
  | 'superseded'
  | 'abandoned'
  | 'timed_out';

/** A closed, application-owned recovery affordance for attention-required work. */
export type InteractionRecovery = 'retry' | 'revert' | 'reconnect' | 'reauthenticate' | 'continue';

/**
 * The ephemeral correlation metadata for one live interaction.
 *
 * @remarks
 * Invocation identifiers remain in the in-memory trace only. They are deliberately absent from
 * {@link InteractionReceipt}, diagnostic snapshots, persistence, and observation sinks.
 */
export interface InteractionInvocation {
  /** The named lifecycle being observed. */
  readonly interactionId: InteractionId;
  /** The acknowledgement category required by that lifecycle. */
  readonly category: InteractionCategory;
  /** The route shape that owns the lifecycle. */
  readonly routeTemplateId: RouteTemplateId;
  /** A page-lifetime-only correlation value. */
  readonly invocationId: string;
  /** The page-lifetime-only root invocation when this work is a child. */
  readonly parentInvocationId?: string;
}

/**
 * A privacy-safe observation of named asynchronous work.
 *
 * @remarks
 * This intentionally contains only closed metadata and timestamps. It cannot carry invocation
 * ids, typed text, entity ids, paths, URLs, request values, exception objects, or diagnostics.
 */
export interface InteractionReceipt {
  /** The named lifecycle being observed. */
  readonly interactionId: InteractionId;
  /** The acknowledgement category required by that lifecycle. */
  readonly category: InteractionCategory;
  /** The route shape that owns the lifecycle. */
  readonly routeTemplateId: RouteTemplateId;
  /** The receipt's current lifecycle stage. */
  readonly phase: InteractionPhase;
  /** Milliseconds when the invocation was activated. */
  readonly startedAt: number;
  /** Milliseconds when a committed acknowledgement was recorded. */
  readonly acknowledgedAt?: number;
  /** Milliseconds when durable progress was recorded. */
  readonly progressAt?: number;
  /** Milliseconds when the lifecycle reached a terminal outcome. */
  readonly settledAt?: number;
  /** The closed terminal resolution, once settled. */
  readonly outcome?: InteractionOutcome;
  /** The closed recovery affordance retained for attention-required work. */
  readonly recovery?: InteractionRecovery;
}

/** A bounded, serializable diagnostic view of interaction receipts. */
export interface InteractionReceiptSnapshot {
  /** In-flight receipts, ordered oldest-first. */
  readonly live: readonly InteractionReceipt[];
  /** Settled receipts, ordered oldest-first. */
  readonly completed: readonly InteractionReceipt[];
}

/** A metadata-only development/test failure emitted when the live trace overflows. */
export interface InteractionLeakFailure {
  /** The closed failure code; it never includes a receipt or invocation identifier. */
  readonly code: 'live-capacity-exceeded';
}
