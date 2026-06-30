/**
 * `@docket/api` — internal event emission (the `docket` source write-path), a Facade.
 *
 * @remarks
 * The cross-tool feed reads one substrate: the {@link event} log. External activity arrives via
 * the webhook drain; *internal* Docket domain events (a task assigned, a project's status
 * changed, a comment posted) are appended here with `sourceSystem='docket'`. This is a thin
 * Facade: it hides "insert the canonical event → resolve recipients → fan out live" behind one
 * {@link emitEvent} call. Relevance resolution + the {@link eventRecipient} fan-out are delegated
 * to the shared {@link routeAndWriteRecipients} Strategy (the same one the external drain uses).
 *
 * Awareness, not transactional truth: emission runs in its own transaction *after* the domain
 * mutation commits, so a failed emit never rolls back real work.
 */
import { actor, db, event } from '@docket/db';
import type { ActorRef, CanonicalEntityKind, EventDetail, EventKind } from '@docket/types';
import { eq } from 'drizzle-orm';

import { routeAndWriteRecipients } from '../consumers/routing';
import { publishEvent } from './stream-helpers';

/** The Docket entity an internal event is about. */
export interface EmitSubject {
  /** Docket entity type — `task` | `project` | `program` | `initiative` | `cycle`. */
  readonly type: string;
  /** The Docket entity id. */
  readonly id: string;
  /** Display title woven into the feed line. */
  readonly title?: string;
  /** Canonical in-app URL, when one exists. */
  readonly url?: string;
}

/** Input to {@link emitEvent}. */
export interface EmitEventInput {
  readonly organizationId: string;
  readonly kind: EventKind;
  /** When it happened; defaults to now. */
  readonly occurredAt?: Date;
  readonly title: string;
  readonly summary?: string | null;
  readonly permalink?: string | null;
  /** The acting Docket Actor (excluded from its own event's recipients). */
  readonly actorId?: string | null;
  readonly subject: EmitSubject;
  /** Extra Docket Actor ids involved (e.g. @-mentioned actors); resolved to recipients. */
  readonly participantActorIds?: readonly string[];
  /** Typed, tool-specific detail (e.g. a `docket.state_change`). */
  readonly detail?: EventDetail | null;
  /** The primary "for" user (sets `event.userId` for the digest). */
  readonly forUserId?: string | null;
}

/** Map a Docket entity type to its canonical entity kind. */
const DOCKET_ENTITY_KIND: Record<string, CanonicalEntityKind> = {
  task: 'work_item',
  project: 'project',
  program: 'program',
  initiative: 'initiative',
  cycle: 'cycle',
};

/**
 * Append one internal (`docket`-source) event and fan it out to its recipients.
 *
 * @remarks
 * Deduped by `(organizationId, dedupeKey)` so the same domain event emitted twice is a no-op.
 * Best-effort: runs in its own transaction AFTER the domain mutation commits and swallows
 * failures (a missing migration or transient error must never 500 the domain write).
 *
 * @param input - The event to record (see {@link EmitEventInput}).
 */
export async function emitEvent(input: EmitEventInput): Promise<void> {
  const occurredAt = input.occurredAt ?? new Date();
  const dedupeKey = `docket:${input.subject.type}:${input.subject.id}:${input.kind}:${occurredAt.getTime()}`;
  try {
    await emitInternal(input, occurredAt, dedupeKey);
  } catch {
    // Best-effort awareness — never roll back or 500 the domain mutation that triggered it.
  }
}

/** The actual emit work, separated so {@link emitEvent} can swallow its failures. */
async function emitInternal(
  input: EmitEventInput,
  occurredAt: Date,
  dedupeKey: string,
): Promise<void> {
  const entityKind = DOCKET_ENTITY_KIND[input.subject.type] ?? null;
  const result = await db.transaction(async (tx) => {
    const actorRef: ActorRef | null = input.actorId
      ? await tx
          .select({ id: actor.id, displayName: actor.displayName, avatar: actor.avatar })
          .from(actor)
          .where(eq(actor.id, input.actorId))
          .limit(1)
          .then(([a]) =>
            a
              ? {
                  source: 'docket' as const,
                  externalId: a.id,
                  displayName: a.displayName,
                  avatarUrl: a.avatar,
                  docketActorId: a.id as ActorRef['docketActorId'],
                }
              : null,
          )
      : null;

    const [row] = await tx
      .insert(event)
      .values({
        organizationId: input.organizationId,
        userId: input.forUserId ?? null,
        sourceSystem: 'docket',
        integrationId: null,
        externalUrl: input.subject.url ?? null,
        kind: input.kind,
        occurredAt,
        title: input.title,
        summary: input.summary ?? null,
        permalink: input.permalink ?? null,
        actor: actorRef,
        entity: entityKind
          ? {
              kind: entityKind,
              source: 'docket',
              externalId: input.subject.id,
              title: input.subject.title ?? null,
              url: input.subject.url ?? null,
              docketEntityId: input.subject.id,
            }
          : null,
        entityKind,
        participants: [],
        detail: input.detail ?? null,
        externalId: input.subject.id,
        dedupeKey,
      })
      .onConflictDoNothing({ target: [event.organizationId, event.dedupeKey] })
      .returning({ id: event.id });

    if (!row) return null; // duplicate — already recorded

    const recipients = await routeAndWriteRecipients(
      tx,
      row.id,
      {
        organizationId: input.organizationId,
        kind: input.kind,
        entity: entityKind
          ? {
              kind: entityKind,
              source: 'docket',
              externalId: input.subject.id,
              docketEntityId: input.subject.id,
            }
          : null,
        actorId: input.actorId,
        participantActorIds: input.participantActorIds,
      },
      occurredAt,
    );
    return { eventId: row.id, recipients };
  });

  if (result) {
    const recipients = [...result.recipients].map(([userId, reason]) => ({ userId, reason }));
    await publishEvent(result.eventId, recipients).catch(() => undefined);
  }
}
