/**
 * The in-memory, replayable progress bus shared by active Athena agents.
 *
 * Durable event storage remains the long-term record. This bus provides the fast, local
 * observation surface that lets a UI or desktop host see interleaved agent progress immediately.
 */

/** Lifecycle verbs an agent may publish. */
export type AgentUpdateKind =
  'agent_started' | 'agent_progress' | 'agent_blocked' | 'agent_completed' | 'agent_failed';

/** All lifecycle verbs, in normal progression order. */
export const AGENT_UPDATE_KINDS: readonly AgentUpdateKind[] = [
  'agent_started',
  'agent_progress',
  'agent_blocked',
  'agent_completed',
  'agent_failed',
];

/** Verbs after which the agent should not publish more updates. */
export const TERMINAL_AGENT_UPDATE_KINDS: readonly AgentUpdateKind[] = [
  'agent_completed',
  'agent_failed',
];

/** Identity and ownership fields carried by every agent update. */
export interface AgentIdentity {
  /** Session that emitted the update. */
  readonly sessionId: string;
  /** Session that spawned this one, or `null` for the root dispatcher. */
  readonly parentSessionId: string | null;
  /** Human owner of the delegated work. */
  readonly ownerUserId: string;
  /** Human-readable agent name. */
  readonly agentName: string;
  /** Related Docket task, when the work has one. */
  readonly taskId: string | null;
}

/** One immutable update in the merged agent progress stream. */
export interface AgentUpdate extends AgentIdentity {
  /** Monotonic, bus-local ordering cursor. */
  readonly sequence: number;
  /** Lifecycle change being reported. */
  readonly kind: AgentUpdateKind;
  /** Human-readable milestone. */
  readonly milestone: string;
  /** Estimated completion, normalized to 0–100, or `null` when unknown. */
  readonly progress: number | null;
  /** Stable machine code for a block or failure, never user-facing error copy. */
  readonly reasonCode: string | null;
  /** Time at which the update occurred. */
  readonly at: Date;
}

/** Publisher-provided update fields before the bus assigns its sequence and defaults. */
export type AgentUpdateInput = AgentIdentity & {
  /** Lifecycle change being reported. */
  readonly kind: AgentUpdateKind;
  /** Human-readable milestone. */
  readonly milestone: string;
  /** Optional estimated completion. */
  readonly progress?: number | null;
  /** Optional stable machine reason code. */
  readonly reasonCode?: string | null;
  /** Optional occurrence timestamp; defaults to publication time. */
  readonly at?: Date;
};

/** Narrow a merged stream subscription or history read. */
export interface AgentBusFilter {
  /** Restrict updates to one human owner. */
  readonly ownerUserId?: string;
  /** Restrict updates to one or more session ids. */
  readonly sessionIds?: readonly string[];
  /** Replay only updates after this cursor. Live updates continue regardless of this bound. */
  readonly since?: number;
}

/** Receives one matching update. */
export type AgentBusListener = (update: AgentUpdate) => void;

/** Observable, replayable port for agent updates. */
export interface AgentBus {
  /** Publish an update and return the assigned immutable update. */
  publish(input: AgentUpdateInput): AgentUpdate;
  /** Subscribe to matching retained history followed by the live tail. */
  subscribe(filter: AgentBusFilter, listener: AgentBusListener): () => void;
  /** Read retained matching history without attaching a listener. */
  history(filter?: AgentBusFilter): readonly AgentUpdate[];
  /** Read the latest assigned sequence number. */
  cursor(): number;
}

/** Construction options for {@link InMemoryAgentBus}. */
export interface InMemoryAgentBusOptions {
  /** Maximum history rows retained for late subscribers. */
  readonly retain?: number;
}

/** Default number of updates replayable to late subscribers. */
export const DEFAULT_AGENT_BUS_RETENTION = 2000;

function matches(update: AgentUpdate, filter: AgentBusFilter | undefined): boolean {
  if (!filter) return true;
  if (filter.ownerUserId !== undefined && update.ownerUserId !== filter.ownerUserId) return false;
  if (filter.sessionIds !== undefined && !filter.sessionIds.includes(update.sessionId))
    return false;
  if (filter.since !== undefined && update.sequence <= filter.since) return false;
  return true;
}

function normalizeProgress(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * In-process agent bus with bounded immutable history.
 *
 * Sequence assignment happens before listener fan-out, so a thrown listener cannot corrupt the
 * retained record. A listener that publishes during callback delivery sees the next sequence.
 */
export class InMemoryAgentBus implements AgentBus {
  private readonly retain: number;
  private readonly retained: AgentUpdate[] = [];
  private readonly listeners = new Set<{
    readonly filter: AgentBusFilter;
    readonly listener: AgentBusListener;
  }>();
  private sequence = 0;

  constructor(options: InMemoryAgentBusOptions = {}) {
    this.retain = options.retain ?? DEFAULT_AGENT_BUS_RETENTION;
  }

  /** Publish an ordered update, retain it, then synchronously fan it out. */
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
    if (this.retained.length > this.retain) {
      this.retained.splice(0, this.retained.length - this.retain);
    }
    for (const entry of [...this.listeners]) {
      const liveFilter: AgentBusFilter = {
        ...(entry.filter.ownerUserId === undefined
          ? {}
          : { ownerUserId: entry.filter.ownerUserId }),
        ...(entry.filter.sessionIds === undefined ? {} : { sessionIds: entry.filter.sessionIds }),
      };
      if (matches(update, liveFilter)) entry.listener(update);
    }
    return update;
  }

  /** Replay matching retained history, then attach the listener to the live tail. */
  subscribe(filter: AgentBusFilter, listener: AgentBusListener): () => void {
    const entry = { filter, listener };
    this.listeners.add(entry);
    for (const update of this.retained) {
      if (matches(update, filter)) listener(update);
    }
    return () => this.listeners.delete(entry);
  }

  /** Read matching retained history. */
  history(filter?: AgentBusFilter): readonly AgentUpdate[] {
    return this.retained.filter((update) => matches(update, filter));
  }

  /** Read the current monotonic sequence cursor. */
  cursor(): number {
    return this.sequence;
  }

  /** Clear state for shutdown and tests. */
  reset(): void {
    this.listeners.clear();
    this.retained.length = 0;
    this.sequence = 0;
  }
}

/** Reduce a merged stream to each session's latest update, retaining first-seen session order. */
export function projectAgentStates(updates: readonly AgentUpdate[]): readonly AgentUpdate[] {
  const latest = new Map<string, AgentUpdate>();
  for (const update of updates) latest.set(update.sessionId, update);
  return [...latest.values()];
}

/** Return whether two agents' first-to-last update intervals overlap. */
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
  const first = span(sessionA);
  const second = span(sessionB);
  return first !== null && second !== null && first.from <= second.to && second.from <= first.to;
}
