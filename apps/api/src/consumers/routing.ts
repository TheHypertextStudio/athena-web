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
 */
import {
  actor,
  eventRecipient,
  initiative,
  program,
  project,
  streamSubscription,
  task,
} from '@docket/db';
import type {
  CanonicalEntityKind,
  EventKind,
  SourceSystemKind,
  StreamRelevance,
} from '@docket/types';
import { and, eq, inArray } from 'drizzle-orm';

import type { db } from '@docket/db';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Relevance priority — a lower rank wins when a user qualifies for several reasons. */
const RELEVANCE_RANK: Record<StreamRelevance, number> = {
  mention: 0,
  assignment: 1,
  owned: 2,
  followed: 3,
  participant: 4,
};

/** A subject owner and the role that makes them relevant. */
interface OwnerCandidate {
  readonly actorId: string;
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
  readonly actorId?: string | null;
  /** Extra Docket Actor ids involved (e.g. @-mentions) → mention/participant recipients. */
  readonly participantActorIds?: readonly string[];
  /** External fallback: the integration owner to notify when there are no Docket owners. */
  readonly ownerUserId?: string | null;
  /**
   * Pre-resolved external recipients (already Better Auth user ids, each with its reason).
   *
   * @remarks
   * Provider-specific resolvers use this for both simple linked-identity participants (e.g.
   * Discord mentions mapped from snowflakes) and richer provider logic (e.g. Slack
   * mention/DM/thread classification). The router still owns strongest-reason-wins merging.
   */
  readonly externalRecipients?: ReadonlyMap<string, StreamRelevance>;
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

/** The relevance reason for an owner role, given the event kind. */
function reasonForOwner(role: OwnerCandidate['role'], kind: EventKind): StreamRelevance {
  if (role === 'assignee' && (kind === 'assignment' || kind === 'task_assignment'))
    return 'assignment';
  return 'owned';
}

/** The fallback reason for an external integration-owner recipient, from the event kind. */
function reasonForExternal(kind: EventKind): StreamRelevance {
  if (kind === 'mention') return 'mention';
  if (kind === 'assignment' || kind === 'task_assignment') return 'assignment';
  return 'owned';
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
  const byActor = new Map<string, StreamRelevance>();
  const consider = (actorId: string | null | undefined, reason: StreamRelevance): void => {
    if (!actorId) return;
    const existing = byActor.get(actorId);
    if (!existing || RELEVANCE_RANK[reason] < RELEVANCE_RANK[existing])
      byActor.set(actorId, reason);
  };

  // Owners — via the per-entity-kind Strategy, only when the entity is a Docket one.
  if (event.entity) {
    const docketId = docketIdOf(event.entity);
    const rule = OWNER_RULES[event.entity.kind];
    if (docketId && rule) {
      for (const owner of await rule(tx, docketId)) {
        consider(owner.actorId, reasonForOwner(owner.role, event.kind));
      }
    }
  }
  // Participants (internal Actor ids) — mention when the event is a mention, else participant.
  const participantReason: StreamRelevance = event.kind === 'mention' ? 'mention' : 'participant';
  for (const actorId of event.participantActorIds ?? []) consider(actorId, participantReason);

  // Resolve owner/participant Actor ids → user ids (one query) + the acting actor (to exclude).
  const actorIds = [...byActor.keys()];
  if (event.actorId) actorIds.push(event.actorId);
  const actorRows = actorIds.length
    ? await tx
        .select({ id: actor.id, userId: actor.userId })
        .from(actor)
        .where(inArray(actor.id, actorIds))
    : [];
  const userByActor = new Map(actorRows.map((a) => [a.id, a.userId]));
  const actingUserId = event.actorId ? (userByActor.get(event.actorId) ?? null) : null;

  const byUser = new Map<string, StreamRelevance>();
  const addUser = (userId: string | null, reason: StreamRelevance): void => {
    if (!userId || userId === actingUserId) return; // skip self
    const existing = byUser.get(userId);
    if (!existing || RELEVANCE_RANK[reason] < RELEVANCE_RANK[existing]) byUser.set(userId, reason);
  };
  for (const [actorId, reason] of byActor) addUser(userByActor.get(actorId) ?? null, reason);

  // External integration-owner fallback (already a user id; the drain supplies it).
  if (event.ownerUserId) addUser(event.ownerUserId, reasonForExternal(event.kind));

  // Pre-resolved external recipients (already user ids, each with its provider-derived reason).
  for (const [userId, reason] of event.externalRecipients ?? []) addUser(userId, reason);

  // Explicit followers of this canonical entity (unmuted) — resolved straight to user ids.
  if (event.entity) {
    const followers = await tx
      .select({ userId: streamSubscription.userId })
      .from(streamSubscription)
      .where(
        and(
          eq(streamSubscription.entityKind, event.entity.kind),
          eq(streamSubscription.source, event.entity.source),
          eq(streamSubscription.externalId, event.entity.externalId),
          eq(streamSubscription.muted, false),
        ),
      );
    for (const f of followers) addUser(f.userId, 'followed');
  }

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
