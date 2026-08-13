/**
 * `@docket/api` — the single writer that turns canonical {@link EventDraft}s into `event` rows.
 *
 * @remarks
 * Extracted from the webhook drain so intake *shape* and event *persistence* are separate concerns.
 * A webhook arrives and is normalized by an {@link Observer}; a poll goes and asks. Both produce the
 * same `EventDraft[]`, and from here on they are indistinguishable — which is the whole reason a new
 * activity source can be an adapter rather than a second write path with its own subtly different
 * identity resolution, dedupe behaviour and fan-out.
 *
 * What one draft becomes, in order:
 * 1. its kind is validated against the enum (an unknown kind is skipped, never guessed at);
 * 2. its actor and participants resolve to Docket people where possible, and its subject to the
 *    Docket entity mirroring it — all read-only, so deliberately outside the write transaction;
 * 3. the row is inserted with `onConflictDoNothing` on `(organizationId, dedupeKey)`, which is what
 *    makes re-delivery *and* re-polling the same window free;
 * 4. in the same transaction, recipients are resolved through the one shared relevance Strategy;
 * 5. after it commits: search reindex, live publish, and automation rules.
 *
 * Subject association is resolved once for the whole batch rather than per draft — one query per
 * distinct entity kind. The per-reference shape it replaced ran a query per participant per event,
 * and keeping the batch signature here is what stops that returning the moment a second caller
 * appears.
 *
 * Deliberately does *not* absorb the internal emit path (`event-emit.ts`). That path resolves Docket
 * actors by id rather than by external reference, projects automations through a different shape,
 * and settles association at write time. Folding it in would change the internal and external write
 * paths in one commit — the precise hazard {@link toEntityRef}'s own remarks warn about.
 */
import { account, db, event } from '@docket/db';
import type { EventDraft } from '@docket/integrations';
import type {
  ActorRef,
  CanonicalEntityKind,
  EntityAssociation,
  EntityRef,
  SourceSystemKind,
  StreamRelevance,
} from '@docket/types';
import { EventKind, sourceIdentityProvider } from '@docket/types';
import { and, eq, inArray } from 'drizzle-orm';

import { routeAndWriteRecipients, type RoutableEntity } from '../consumers/routing';
import { projectInboundDraft } from '../lib/automation/event';
import { runAutomationsForEvent } from '../lib/automation/runtime';
import { resolveExternalActor } from '../lib/identity/resolve-external-actor';
import {
  externalEntityKey,
  isAssociableKind,
  resolveExternalEntities,
  type ResolvedEntities,
} from '../lib/identity/resolve-external-entity';
import { publishEvent } from '../routes/stream-helpers';
import { enqueueSearchIndexJobs } from '../search/enqueue';
import { eventSearchReindexTarget } from '../search/event-log';

/** The tenancy and provenance every draft in one batch shares. */
export interface DraftWriteContext {
  readonly organizationId: string;
  /**
   * The Hub owner this activity is "for" — what the cross-org daily read aggregates by.
   *
   * @remarks
   * Load-bearing rather than decorative: the daily narration selects on `event.userId`, so a row
   * written with `null` here is invisible to it however correct the rest of the row is.
   */
  readonly userId: string | null;
  /** The canonical source badge stamped on every row. */
  readonly sourceSystem: SourceSystemKind;
  /** The integration the activity came through, or `null` for a source Docket owns locally. */
  readonly integrationId: string | null;
  /** The `inbound_event` these drafts were normalized from, or `null` for a poll. */
  readonly sourceEventId: string | null;
}

/** What one batch produced. */
export interface DraftWriteTally {
  /** Canonical events created (duplicates are not counted). */
  readonly events: number;
  /**
   * Of those, how many resolved to a Docket entity.
   *
   * @remarks
   * `events - associated` is the backlog a re-association pass would retry, and a sudden collapse in
   * the ratio is the signal that a provider changed its ids or a mirror stopped syncing — neither of
   * which surfaces as an error anywhere else.
   */
  readonly associated: number;
  /** Recipient rows written — the direct measure of how much feed this batch produced. */
  readonly recipients: number;
}

/** The tally for a batch that produced nothing. */
export const EMPTY_DRAFT_TALLY: DraftWriteTally = { events: 0, associated: 0, recipients: 0 };

/**
 * Resolve an event's external participants (mentioned users, by their native id) to the Docket
 * users who have linked that identity — the mention-attribution seam.
 *
 * @param source - The event's canonical source system.
 * @param participants - The normalized participants (external actor refs) from the draft.
 * @param kind - The event kind, used to choose mention vs participant relevance.
 */
async function resolveLinkedIdentityRecipients(
  source: SourceSystemKind,
  participants: EventDraft['participants'],
  kind: EventKind,
): Promise<Map<string, StreamRelevance>> {
  const providerId = sourceIdentityProvider(source);
  const recipients = new Map<string, StreamRelevance>();
  if (!providerId || !participants || participants.length === 0) return recipients;
  const externalIds = participants.map((p) => p.externalId);
  const rows = await db
    .select({ userId: account.userId })
    .from(account)
    .where(and(eq(account.providerId, providerId), inArray(account.accountId, externalIds)));
  const reason: StreamRelevance = kind === 'mention' ? 'mention' : 'participant';
  for (const row of rows) recipients.set(row.userId, reason);
  return recipients;
}

/**
 * Lift a draft actor into a canonical {@link ActorRef} stamped with the resolved source,
 * enriching it with the Docket actor it maps to (if any) via {@link resolveExternalActor}.
 *
 * @remarks
 * Passes the draft's email through when the provider exposed one, which is what reaches the ad-hoc
 * email fallback — the only rung of {@link resolveExternalActor} that can match a person who has
 * neither linked their account nor been seen by a full sync. Providers that expose no email still
 * resolve through the manual-override, linked-account and email-matched-`external_actor` rungs.
 */
async function toActorRef(
  orgId: string,
  draftActor: EventDraft['actor'],
  source: SourceSystemKind,
): Promise<ActorRef | null> {
  if (!draftActor) return null;
  const resolved = await resolveExternalActor(orgId, {
    source,
    externalId: draftActor.externalId,
    ...(draftActor.email ? { email: draftActor.email } : {}),
  });
  return {
    source,
    externalId: draftActor.externalId,
    displayName: draftActor.displayName ?? null,
    avatarUrl: draftActor.avatarUrl ?? null,
    docketActorId: resolved.actorId as ActorRef['docketActorId'],
  };
}

/**
 * Lift a draft entity into a canonical {@link EntityRef} stamped with the resolved source.
 *
 * @remarks
 * `docketEntityId` stays null here even when association succeeded, and that is deliberate. Four
 * consumers read this jsonb field — owner fan-out, search reindex, activity-document visibility and
 * automation subject matching — so filling it in is indistinguishable from switching all four on in
 * one commit. The resolved id goes to the `event.docket_entity_id` column instead; each consumer is
 * repointed at it separately so a regression is attributable.
 */
function toEntityRef(
  draftEntity: EventDraft['entity'],
  source: SourceSystemKind,
): EntityRef | null {
  if (!draftEntity) return null;
  return {
    kind: draftEntity.kind,
    source,
    externalId: draftEntity.externalId,
    title: draftEntity.title ?? null,
    url: draftEntity.url ?? null,
    docketEntityId: null,
  };
}

/** One draft's association outcome — the state and, at `matched`, the id it resolved to. */
interface DraftAssociation {
  readonly state: EntityAssociation;
  readonly docketEntityId: string | null;
}

/**
 * Decide one draft's association from the batch-resolved lookup.
 *
 * @param draftEntity - The draft's subject, when it has one.
 * @param resolved - Docket ids resolved for this whole batch.
 * @returns the association state, and the Docket id when it matched.
 */
function associationFor(
  draftEntity: EventDraft['entity'],
  resolved: ResolvedEntities,
): DraftAssociation {
  // No subject at all: nothing to associate, and it must never enter the sweep's working set.
  if (!draftEntity) return { state: 'unmatched', docketEntityId: null };
  const docketEntityId = resolved.get(externalEntityKey(draftEntity.kind, draftEntity.externalId));
  if (docketEntityId) return { state: 'matched', docketEntityId };
  // `pending` only when a mirror could plausibly appear later; otherwise retrying is pure waste.
  return {
    state: isAssociableKind(draftEntity.kind) ? 'pending' : 'unmatched',
    docketEntityId: null,
  };
}

/**
 * Persist a batch of canonical event drafts, fan them out, and report what they produced.
 *
 * @remarks
 * Idempotent: a draft whose `dedupeKey` already exists in the organization is silently not
 * recreated, and contributes nothing to the tally. That is what lets a poll re-read the same window
 * as often as it likes without a cursor, a watermark, or a "have I seen this" table.
 *
 * @param drafts - The normalized drafts, from either an observer or an activity source.
 * @param ctx - The tenancy and provenance the whole batch shares.
 * @returns the events created, how many associated, and how many recipient rows were written.
 */
export async function writeEventDrafts(
  drafts: readonly EventDraft[],
  ctx: DraftWriteContext,
): Promise<DraftWriteTally> {
  if (drafts.length === 0) return EMPTY_DRAFT_TALLY;

  const { organizationId: orgId, userId, sourceSystem: source, integrationId } = ctx;

  // Associate every subject in this batch at once — one query per distinct entity kind, not one per
  // draft. Without an integration there is no tenancy to scope a mirror lookup by, so nothing
  // resolves and `associationFor` settles each draft on kind alone.
  const resolvedEntities: ResolvedEntities = integrationId
    ? await resolveExternalEntities(
        { organizationId: orgId, integrationId },
        drafts.flatMap((draft) => (draft.entity ? [draft.entity] : [])),
      )
    : new Map<string, string>();

  let created = 0;
  let associated = 0;
  let recipientsWritten = 0;
  for (const draft of drafts) {
    const kind = EventKind.safeParse(draft.kind);
    if (!kind.success) continue; // skip drafts whose kind isn't a known enum value
    const occurredAt = new Date(draft.occurredAt);
    const entityKind: CanonicalEntityKind | null = draft.entity?.kind ?? null;
    const entityRef = toEntityRef(draft.entity, source);
    const association = associationFor(draft.entity, resolvedEntities);
    // Resolve mentioned external users → linked Docket users, so the mention routes to whoever was
    // actually named (the integration-owner fallback below still applies for unlinked participants).
    const externalRecipients = await resolveLinkedIdentityRecipients(
      source,
      draft.participants,
      kind.data,
    );
    // Resolved outside the transaction (like externalRecipients above): read-only Docket-actor
    // lookups, not part of the event write's atomicity.
    const actorRef = await toActorRef(orgId, draft.actor, source);
    const participantRefs = (
      await Promise.all((draft.participants ?? []).map((p) => toActorRef(orgId, p, source)))
    ).filter((ref): ref is ActorRef => ref !== null);

    // Insert + fan-out in one transaction (the routing Strategy writes the recipient rows).
    const result = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(event)
        .values({
          organizationId: orgId,
          userId,
          sourceSystem: source,
          integrationId,
          externalUrl: draft.permalink ?? null,
          kind: kind.data,
          occurredAt,
          title: draft.title,
          summary: draft.summary ?? null,
          permalink: draft.permalink ?? null,
          actor: actorRef,
          entity: entityRef,
          entityKind,
          entityAssociation: association.state,
          docketEntityId: association.docketEntityId,
          participants: participantRefs,
          detail: draft.detail ?? null,
          sourceEventId: ctx.sourceEventId,
          externalId: draft.externalId ?? null,
          dedupeKey: draft.dedupeKey,
        })
        .onConflictDoNothing({ target: [event.organizationId, event.dedupeKey] })
        .returning({ id: event.id });

      if (!row) return null; // duplicate — already recorded

      // The resolved association is what lets `OWNER_RULES` run at all: they query a Docket row
      // by id, and until now every external event handed them null. An assignee, lead or creator
      // who was only ever told about Docket-side changes now hears about the upstream ones too.
      const routableEntity: RoutableEntity | null = entityRef
        ? {
            kind: entityRef.kind,
            source: entityRef.source,
            externalId: entityRef.externalId,
            docketEntityId: association.docketEntityId,
          }
        : null;
      const recipients = await routeAndWriteRecipients(
        tx,
        row.id,
        {
          organizationId: orgId,
          kind: kind.data,
          entity: routableEntity,
          ownerUserId: userId,
          externalRecipients,
        },
        occurredAt,
      );
      return { eventId: row.id, recipients };
    });

    if (result) {
      created += 1;
      if (association.state === 'matched') associated += 1;
      recipientsWritten += result.recipients.size;
      // Association resolved this event to a Docket entity, so the entity's search document is
      // now stale — external activity refreshing the thing it concerns is the first consumer to
      // act on the resolved id.
      const entityReindexTarget = eventSearchReindexTarget(entityKind, association.docketEntityId);
      await enqueueSearchIndexJobs([
        {
          organizationId: orgId,
          userId,
          sourceTable: 'event',
          entityId: result.eventId,
          operation: 'upsert',
          reason: 'event_log',
          sourceEventId: result.eventId,
        },
        ...(entityReindexTarget
          ? [
              {
                organizationId: orgId,
                sourceTable: entityReindexTarget.sourceTable,
                entityId: entityReindexTarget.entityId,
                operation: 'upsert' as const,
                reason: 'event_log' as const,
                sourceEventId: result.eventId,
              },
            ]
          : []),
      ]);
      const recipients = [...result.recipients].map(([uid, reason]) => ({ userId: uid, reason }));
      await publishEvent(result.eventId, recipients).catch(() => undefined);
      // Observer hook: external events trigger automation rules too. Never throws — an
      // automation failure must not fail the caller's row (it still transitions to processed).
      await runAutomationsForEvent(
        projectInboundDraft({
          organizationId: orgId,
          kind: kind.data,
          source,
          entityKind,
          // Rules can finally address the Docket entity an external event is about. This widens
          // the shipped "archive the email when its task is completed" rule to reach completions
          // that happened in Linear or GitHub: the task is a mirror of that issue, so closing it
          // upstream is closing it. See `docs/engineering/hub-architecture.md`, which traces
          // `Linear → event → task → attachment → Gmail` as the intended path.
          docketEntityId: association.docketEntityId,
          // The subject's own external id and permalink, which is what lets a rule route an
          // external item that resolved to no Docket entity at all into a task, and lets a
          // later event about the SAME item (a PR opened, then closed) find that task instead
          // of creating a second one. `draft.externalId` is the delivery's id; the entity ref
          // is the item's, so the entity wins when both are present.
          externalId: draft.entity?.externalId ?? draft.externalId ?? null,
          externalUrl: entityRef?.url ?? draft.permalink ?? null,
          title: draft.title,
          detail: draft.detail ?? null,
          occurredAt,
        }),
      );
    }
  }

  return { events: created, associated, recipients: recipientsWritten };
}
