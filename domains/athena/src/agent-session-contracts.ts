/** The kind of one activity streamed from an Athena agent session. */
export type SessionActivityType = 'thought' | 'action' | 'response' | 'elicitation' | 'error';

/** Approval marker attached to an action that must be reviewed before it is applied. */
export type SessionActivityApproval = 'proposed';

/** A structured, human-reviewable change proposal produced by a session. */
export interface SessionActionBody {
  /** The change category, for example `update_task`. */
  readonly kind: string;
  /** Plain-language summary shown to the reviewer. */
  readonly summary: string;
  /** Optional structured representation of the proposed change. */
  readonly diff?: unknown;
}

/** One item streamed as Athena works through a hosted session. */
export interface SessionActivity {
  /** The kind of progress, response, question, action proposal, or error. */
  readonly type: SessionActivityType;
  /** Text for non-action activities, or a reviewable action proposal. */
  readonly body: string | SessionActionBody;
  /** Present only for a gated action proposal. */
  readonly approval?: SessionActivityApproval;
}

/** Inputs the session host supplies to an execution backend. */
export interface StartSessionInput {
  /** Docket-owned durable session identifier. */
  readonly sessionId: string;
  /** Task brief the delegated agent should carry out. */
  readonly task: string;
  /** The agent identity or slug to run. */
  readonly agent: string;
}

/**
 * The delivery-neutral session execution port.
 *
 * An API server, local test harness, or desktop host can substitute a provider adapter without
 * changing how it records a session's activity stream.
 */
export interface AgentRuntime {
  /** Start an agent session and emit its activities in order. */
  startSession(input: StartSessionInput): AsyncIterable<SessionActivity>;
}
