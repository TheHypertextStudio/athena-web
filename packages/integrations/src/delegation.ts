/**
 * `@docket/integrations` — the delegation boundary: handing one Docket task to an agent
 * execution surface that is not Docket, and reading the outcome back.
 *
 * @remarks
 * ## Why this is a port and not a client
 *
 * The surface Docket delegates to is Lovelace Lattice. `apps/lattice-delegate-mcp` in the
 * `lovelace` repository exposes `delegate` / `status` / `result` / `list_delegated` /
 * `cancel_delegated` as MCP tools over a `DelegateService`, and `lattice-ctl submit
 * task|status|result` is the same operations in CLI form. Neither is reachable from a deployed
 * Docket today: the relay behind them has no public URL, and every submission is sealed
 * end-to-end against a runtime work key with a reply key the submitting controller mints — key
 * material Docket does not hold and cannot mint without vendoring the relay crypto.
 *
 * So the loop that drains agent-assigned work is written against this two-method port rather
 * than against a client. That is the interim bridge: the sweep, its idempotency, its failure
 * handling, and its proposal write-back are all real and all tested, and the day a reachable
 * relay exists only one adapter has to be written.
 *
 * ## Why two methods and not five
 *
 * `submit` is Lattice's `delegate`. `poll` folds Lattice's `status` and `result` into the one
 * question this sweep actually asks — "is it finished, and if so what did it produce" — because
 * a poller always wants both, and splitting them would widen the window in which a finished
 * result is visible but not yet read. `list_delegated` and `cancel_delegated` are deliberately
 * absent: Docket's own `agent_delegation` rows are the list of outstanding work — a list read
 * back from the far side could not be joined to a task anyway — and nothing in the drain cancels.
 *
 * ## The shapes are Lattice's, restated
 *
 * {@link DelegationWorkState} is `RelayWorkState` from `@lovelace-ai/lattice-relay-client`,
 * {@link DelegationOutcome} is its `DelegateOutcome`, {@link DelegationRequest} is the subset of
 * `DelegateRequest` a Docket task can express, and {@link DelegationSubmission} is
 * `DelegateAcceptance`. They are restated here rather than imported because that package is not
 * published to a registry Docket installs from; restating keeps the adapter a pass-through
 * instead of a lossy translation, so a future real client can be written without reshaping
 * anything the drain persists.
 */

/**
 * Lifecycle of one delegated unit of work, as the delegation surface reports it.
 *
 * @remarks
 * Verbatim `RelayWorkState`. `pending`, `offline_queued`, `queue_full` and `rate_limited` come
 * from a submission response rather than from a later poll; the rest can arrive from either.
 * Only `completed`, `failed`, `expired` and `cancelled` are terminal.
 */
export type DelegationWorkState =
  | 'pending'
  | 'queued'
  | 'offline_queued'
  | 'in_flight'
  | 'completed'
  | 'expired'
  | 'queue_full'
  | 'rate_limited'
  | 'cancelled'
  | 'failed';

/**
 * Terminal outcome sealed by the executing runtime.
 *
 * @remarks
 * Verbatim `DelegateOutcome`. `work_key_expired` is deliberately distinct from `failed`: the
 * runtime could not open the work at all because its key rotated, so the repair is to
 * re-register the machine, not to retry the instruction.
 */
export type DelegationOutcome =
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'work_key_expired'
  | 'expired';

/** Terminal states — a poll that reports one of these will never advance again. */
const TERMINAL_STATES: readonly DelegationWorkState[] = [
  'completed',
  'failed',
  'expired',
  'cancelled',
];

/**
 * Whether a reported state is final.
 *
 * @param state - The state a submission or poll reported.
 * @returns true when no later poll can change it.
 */
export function isTerminalDelegationState(state: DelegationWorkState): boolean {
  return TERMINAL_STATES.includes(state);
}

/** The repository an instruction operates on, materialized by the executing runtime. */
export interface DelegationRepoRef {
  /** Clone URL the runtime checks out with its own credentials. */
  readonly remoteUrl: string;
  /** Branch, tag, or commit to check out. */
  readonly ref: string;
}

/** One unit of work handed to the delegation surface. */
export interface DelegationRequest {
  /** What the remote agent should do, stated as a complete task. */
  readonly instruction: string;
  /**
   * Caller idempotency identity.
   *
   * @remarks
   * The delegation surface deduplicates on this, which is what makes a retried submit safe on
   * the far side as well as the near side. Docket derives it from the delegation row id, so the
   * same row can never open two units of remote work.
   */
  readonly logicalSubmissionId: string;
  /** How the remote agent knows it is done. */
  readonly acceptanceCriteria?: string;
  /** Tool ids the remote agent may use; absent grants none, limiting it to reasoning. */
  readonly toolPolicy?: readonly string[];
  /** Repository to materialize before executing. */
  readonly repoRef?: DelegationRepoRef;
  /** `long_running` for work that needs more than a couple of minutes. */
  readonly executionMode?: 'standard' | 'long_running';
  /** Opaque tracing metadata forwarded verbatim; Docket sends its own provenance here. */
  readonly metadata?: Record<string, unknown>;
}

/** What the delegation surface returned when it accepted a submission. */
export interface DelegationSubmission {
  /** Stable work id to poll with. */
  readonly workId: string;
  /** State at the moment of acceptance. */
  readonly state: DelegationWorkState;
  /** Identity of the runtime the work was addressed to. */
  readonly runtimeId: string;
  /** Display name of that runtime, so provenance can name the machine. */
  readonly runtimeName: string;
  /** When the surface will expire the work if it has not finished. */
  readonly deadlineAt: string;
}

/** The terminal outcome and payload of one delegated unit of work. */
export interface DelegationResult {
  /** How it ended. */
  readonly outcome: DelegationOutcome;
  /** The payload the runtime sealed. Opaque here; see {@link delegationOutputText}. */
  readonly payload: unknown;
  /** When the surface opened it. */
  readonly openedAt: string;
}

/** One poll of delegated work. */
export interface DelegationPoll {
  /** Current state. */
  readonly state: DelegationWorkState;
  /** How long the surface suggests waiting before polling again. */
  readonly nextPollAfterMs: number;
  /** The terminal result, once one is readable; null while the work is still running. */
  readonly result: DelegationResult | null;
}

/**
 * Machine-readable reason a delegation operation could not proceed.
 *
 * @remarks
 * `DelegateErrorCode` from the relay client, plus `not_configured` for the state Docket is
 * actually in today — no delegation surface wired up at all. Stable codes, never provider prose:
 * every surface that renders one of these owns its own copy for it.
 */
export type DelegationUnavailableReason =
  | 'not_configured'
  | 'no_runtime_registered'
  | 'runtime_not_found'
  | 'runtime_unreachable'
  | 'no_usable_work_key'
  | 'submission_rejected'
  | 'unknown_work'
  | 'result_not_ready'
  | 'work_expired';

/**
 * Thrown when a delegation operation cannot proceed.
 *
 * @remarks
 * Callers branch on {@link DelegationUnavailableError.reason}. The message is for logs and
 * persisted diagnostics only — it is never rendered, and it is never parsed.
 */
export class DelegationUnavailableError extends Error {
  /**
   * @param reason - Stable code the caller branches on.
   */
  constructor(readonly reason: DelegationUnavailableReason) {
    super(`Delegation unavailable: ${reason}`);
    this.name = 'DelegationUnavailableError';
  }
}

/**
 * The delegation surface, narrowed to what a standing drain needs.
 *
 * @remarks
 * Two methods, so a real Lattice client and a test double are equally cheap to satisfy it with.
 * Both may throw {@link DelegationUnavailableError}; a caller that catches one has a stable
 * reason to record and retry against.
 */
export interface DelegationPort {
  /**
   * Hand one unit of work to the delegation surface.
   *
   * @param request - The work, including its idempotency identity.
   * @returns the accepted submission.
   * @throws {DelegationUnavailableError} When no runtime can take the work.
   */
  submit(request: DelegationRequest): Promise<DelegationSubmission>;
  /**
   * Ask what became of previously submitted work.
   *
   * @param workId - The id {@link DelegationPort.submit} returned.
   * @returns the current state, and the terminal result once there is one.
   * @throws {DelegationUnavailableError} When the surface does not recognize the work id.
   */
  poll(workId: string): Promise<DelegationPoll>;
}

/**
 * Read the human-readable report out of a sealed result payload.
 *
 * @remarks
 * A Lattice agent task seals a `TextGenerationTaskResponse`-shaped payload whose `outputText`
 * holds what the remote agent wrote. Knowing that is boundary knowledge, so it lives here rather
 * than in the sweep. Anything else — an older schema, a runtime that sealed something else —
 * returns null rather than a guess, and the caller supplies its own copy.
 *
 * @param payload - The opened payload from a {@link DelegationResult}.
 * @returns the report text, or null when the payload does not carry one.
 */
export function delegationOutputText(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const text = (payload as Record<string, unknown>)['outputText'];
  return typeof text === 'string' && text.trim().length > 0 ? text : null;
}
