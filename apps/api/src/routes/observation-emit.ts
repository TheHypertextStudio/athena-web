/**
 * `@docket/api` — internal observation emission (the `provider='docket'` write-path).
 *
 * @remarks
 * The unified Stream reads one substrate: the {@link observation} timeline. External
 * activity arrives via the webhook drain ({@link sweepInboundEvents}); *internal* Docket
 * domain events (a task assigned, a project's status changed, a comment posted) are appended
 * here with `provider='docket'`. Mirrors the drain's insert + the `runBridges` fan-out, but
 * additionally writes {@link observationRecipient} rows — the "concerns me" index the
 * cross-org personal stream reads — resolved from the subject's owners/followers/participants.
 *
 * Awareness, not transactional truth: emission runs in its own transaction *after* the domain
 * mutation commits (like {@link writeAudit}), so a failed emit never rolls back real work.
 */
import {
  actor,
  db,
  initiative,
  observation,
  observationRecipient,
  program,
  project,
  streamSubscription,
  task,
} from '@docket/db';
import type { ObservationActor, ObservationKind, StreamRelevance } from '@docket/types';
import { and, eq, inArray } from 'drizzle-orm';

import { publishStreamEvent } from './stream-helpers';

/** The Docket entity an internal observation is about (addressed like an external subject). */
export interface EmitSubject {
  /** Subject kind — `task` | `project` | `program` | `initiative` | … (matches the stream catalog). */
  readonly type: string;
  /** The Docket entity id. */
  readonly id: string;
  /** Display title woven into the stream line. */
  readonly title?: string;
  /** Canonical in-app URL, when one exists. */
  readonly url?: string;
}

/** Input to {@link emitObservation}. */
export interface EmitObservationInput {
  readonly organizationId: string;
  readonly kind: ObservationKind;
  /** When it happened; defaults to now. */
  readonly occurredAt?: Date;
  readonly title: string;
  readonly summary?: string | null;
  readonly permalink?: string | null;
  /** The acting Docket Actor (excluded from its own event's recipients). */
  readonly actorId?: string | null;
  readonly subject: EmitSubject;
  /** Extra people involved (e.g. @-mentioned actors); resolved to recipients. */
  readonly participants?: readonly ObservationActor[];
  readonly payload?: Record<string, unknown>;
  /** The primary "for" user (sets `observation.userId` for the digest). */
  readonly forUserId?: string | null;
}

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

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Gather the owning Actors of a Docket subject (assignee/lead/owner/creator). */
async function ownerCandidates(tx: Tx, subject: EmitSubject): Promise<OwnerCandidate[]> {
  const out: OwnerCandidate[] = [];
  const push = (actorId: string | null, role: OwnerCandidate['role']): void => {
    if (actorId) out.push({ actorId, role });
  };
  switch (subject.type) {
    case 'task': {
      const [r] = await tx
        .select({ assigneeId: task.assigneeId, delegateId: task.delegateId, createdBy: task.createdBy })
        .from(task)
        .where(eq(task.id, subject.id))
        .limit(1);
      if (r) {
        push(r.assigneeId, 'assignee');
        push(r.delegateId, 'delegate');
        push(r.createdBy, 'creator');
      }
      break;
    }
    case 'project': {
      const [r] = await tx
        .select({ leadId: project.leadId, createdBy: project.createdBy })
        .from(project)
        .where(eq(project.id, subject.id))
        .limit(1);
      if (r) {
        push(r.leadId, 'lead');
        push(r.createdBy, 'creator');
      }
      break;
    }
    case 'program': {
      const [r] = await tx
        .select({ ownerId: program.ownerId, createdBy: program.createdBy })
        .from(program)
        .where(eq(program.id, subject.id))
        .limit(1);
      if (r) {
        push(r.ownerId, 'owner');
        push(r.createdBy, 'creator');
      }
      break;
    }
    case 'initiative': {
      const [r] = await tx
        .select({ ownerId: initiative.ownerId, createdBy: initiative.createdBy })
        .from(initiative)
        .where(eq(initiative.id, subject.id))
        .limit(1);
      if (r) {
        push(r.ownerId, 'owner');
        push(r.createdBy, 'creator');
      }
      break;
    }
    default:
      break;
  }
  return out;
}

/** The relevance reason for an owner role, given the event kind. */
function reasonFor(role: OwnerCandidate['role'], kind: ObservationKind): StreamRelevance {
  if (role === 'assignee' && (kind === 'assignment' || kind === 'task_assignment')) return 'assignment';
  return 'owned';
}

/**
 * Resolve the set of users this internal event concerns, with the strongest reason each.
 *
 * @remarks
 * Combines the subject's owners (assignee/lead/owner/creator), explicit followers
 * ({@link streamSubscription}, unmuted), and passed participants (`mention` when the event
 * is a mention, else `participant`). The acting actor is excluded — you don't surface your
 * own action back to yourself. Resolution maps Actor ids → Better Auth user ids.
 */
export async function resolveRecipients(
  tx: Tx,
  input: EmitObservationInput,
): Promise<Map<string, StreamRelevance>> {
  // (actorId → reason) before user resolution; mention/participant come in as actor ids too.
  const byActor = new Map<string, StreamRelevance>();
  const consider = (actorId: string | null | undefined, reason: StreamRelevance): void => {
    if (!actorId) return;
    const existing = byActor.get(actorId);
    if (!existing || RELEVANCE_RANK[reason] < RELEVANCE_RANK[existing]) byActor.set(actorId, reason);
  };

  for (const owner of await ownerCandidates(tx, input.subject)) {
    consider(owner.actorId, reasonFor(owner.role, input.kind));
  }
  const participantReason: StreamRelevance = input.kind === 'mention' ? 'mention' : 'participant';
  for (const p of input.participants ?? []) consider(p.externalId, participantReason);

  // Resolve owner/participant Actor ids → user ids (one query), plus the acting actor (to exclude).
  const actorIds = [...byActor.keys()];
  if (input.actorId) actorIds.push(input.actorId);
  const actorRows = actorIds.length
    ? await tx
        .select({ id: actor.id, userId: actor.userId })
        .from(actor)
        .where(inArray(actor.id, actorIds))
    : [];
  const userByActor = new Map(actorRows.map((a) => [a.id, a.userId]));
  const actingUserId = input.actorId ? (userByActor.get(input.actorId) ?? null) : null;

  const byUser = new Map<string, StreamRelevance>();
  const addUser = (userId: string | null, reason: StreamRelevance): void => {
    if (!userId || userId === actingUserId) return; // skip self
    const existing = byUser.get(userId);
    if (!existing || RELEVANCE_RANK[reason] < RELEVANCE_RANK[existing]) byUser.set(userId, reason);
  };
  for (const [actorId, reason] of byActor) addUser(userByActor.get(actorId) ?? null, reason);

  // Explicit followers of this subject (unmuted) — resolved straight to user ids.
  const followers = await tx
    .select({ userId: streamSubscription.userId })
    .from(streamSubscription)
    .where(
      and(
        eq(streamSubscription.subjectType, input.subject.type),
        eq(streamSubscription.subjectId, input.subject.id),
        eq(streamSubscription.muted, false),
      ),
    );
  for (const f of followers) addUser(f.userId, 'followed');

  return byUser;
}

/**
 * Append one internal (`provider='docket'`) observation and fan it out to its recipients.
 *
 * @remarks
 * Deduped by `(organizationId, dedupeKey)` so the same domain event emitted twice is a no-op.
 * Runs in its own transaction; call it AFTER the domain mutation commits.
 *
 * @param input - The event to record (see {@link EmitObservationInput}).
 */
export async function emitObservation(input: EmitObservationInput): Promise<void> {
  const occurredAt = input.occurredAt ?? new Date();
  const dedupeKey = `docket:${input.subject.type}:${input.subject.id}:${input.kind}:${occurredAt.getTime()}`;

  try {
    await emitInternal(input, occurredAt, dedupeKey);
  } catch {
    // Best-effort awareness: a failed emission (e.g. before its migration is applied) must
    // never roll back or 500 the domain mutation that triggered it.
  }
}

/** The actual emit work, separated so {@link emitObservation} can swallow its failures. */
async function emitInternal(
  input: EmitObservationInput,
  occurredAt: Date,
  dedupeKey: string,
): Promise<void> {
  const result = await db.transaction(async (tx) => {
    const externalActor: ObservationActor | null = input.actorId
      ? await tx
          .select({ id: actor.id, displayName: actor.displayName, avatar: actor.avatar })
          .from(actor)
          .where(eq(actor.id, input.actorId))
          .limit(1)
          .then(([a]) =>
            a
              ? {
                  externalId: a.id,
                  displayName: a.displayName,
                  ...(a.avatar ? { avatar: a.avatar } : {}),
                }
              : null,
          )
      : null;

    const [row] = await tx
      .insert(observation)
      .values({
        organizationId: input.organizationId,
        userId: input.forUserId ?? null,
        integrationId: null,
        provider: 'docket',
        kind: input.kind,
        occurredAt,
        title: input.title,
        summary: input.summary ?? null,
        permalink: input.permalink ?? null,
        externalActor,
        subject: {
          type: input.subject.type,
          externalId: input.subject.id,
          ...(input.subject.title ? { title: input.subject.title } : {}),
          ...(input.subject.url ? { url: input.subject.url } : {}),
        },
        participants: input.participants ? [...input.participants] : [],
        payload: input.payload ?? {},
        externalId: input.subject.id,
        dedupeKey,
      })
      .onConflictDoNothing({ target: [observation.organizationId, observation.dedupeKey] })
      .returning({ id: observation.id });

    if (!row) return null; // duplicate — already recorded

    const recipients = await resolveRecipients(tx, input);
    if (recipients.size > 0) {
      await tx
        .insert(observationRecipient)
        .values(
          [...recipients].map(([userId, reason]) => ({
            observationId: row.id,
            userId,
            organizationId: input.organizationId,
            occurredAt,
            reason,
          })),
        )
        .onConflictDoNothing();
    }
    return { observationId: row.id, recipients };
  });

  // Fan to live SSE connections after the write commits (best-effort; never fails the caller).
  if (result) {
    const recipients = [...result.recipients].map(([userId, reason]) => ({ userId, reason }));
    await publishStreamEvent(result.observationId, recipients).catch(() => undefined);
  }
}
