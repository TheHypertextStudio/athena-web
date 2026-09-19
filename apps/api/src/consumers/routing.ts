/**
 * `@docket/api` — relevance routing (the "concerns me" resolver), a Strategy registry.
 *
 * @remarks
 * The single place that answers "which users does this event concern, and why" — consumed
 * uniformly by BOTH pipelines (internal emit and the external drain), replacing the two
 * duplicated implementations that used to live inline in each. Given a canonical event it
 * writes the {@link eventRecipient} fan-out rows with a `reason`.
 *
 * The per-entity-kind owner resolution is a **Strategy registry** keyed on
 * {@link CanonicalEntityKind} ({@link OWNER_RULES}): a Docket `work_item` resolves its
 * assignee/delegate/creator, a `project` its lead/creator, etc. An entity kind with no rule
 * (or an external entity not yet mapped to a Docket twin) simply yields no owners — the
 * external integration-owner fallback (`ownerUserId`) and explicit followers still apply.
 * Adding an entity kind = adding a registry entry, never editing a switch.
 *
 * Two policies sit above the registry, stated once here so no producer re-invents them:
 * **personal kinds** (tracking) route to the acting person alone and never fan out, and
 * **direct recipients** are delivered verbatim, exempt from the self-exclusion, for events
 * that address someone by construction (an agent asking *you* a question).
 */
import {
  actor,
  agentSession,
  eventRecipient,
  initiative,
  program,
  project,
  streamSubscription,
  task,
} from '@docket/db';
import { PERSONAL_EVENT_KINDS } from '@docket/connections/event-contract';
import type {
  CanonicalEntityKind,
  EventKind,
  SourceSystemKind,
} from '@docket/connections/event-contract';
import type { StreamRelevance } from '../contracts/stream';
import { and, eq, inArray } from 'drizzle-orm';

import type { db } from '@docket/db';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Relevance priority — a lower rank wins when a user qualifies for several reasons. */
const RELEVANCE_RANK: Record<StreamRelevance, number> = {
  awaiting_you: 0,
  mention: 1,
  assignment: 2,
  owned: 3,
  followed: 4,
  participant: 5,
};

/**
 * A subject owner and the role that makes them relevant.
 *
 * @remarks
 * Most owners are Docket Actors (`actorId`), resolved to their Better Auth user downstream.
 * An agent session is owned by a *user* directly (`agent_session.owner_user_id`) — a
 * personal Athena run has no workspace and therefore no Actor — so a rule may return either.
 */
interface OwnerCandidate {
  readonly actorId?: string;
  /** A Better Auth user id, for subjects owned by a user rather than an org Actor. */
  readonly userId?: string;
  readonly role: 'assignee' | 'delegate' | 'lead' | 'owner' | 'creator';
}

/** The canonical reference an event is about, as needed for routing. */
export interface RoutableEntity {
  readonly kind: CanonicalEntityKind;
  readonly source: SourceSystemKind;
  /** Native id in the source. For a `docket` source this IS the Docket entity id. */
  readonly externalId: string;
  /** A resolved Docket entity id for an external ref (enrichment seam; usually null today). */
  readonly docketEntityId?: string | null;
}

/** The minimal event shape relevance routing needs. */
export interface RoutableEvent {
  readonly organizationId: string;
  readonly kind: EventKind;
  readonly entity: RoutableEntity | null;
  /** The acting Docket Actor (excluded from its own event's recipients), when internal. */
  readonly actorId?: string | null | undefined;
  /** Extra Docket Actor ids involved (e.g. @-mentions) → mention/participant recipients. */
  readonly participantActorIds?: readonly string[] | undefined;
  /** External fallback: the integration owner to notify when there are no Docket owners. */
  readonly ownerUserId?: string | null | undefined;
  /**
   * Pre-resolved external recipients (already Better Auth user ids, each with its reason).
   *
   * @remarks
   * Provider-specific resolvers use this for both simple linked-identity participants (e.g.
   * Discord mentions mapped from snowflakes) and richer provider logic (e.g. Slack
   * mention/DM/thread classification). The router still owns strongest-reason-wins merging.
   */
  readonly externalRecipients?: ReadonlyMap<string, StreamRelevance> | undefined;
  /**
   * Recipients the producer names outright, exempt from the "never surface your own action
   * to yourself" rule.
   *
   * @remarks
   * The self-exclusion is right for ambient awareness and wrong for addressed delivery. An
   * agent asking *you* a question acts as your own Athena — its Actor resolves to your user —
   * so ordinary routing would drop the one person who must see it. Timer transitions are the
   * same shape inverted: they concern nobody *but* the person who made them. Both cases
   * supply the audience here, and it survives verbatim. Use it only when the producer knows
   * the audience by construction; ambient relevance stays the router's job.
   */
  readonly directRecipients?: ReadonlyMap<string, StreamRelevance> | undefined;
}

/**
 * Per-entity-kind owner resolution — the Strategy registry. Each rule reads the Docket entity
 * by id and returns its owning Actors. Only invoked when the event's entity maps to a Docket
 * entity (internal `docket` source, or a resolved `docketEntityId`).
 */
const OWNER_RULES: Partial<
  Record<CanonicalEntityKind, (tx: Tx, docketId: string) => Promise<OwnerCandidate[]>>
> = {
  work_item: async (tx, id) => {
    const [r] = await tx
      .select({
        assigneeId: task.assigneeId,
        delegateId: task.delegateId,
        createdBy: task.createdBy,
      })
      .from(task)
      .where(eq(task.id, id))
      .limit(1);
    if (!r) return [];
    return owners([
      [r.assigneeId, 'assignee'],
      [r.delegateId, 'delegate'],
      [r.createdBy, 'creator'],
    ]);
  },
  project: async (tx, id) => {
    const [r] = await tx
      .select({ leadId: project.leadId, createdBy: project.createdBy })
      .from(project)
      .where(eq(project.id, id))
      .limit(1);
    if (!r) return [];
    return owners([
      [r.leadId, 'lead'],
      [r.createdBy, 'creator'],
    ]);
  },
  program: async (tx, id) => {
    const [r] = await tx
      .select({ ownerId: program.ownerId, createdBy: program.createdBy })
      .from(program)
      .where(eq(program.id, id))
      .limit(1);
    if (!r) return [];
    return owners([
      [r.ownerId, 'owner'],
      [r.createdBy, 'creator'],
    ]);
  },
  initiative: async (tx, id) => {
    const [r] = await tx
      .select({ ownerId: initiative.ownerId, createdBy: initiative.createdBy })
      .from(initiative)
      .where(eq(initiative.id, id))
      .limit(1);
    if (!r) return [];
    return owners([
      [r.ownerId, 'owner'],
      [r.createdBy, 'creator'],
    ]);
  },
  // An agent's run belongs to the human who started it: the owning user for a personal
  // Athena run (which has no workspace and no Actor), the initiating Actor for a registered
  // agent working inside an org. Both are returned; the merge keeps the strongest reason.
  agent_session: async (tx, id) => {
    const [r] = await tx
      .select({ ownerUserId: agentSession.ownerUserId, initiatorId: agentSession.initiatorId })
      .from(agentSession)
      .where(eq(agentSession.id, id))
      .limit(1);
    if (!r) return [];
    return [
      ...(r.ownerUserId ? [{ userId: r.ownerUserId, role: 'owner' as const }] : []),
      ...(r.initiatorId ? [{ actorId: r.initiatorId, role: 'owner' as const }] : []),
    ];
  },
};

/** Build owner candidates from (actorId, role) pairs, dropping nulls. */
function owners(pairs: readonly [string | null, OwnerCandidate['role']][]): OwnerCandidate[] {
  return pairs.flatMap(([actorId, role]) => (actorId ? [{ actorId, role }] : []));
}

/** The Docket entity id an owner rule should query, or null when the entity isn't a Docket one. */
function docketIdOf(entity: RoutableEntity): string | null {
  if (entity.source === 'docket') return entity.externalId;
  return entity.docketEntityId ?? null;
}

/**
 * Kinds that halt until a human acts — their owners are `awaiting_you`, not merely `owned`.
 *
 * @remarks
 * An unanswered question and a blocked agent are the only two states where somebody else's
 * work cannot continue without this person. Everything else (progress, completion, failure
 * the agent already handled) is information, and information does not outrank a halt.
 */
const HALTING_KINDS: ReadonlySet<EventKind> = new Set<EventKind>([
  'elicitation_requested',
  'agent_blocked',
]);

/** The relevance reason for an owner role, given the event kind. */
function reasonForOwner(role: OwnerCandidate['role'], kind: EventKind): StreamRelevance {
  if (HALTING_KINDS.has(kind)) return 'awaiting_you';
  if (role === 'assignee' && (kind === 'assignment' || kind === 'task_assignment'))
    return 'assignment';
  return 'owned';
}

/** The fallback reason for an external integration-owner recipient, from the event kind. */
function reasonForExternal(kind: EventKind): StreamRelevance {
  if (HALTING_KINDS.has(kind)) return 'awaiting_you';
  if (kind === 'mention') return 'mention';
  if (kind === 'assignment' || kind === 'task_assignment') return 'assignment';
  return 'owned';
}

/**
 * Record a reason for a key, keeping whichever reason ranks strongest.
 *
 * @param into - The map to record into.
 * @param key - The actor or user id.
 * @param reason - The reason this key is in the fan-out.
 */
function keepStrongest(
  into: Map<string, StreamRelevance>,
  key: string,
  reason: StreamRelevance,
): void {
  const existing = into.get(key);
  if (!existing || RELEVANCE_RANK[reason] < RELEVANCE_RANK[existing]) into.set(key, reason);
}

/** The owners and participants of one event, before Actor ids resolve to user ids. */
interface ActorReasons {
  /** Keyed by Actor id. */
  readonly byActor: Map<string, StreamRelevance>;
  /** Owners already resolved to a user id (agent sessions own by user, not by Actor). */
  readonly byOwnerUser: Map<string, StreamRelevance>;
}

/**
 * Collect the owners and participants an event concerns.
 *
 * @param tx - The active transaction.
 * @param event - The canonical event to route.
 * @returns The strongest reason per Actor, and per already-resolved owner user.
 */
async function collectActorReasons(tx: Tx, event: RoutableEvent): Promise<ActorReasons> {
  const reasons = await collectOwnerReasons(tx, event);

  // Participants (internal Actor ids) — mention when the event is a mention, else participant.
  const participantReason: StreamRelevance = event.kind === 'mention' ? 'mention' : 'participant';
  for (const actorId of event.participantActorIds ?? []) {
    if (actorId) keepStrongest(reasons.byActor, actorId, participantReason);
  }

  return reasons;
}

/**
 * Collect the owners of an event's entity, via the per-entity-kind Strategy.
 *
 * @remarks
 * Only when the entity is a Docket one — an external entity that has not been associated to a
 * Docket row has no owners to look up.
 *
 * @param tx - The active transaction.
 * @param event - The canonical event to route.
 * @returns The strongest reason per owning Actor, and per owner already known by user id.
 */
async function collectOwnerReasons(tx: Tx, event: RoutableEvent): Promise<ActorReasons> {
  const byActor = new Map<string, StreamRelevance>();
  const byOwnerUser = new Map<string, StreamRelevance>();
  if (!event.entity) return { byActor, byOwnerUser };

  const docketId = docketIdOf(event.entity);
  const rule = OWNER_RULES[event.entity.kind];
  if (!docketId || !rule) return { byActor, byOwnerUser };

  for (const owner of await rule(tx, docketId)) {
    const reason = reasonForOwner(owner.role, event.kind);
    if (owner.actorId) keepStrongest(byActor, owner.actorId, reason);
    if (owner.userId) keepStrongest(byOwnerUser, owner.userId, reason);
  }
  return { byActor, byOwnerUser };
}

/**
 * Resolve the Actor ids this event touches to Better Auth user ids.
 *
 * @param tx - The active transaction.
 * @param event - The canonical event to route.
 * @param byActor - The reasons collected per Actor.
 * @returns The lookup, and the acting user to exclude from the fan-out.
 */
async function resolveActorUsers(
  tx: Tx,
  event: RoutableEvent,
  byActor: ReadonlyMap<string, StreamRelevance>,
): Promise<{ userByActor: ReadonlyMap<string, string | null>; actingUserId: string | null }> {
  const actorIds = [...byActor.keys()];
  if (event.actorId) actorIds.push(event.actorId);
  const actorRows = actorIds.length
    ? await tx
        .select({ id: actor.id, userId: actor.userId })
        .from(actor)
        .where(inArray(actor.id, actorIds))
    : [];
  const userByActor = new Map(actorRows.map((a) => [a.id, a.userId]));
  return {
    userByActor,
    actingUserId: event.actorId ? (userByActor.get(event.actorId) ?? null) : null,
  };
}

/**
 * The users explicitly following this event's canonical entity, unmuted.
 *
 * @param tx - The active transaction.
 * @param entity - The event's entity, when it has one.
 * @returns The follower user ids.
 */
async function followerUserIds(
  tx: Tx,
  entity: RoutableEvent['entity'],
): Promise<readonly string[]> {
  if (!entity) return [];
  const followers = await tx
    .select({ userId: streamSubscription.userId })
    .from(streamSubscription)
    .where(
      and(
        eq(streamSubscription.entityKind, entity.kind),
        eq(streamSubscription.source, entity.source),
        eq(streamSubscription.externalId, entity.externalId),
        eq(streamSubscription.muted, false),
      ),
    );
  return followers.map((f) => f.userId);
}

/**
 * Resolve the users this event concerns (strongest reason each), uniformly for internal and
 * external events. Maps owning/participant Actor ids → Better Auth user ids and excludes the
 * acting user (you don't surface your own action to yourself).
 *
 * @param tx - The active transaction.
 * @param event - The canonical event to route.
 * @returns a map of `userId → reason`.
 */
export async function resolveRecipients(
  tx: Tx,
  event: RoutableEvent,
): Promise<Map<string, StreamRelevance>> {
  // Personal kinds (tracking) never fan out: a timer transition is the acting person's own
  // data, and its only audience is that person plus the assistant reading the live bus. The
  // event still carries its entity so the item's history reads correctly — it just does not
  // land in anyone else's feed, whatever they own or follow.
  if (PERSONAL_EVENT_KINDS.includes(event.kind)) {
    return new Map(event.directRecipients ?? []);
  }

  const { byActor, byOwnerUser } = await collectActorReasons(tx, event);
  const { userByActor, actingUserId } = await resolveActorUsers(tx, event, byActor);

  const byUser = new Map<string, StreamRelevance>();
  const addUser = (userId: string | null, reason: StreamRelevance): void => {
    if (!userId || userId === actingUserId) return; // skip self
    keepStrongest(byUser, userId, reason);
  };
  for (const [actorId, reason] of byActor) addUser(userByActor.get(actorId) ?? null, reason);
  for (const [userId, reason] of byOwnerUser) addUser(userId, reason);

  // External integration-owner fallback (already a user id; the drain supplies it).
  if (event.ownerUserId) addUser(event.ownerUserId, reasonForExternal(event.kind));

  // Pre-resolved external recipients (already user ids, each with its provider-derived reason).
  for (const [userId, reason] of event.externalRecipients ?? []) addUser(userId, reason);

  // Explicit followers of this canonical entity (unmuted) — resolved straight to user ids.
  for (const userId of await followerUserIds(tx, event.entity)) addUser(userId, 'followed');

  // Directly addressed recipients — merged last and exempt from the self-exclusion, because
  // the producer named them on purpose (see `RoutableEvent.directRecipients`).
  for (const [userId, reason] of event.directRecipients ?? [])
    keepStrongest(byUser, userId, reason);

  return byUser;
}

/**
 * Resolve recipients for an event and write its {@link eventRecipient} fan-out rows.
 *
 * @param tx - The active transaction (the event row must already be inserted).
 * @param eventId - The id of the inserted `event` row.
 * @param event - The canonical event to route.
 * @param occurredAt - The event's occurrence time (denormalized onto each recipient row).
 * @returns the resolved `userId → reason` map (for live fan-out by the caller).
 */
export async function routeAndWriteRecipients(
  tx: Tx,
  eventId: string,
  event: RoutableEvent,
  occurredAt: Date,
): Promise<Map<string, StreamRelevance>> {
  const recipients = await resolveRecipients(tx, event);
  if (recipients.size > 0) {
    await tx
      .insert(eventRecipient)
      .values(
        [...recipients].map(([userId, reason]) => ({
          eventId,
          userId,
          organizationId: event.organizationId,
          occurredAt,
          reason,
        })),
      )
      .onConflictDoNothing();
  }
  return recipients;
}
