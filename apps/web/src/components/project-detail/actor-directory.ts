/**
 * A small in-memory directory that resolves an actor id to its display name + kind.
 *
 * @remarks
 * The project-detail screen renders many "who" references — the project lead, comment
 * authors, update authors, and the agents working here — but the RPC surface exposes
 * actors split across `GET …/members` (humans) and `GET …/agents` (agents), each keyed
 * differently. This directory unifies them into one `id → {name, kind}` map so every
 * {@link ActorAvatar} on the screen renders a real name and the correct kind shape, with
 * a graceful fallback for an id we never loaded (e.g. a removed member).
 */
import type { ActorKind } from '@docket/ui/components';

/** A resolved actor: its display name and kind (drives the avatar shape). */
export interface ActorInfo {
  /** The actor's display name. */
  readonly name: string;
  /** The actor's kind, selecting the avatar shape + ring. */
  readonly kind: ActorKind;
}

/** A resolver from an actor id to its {@link ActorInfo}. */
export type ActorDirectory = (actorId: string | null | undefined) => ActorInfo;

/** Inputs used to build an {@link ActorDirectory}. */
export interface BuildActorDirectoryInput {
  /** Human members (`actorId` + `displayName`). */
  readonly members: readonly { actorId: string; displayName: string }[];
  /** Agent display names keyed by their backing actor id. */
  readonly agents: readonly { actorId: string; name: string }[];
}

/**
 * Build an {@link ActorDirectory} from the org's members and agents.
 *
 * @param input - The loaded members + agents.
 * @returns a resolver that maps an actor id to its name + kind, falling back to a short id.
 */
export function buildActorDirectory({ members, agents }: BuildActorDirectoryInput): ActorDirectory {
  const byId = new Map<string, ActorInfo>();
  for (const m of members) byId.set(m.actorId, { name: m.displayName, kind: 'human' });
  for (const a of agents) byId.set(a.actorId, { name: a.name, kind: 'agent' });
  return (actorId) => {
    if (!actorId) return { name: 'System', kind: 'human' };
    return byId.get(actorId) ?? { name: `Member ${actorId.slice(0, 6)}`, kind: 'human' };
  };
}
