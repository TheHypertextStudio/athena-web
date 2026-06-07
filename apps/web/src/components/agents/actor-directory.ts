/**
 * Actor-name resolution for the Agents (sessions) flagship.
 *
 * @remarks
 * Sessions reference actors by id (the agent's backing actor, the session initiator, the
 * agent's accountable owner). The RPC exposes humans via the members list and agents via the
 * agents list (which carries the agent's `actorId` + `accountableOwnerId` but not a display
 * name — there is no actors-list endpoint). This builds a single directory mapping every
 * known actor id to a readable `{ name, kind, avatarUrl }`, mirroring the work view's
 * convention: humans resolve from members; agent actors that aren't members are labelled
 * with the neutral `'Agent'` tag and the `agent` kind so the avatar reads as automated.
 */
import type { ActorKind } from '@docket/ui/components';
import type { AgentOut, MemberOut } from '@docket/types';

/** A resolved actor descriptor (name + kind + optional avatar). */
export interface ResolvedActor {
  /** Display name for labels + avatar fallback. */
  readonly name: string;
  /** Actor kind (drives the avatar shape). */
  readonly kind: ActorKind;
  /** Optional avatar image URL. */
  readonly avatarUrl?: string | null;
}

/** The actor directory: a resolver keyed by actor id, plus per-agent owner lookup. */
export interface ActorDirectory {
  /** Resolve an actor id to its descriptor, or a neutral fallback when unknown. */
  resolve: (actorId: string | null | undefined) => ResolvedActor;
  /** Map an agent's *agent id* to its backing actor id (for session → agent joins). */
  actorIdForAgent: (agentId: string) => string | null;
  /** Resolve an agent's accountable owner name by the *agent id*, or `null`. */
  ownerNameForAgent: (agentId: string) => string | null;
}

/** A neutral fallback for an actor id we cannot resolve to a richer identity. */
const UNKNOWN: ResolvedActor = { name: 'Someone', kind: 'human' };

/**
 * Build an {@link ActorDirectory} from the org's members and registered agents.
 *
 * @remarks
 * Pure and synchronous so callers can memoize it against `[members, agents]`. Members map
 * their `actorId → { name, kind: 'human' }`; agents then mark their backing actor as
 * `kind: 'agent'` (synthesizing the neutral `'Agent'` label when the actor is not also a
 * member), exactly as the work view does.
 *
 * @param members - The org's human members.
 * @param agents - The org's registered agents.
 * @returns the resolver bundle.
 */
export function buildActorDirectory(
  members: readonly MemberOut[],
  agents: readonly AgentOut[],
): ActorDirectory {
  const byActorId = new Map<string, ResolvedActor>();
  for (const member of members) {
    byActorId.set(member.actorId, {
      name: member.displayName,
      kind: 'human',
      avatarUrl: member.avatar,
    });
  }
  for (const agent of agents) {
    const existing = byActorId.get(agent.actorId);
    byActorId.set(
      agent.actorId,
      existing ? { ...existing, kind: 'agent' } : { name: 'Agent', kind: 'agent' },
    );
  }

  // Key by the plain string id so the public lookups accept unbranded ids (a session's
  // `agentId` is a branded `AgentId`, but callers pass it through as a string).
  const agentById = new Map<string, AgentOut>(agents.map((agent) => [agent.id, agent]));

  return {
    resolve: (actorId) => (actorId ? (byActorId.get(actorId) ?? UNKNOWN) : UNKNOWN),
    actorIdForAgent: (agentId) => agentById.get(agentId)?.actorId ?? null,
    ownerNameForAgent: (agentId) => {
      const ownerId = agentById.get(agentId)?.accountableOwnerId;
      if (!ownerId) return null;
      const owner = byActorId.get(ownerId);
      return owner ? owner.name : null;
    },
  };
}
