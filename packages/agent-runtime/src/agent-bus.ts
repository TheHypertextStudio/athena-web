/**
 * `@docket/agent-runtime` — the observable shared bus every running agent reports through.
 *
 * @remarks
 * Athena is a singular agent that spawns agents for specific tasks. Those agents run
 * independently and concurrently, so there is no call stack to read their progress off: the only
 * way a consumer can watch all of them at once is if each one publishes to the same bus and the
 * consumer subscribes to it once.
 *
 * Three properties make this a bus rather than a callback list, and each one is a requirement:
 *
 * 1. **Merged and ordered.** One subscription receives every agent's updates interleaved in a
 *    single monotonic sequence. Each update carries its own agent and task identity, so a
 *    consumer can demultiplex without the bus having to fan out per agent.
 * 2. **Replayable.** Updates published before a subscriber attaches are still readable after it
 *    attaches. An agent that finishes in 40ms would otherwise be invisible to a UI that opened
 *    50ms later, which is precisely the failure a "shared observable bus" is supposed to prevent.
 * 3. **Immutable history.** Killing, cancelling or failing an agent leaves its prior updates in
 *    the bus. Interruption stops future writes; it never rewrites the record.
 *
 * This module is the in-process, retained-history implementation. The API layer publishes onto it
 * AND onto the durable `event` substrate, so a consumer that missed the retention window can
 * still read the same milestones from the database.
 */

/** The lifecycle verbs an agent reports. Mirrors the durable `agent_*` event kinds. */
export type AgentUpdateKind =
  | 'agent_started'
  | 'agent_progress'
  | 'agent_blocked'
  | 'agent_completed'
  | 'agent_failed';

/** Every update verb, in lifecycle order. */
export const AGENT_UPDATE_KINDS: readonly AgentUpdateKind[] = [
  'agent_started',
  'agent_progress',
  'agent_blocked',
  'agent_completed',
  'agent_failed',
];

/** The verbs after which an agent publishes nothing further. */
export const TERMINAL_AGENT_UPDATE_KINDS: readonly AgentUpdateKind[] = [
  'agent_completed',
  'agent_failed',
];

/** Who published an update and what work it concerns. */
export interface AgentIdentity {
  /** The publishing agent's session id — the bus's per-agent identity. */
  readonly sessionId: string;
  /** The session that spawned this one, or `null` for the dispatcher itself. */
  readonly parentSessionId: string | null;
  /** The human this work belongs to. */
  readonly ownerUserId: string;
  /** The specific task this agent was spawned for, in the words the user will read. */
  readonly agentName: string;
  /** The Docket work item this agent is acting on, when it has one. */
  readonly taskId: string | null;
}

/** One update published to the bus. */
export interface AgentUpdate extends AgentIdentity {
  /** Monotonic per-bus position; assigned on publish, never reused. */
  readonly sequence: number;
  /** The lifecycle verb. */
  readonly kind: AgentUpdateKind;
  /** The current step, in the agent's own words. Rendered as content, never as error copy. */
  readonly milestone: string;
  /** Self-reported completion, 0–100, when the agent can estimate it. */
  readonly progress: number | null;
  /** A stable machine code for a block or failure. Never rendered verbatim. */
  readonly reasonCode: string | null;
  /** When it happened. */
  readonly at: Date;
}

/** The fields a publisher supplies; the bus assigns the rest. */
export type AgentUpdateInput = AgentIdentity & {
  /** The lifecycle verb. */
  readonly kind: AgentUpdateKind;
  /** The current step, in the agent's own words. */
  readonly milestone: string;
  /** Self-reported completion, 0–100. */
  readonly progress?: number | null;
  /** A stable machine code for a block or failure. */
  readonly reasonCode?: string | null;
  /** When it happened; defaults to now. */
  readonly at?: Date;
};

/** Narrow a subscription to a subset of the merged stream. */
export interface AgentBusFilter {
  /** Only updates owned by this user. */
  readonly ownerUserId?: string;
  /** Only updates from these sessions (an agent and the agents it spawned, for example). */
  readonly sessionIds?: readonly string[];
  /** Replay strictly after this sequence; omit to replay everything retained. */
  readonly since?: number;
}

/** Invoked once per matching update, in sequence order. */
export type AgentBusListener = (update: AgentUpdate) => void;

/** The observable shared bus port. */
export interface AgentBus {
  /**
   * Publish one update and return it with its assigned sequence.
   *
   * @param input - The update to publish.
   */
  publish(input: AgentUpdateInput): AgentUpdate;
  /**
   * Attach a listener, replaying retained history first so nothing published earlier is missed.
   *
   * @param filter - Which slice of the merged stream to receive.
   * @param listener - Invoked with each matching update, replay then live, in sequence order.
   * @returns a detach function.
   */
  subscribe(filter: AgentBusFilter, listener: AgentBusListener): () => void;
  /**
   * Read retained history without attaching.
   *
   * @param filter - Which slice of the merged stream to read.
   */
  history(filter?: AgentBusFilter): readonly AgentUpdate[];
  /** The highest sequence assigned so far; `0` when nothing has been published. */
  cursor(): number;
}

/** Construction options for {@link InMemoryAgentBus}. */
export interface InMemoryAgentBusOptions {
  /** How many updates to retain for replay. Oldest are dropped first. */
  readonly retain?: number;
}

/** How many updates the bus retains for replay when nothing overrides it. */
export const DEFAULT_AGENT_BUS_RETENTION = 2000;

/** True when an update matches a filter. */
function matches(update: AgentUpdate, filter: AgentBusFilter | undefined): boolean {
  if (!filter) return true;
  if (filter.ownerUserId !== undefined && update.ownerUserId !== filter.ownerUserId) return false;
  if (filter.sessionIds !== undefined && !filter.sessionIds.includes(update.sessionId))
    return false;
  if (filter.since !== undefined && update.sequence <= filter.since) return false;
  return true;
}

/** Clamp a self-reported completion into 0–100, or drop it when it is not a number. */
function normalizeProgress(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * The in-process bus with retained history.
 *
 * @remarks
 * Publishing is synchronous and ordered: a listener that publishes from inside its own callback
 * still sees a strictly increasing sequence, because the sequence is assigned before any listener
 * runs. Listeners are copied before iteration so one that detaches mid-fan-out cannot truncate
 * delivery to the others — the "one agent's failure must not stall the others" rule applies to
 * the bus itself, not only to the agents.
 */
export class InMemoryAgentBus implements AgentBus {
  private readonly retain: number;
  private readonly retained: AgentUpdate[] = [];
  private readonly listeners = new Set<{
    readonly filter: AgentBusFilter;
    readonly listener: AgentBusListener;
  }>();
  private sequence = 0;

  /**
   * @param options - Retention override.
   */
  constructor(options: InMemoryAgentBusOptions = {}) {
    this.retain = options.retain ?? DEFAULT_AGENT_BUS_RETENTION;
  }

  /** {@inheritDoc AgentBus.publish} */
  publish(input: AgentUpdateInput): AgentUpdate {
    this.sequence += 1;
    const update: AgentUpdate = {
      sequence: this.sequence,
      sessionId: input.sessionId,
      parentSessionId: input.parentSessionId,
      ownerUserId: input.ownerUserId,
      agentName: input.agentName,
      taskId: input.taskId,
      kind: input.kind,
      milestone: input.milestone,
      progress: normalizeProgress(input.progress),
      reasonCode: input.reasonCode ?? null,
      at: input.at ?? new Date(),
    };
    this.retained.push(update);
    if (this.retained.length > this.retain)
      this.retained.splice(0, this.retained.length - this.retain);
    for (const entry of [...this.listeners]) {
      // `since` bounds a replay, not the live tail: a subscriber that has already been fed
      // history must keep receiving what happens next.
      const live: AgentBusFilter = {
        ...(entry.filter.ownerUserId !== undefined
          ? { ownerUserId: entry.filter.ownerUserId }
          : {}),
        ...(entry.filter.sessionIds !== undefined ? { sessionIds: entry.filter.sessionIds } : {}),
      };
      if (matches(update, live)) entry.listener(update);
    }
    return update;
  }

  /** {@inheritDoc AgentBus.subscribe} */
  subscribe(filter: AgentBusFilter, listener: AgentBusListener): () => void {
    const entry = { filter, listener };
    this.listeners.add(entry);
    for (const update of this.retained) {
      if (matches(update, filter)) listener(update);
    }
    return () => {
      this.listeners.delete(entry);
    };
  }

  /** {@inheritDoc AgentBus.history} */
  history(filter?: AgentBusFilter): readonly AgentUpdate[] {
    return this.retained.filter((update) => matches(update, filter));
  }

  /** {@inheritDoc AgentBus.cursor} */
  cursor(): number {
    return this.sequence;
  }

  /** Detach every listener and drop retained history. Test and shutdown use only. */
  reset(): void {
    this.listeners.clear();
    this.retained.length = 0;
    this.sequence = 0;
  }
}

/**
 * Reduce a merged update stream to the live state of every agent in it.
 *
 * @remarks
 * The "what is Athena doing right now" projection: last verb wins per session, and a session
 * that has reported a terminal verb is no longer running. Pure, so a surface can call it on
 * every frame and a test can assert on it without a clock.
 *
 * @param updates - Any slice of the merged stream, in sequence order.
 * @returns one entry per session, ordered by the session's first appearance.
 */
export function projectAgentStates(updates: readonly AgentUpdate[]): readonly AgentUpdate[] {
  const latest = new Map<string, AgentUpdate>();
  for (const update of updates) latest.set(update.sessionId, update);
  return [...latest.values()];
}

/**
 * True when two agents' update intervals overlap in time — i.e. they really ran concurrently.
 *
 * @remarks
 * Exists so "agents act independently" can be asserted from the recorded timeline rather than
 * from the absence of a `for` loop in the source.
 *
 * @param updates - The merged stream.
 * @param sessionA - One agent's session id.
 * @param sessionB - The other agent's session id.
 */
export function agentIntervalsOverlap(
  updates: readonly AgentUpdate[],
  sessionA: string,
  sessionB: string,
): boolean {
  const span = (sessionId: string): { from: number; to: number } | null => {
    const own = updates.filter((update) => update.sessionId === sessionId);
    const first = own[0];
    const last = own.at(-1);
    if (!first || !last) return null;
    return { from: first.at.getTime(), to: last.at.getTime() };
  };
  const a = span(sessionA);
  const b = span(sessionB);
  if (!a || !b) return false;
  return a.from <= b.to && b.from <= a.to;
}
