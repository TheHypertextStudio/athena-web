/**
 * `@docket/api` — the event drain: turns inbound provider webhooks into canonical events.
 *
 * @remarks
 * The asynchronous half of ambient ingestion. {@link sweepInboundEvents} drains the
 * write-ahead inbox ({@link inboundEvent}) the same way {@link sweepConnectorSync} drives
 * connector syncs: a per-row lease (`status='processing'` + `processingStartedAt`)
 * serializes concurrent/retried sweeps, and every row ends `processed`, `skipped`, or
 * `failed` — never silently dropped. For each event it resolves the provider {@link Observer},
 * normalizes the payload into canonical {@link event} rows (deduped by
 * `(organizationId, dedupeKey)`), and fans each out through the SINGLE shared relevance
 * resolver ({@link routeAndWriteRecipients}) — the same Strategy the internal emit path uses —
 * then publishes live via {@link publishEvent}.
 *
 * Notifications are a deferred Phase-2 consumer: the old inline "mention/assignment → Hub
 * notification" bridge was removed. The personal feed (event_recipient) is the surface now.
 *
 * Kept behind one function so a `/v1/cron/process-events` tick and any future Cloud Tasks
 * push share identical, idempotent behavior. `now` is always passed in (never module scope).
 */
import { account, actor, db, event, inboundEvent, integration } from '@docket/db';
import type { EventDraft, Observer, ObserverProvider } from '@docket/integrations';
import type {
  ActorRef,
  CanonicalEntityKind,
  EntityAssociation,
  EntityRef,
  SourceSystemKind,
  StreamRelevance,
} from '@docket/types';
import { EventKind, providerSourceSystem, sourceIdentityProvider } from '@docket/types';
import { and, eq, inArray, lt, or } from 'drizzle-orm';

import { routeAndWriteRecipients, type RoutableEntity } from '../consumers/routing';
import { buildObserver, toAppRuntimeEnv, type AppRuntimeEnv } from '../container';
import { projectInboundDraft } from '../lib/automation/event';
import { runAutomationsForEvent } from '../lib/automation/runtime';
import { resolveExternalActor } from '../lib/identity/resolve-external-actor';
import {
  externalEntityKey,
  isAssociableKind,
  resolveExternalEntities,
  type ResolvedEntities,
} from '../lib/identity/resolve-external-entity';
import { enqueueSearchIndexJobs } from '../search/enqueue';
import { eventSearchReindexTarget } from '../search/event-log';
import { asObserverProvider } from './integration-provider';
import { LEASE_STALE_MS, runSync } from './integration-sync';
import { publishEvent } from './stream-helpers';

/** The selected `inbound_event` row shape. */
type InboundEventRow = typeof inboundEvent.$inferSelect;

/** The number of inbound events one drain invocation will process. */
const SWEEP_BATCH_LIMIT = 100;

/** The result of one drain sweep. */
export interface DrainResult {
  /** Candidate events found (received or stale-processing). */
  readonly found: number;
  /** Events that completed processing this run. */
  readonly processed: number;
  /** Canonical events created this run. */
  readonly events: number;
  /**
   * Of those, how many resolved to a Docket entity.
   *
   * @remarks
   * The association rate. `events - associated` is the backlog the re-association sweep will
   * retry, and a sudden collapse in the ratio is the signal that a provider changed its ids or a
   * mirror stopped syncing — neither of which shows up as an error anywhere else.
   */
  readonly associated: number;
  /**
   * Recipient rows written this run — the direct measure of how much feed this drain produced.
   *
   * @remarks
   * Association makes owner rules reachable for external events, so this is the number that moves
   * when fan-out widens. Reported here rather than instrumented separately because the sweep is
   * the only writer and already returns its own tally.
   */
  readonly recipients: number;
  /** Events that errored (recorded + attempts incremented). */
  readonly failed: number;
}

/** What one inbound event produced, accumulated into {@link DrainResult}. */
interface ProcessedTally {
  readonly events: number;
  readonly associated: number;
  readonly recipients: number;
}

/** The tally for an event that produced nothing (unrouted, unsupported, or no drafts). */
const NO_OUTPUT: ProcessedTally = { events: 0, associated: 0, recipients: 0 };

/** Atomically claim one inbound event for processing. */
async function claimEvent(id: string, now: Date, staleBefore: Date): Promise<boolean> {
  const claimed = await db
    .update(inboundEvent)
    .set({ status: 'processing', processingStartedAt: now })
    .where(
      and(
        eq(inboundEvent.id, id),
        or(
          eq(inboundEvent.status, 'received'),
          and(
            eq(inboundEvent.status, 'processing'),
            lt(inboundEvent.processingStartedAt, staleBefore),
          ),
        ),
      ),
    )
    .returning({ id: inboundEvent.id });
  return claimed.length > 0;
}

/** Per-sweep caches so the observer adapter, boundary env, and owner lookups aren't rebuilt per event. */
interface SweepCtx {
  readonly now: Date;
  readonly env: AppRuntimeEnv;
  readonly observers: Map<ObserverProvider, Observer>;
  readonly owners: Map<string, string | null>;
}

/** Resolve (and cache for the sweep) the provider observer. */
function observerFor(ctx: SweepCtx, provider: ObserverProvider): Observer {
  let observer = ctx.observers.get(provider);
  if (!observer) {
    observer = buildObserver(provider, ctx.env);
    ctx.observers.set(provider, observer);
  }
  return observer;
}

/**
 * Resolve (and cache for the sweep) the Better Auth user that owns an integration — the
 * external-relevance fallback recipient. One join replaces the former two PK lookups; the
 * cache collapses the many events that share a workspace into a single query.
 */
async function ownerUserId(ctx: SweepCtx, integrationId: string): Promise<string | null> {
  const cached = ctx.owners.get(integrationId);
  if (cached !== undefined) return cached;
  const [row] = await db
    .select({ userId: actor.userId })
    .from(integration)
    .innerJoin(actor, eq(actor.id, integration.createdBy))
    .where(eq(integration.id, integrationId))
    .limit(1);
  const userId = row?.userId ?? null;
  ctx.owners.set(integrationId, userId);
  return userId;
}

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
 * one commit. The resolved id goes to the `event.docket_entity_id` column instead, which nothing
 * reads yet; each consumer is repointed at it separately so a regression is attributable.
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
 * @param resolved - Docket ids resolved for this whole delivery.
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

/** Normalize + persist one inbound event's canonical events; returns what it produced. */
async function processOne(ev: InboundEventRow, ctx: SweepCtx): Promise<ProcessedTally> {
  const now = ctx.now;
  const provider = asObserverProvider(ev.provider);
  const orgId = ev.organizationId;
  const source = provider ? providerSourceSystem(provider) : null;
  // Unrouted (no matching integration), unsupported provider, or a provider with no source-system
  // badge: acknowledge without events.
  if (!provider || !orgId || !source) {
    await db
      .update(inboundEvent)
      .set({ status: 'skipped', processedAt: now })
      .where(eq(inboundEvent.id, ev.id));
    return NO_OUTPUT;
  }

  // Linear Issue webhooks are both activity and a freshness signal. Reconcile through the same
  // leased work-graph sync used by manual/scheduled runs before projecting the activity event, so
  // a create/update/archive appears as a native Docket task during this drain. The run records its
  // own durable success/failure; a provider outage must not discard the already-verified webhook.
  if (provider === 'linear' && ev.eventType === 'Issue' && ev.integrationId) {
    const [connected] = await db
      .select()
      .from(integration)
      .where(
        and(
          eq(integration.id, ev.integrationId),
          eq(integration.organizationId, orgId),
          eq(integration.status, 'connected'),
        ),
      )
      .limit(1);
    if (connected?.createdBy) {
      await runSync(connected, { actorId: connected.createdBy, trigger: 'scheduled' });
    }
  }

  const drafts = observerFor(ctx, provider).normalize({
    eventType: ev.eventType,
    payload: ev.payload,
    receivedAt: ev.receivedAt.toISOString(),
  });

  const userId = ev.integrationId ? await ownerUserId(ctx, ev.integrationId) : null;

  // Associate every subject in this delivery at once — one query per distinct entity kind, not one
  // per draft. Without an integration there is no tenancy to scope a mirror lookup by, so nothing
  // resolves and `associationFor` settles each draft on kind alone.
  const resolvedEntities = ev.integrationId
    ? await resolveExternalEntities(
        { organizationId: orgId, integrationId: ev.integrationId },
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
          integrationId: ev.integrationId,
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
          sourceEventId: ev.id,
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
      // automation failure must not fail the drain row (it still transitions to processed).
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
          title: draft.title,
          detail: draft.detail ?? null,
          occurredAt,
        }),
      );
    }
  }

  await db
    .update(inboundEvent)
    .set({ status: 'processed', processedAt: now })
    .where(eq(inboundEvent.id, ev.id));
  return { events: created, associated, recipients: recipientsWritten };
}

/**
 * Drain the inbound-event inbox once: claim each received (or stale-processing) event, normalize
 * it into canonical events, fan them out to recipients, and record the outcome. Idempotent +
 * lease-guarded.
 *
 * @param now - The sweep's reference time (read at request time, never module scope).
 */
export async function sweepInboundEvents(now: Date): Promise<DrainResult> {
  const staleBefore = new Date(now.getTime() - LEASE_STALE_MS);
  const candidates = await db
    .select()
    .from(inboundEvent)
    .where(
      or(
        eq(inboundEvent.status, 'received'),
        and(
          eq(inboundEvent.status, 'processing'),
          lt(inboundEvent.processingStartedAt, staleBefore),
        ),
      ),
    )
    .limit(SWEEP_BATCH_LIMIT);

  const ctx: SweepCtx = {
    now,
    env: toAppRuntimeEnv(),
    observers: new Map(),
    owners: new Map(),
  };

  let processed = 0;
  let events = 0;
  let associated = 0;
  let recipients = 0;
  let failed = 0;
  for (const ev of candidates) {
    if (!(await claimEvent(ev.id, now, staleBefore))) continue;
    try {
      const tally = await processOne(ev, ctx);
      events += tally.events;
      associated += tally.associated;
      recipients += tally.recipients;
      processed += 1;
    } catch (err) {
      failed += 1;
      const message = err instanceof Error ? err.message : 'event processing error';
      await db
        .update(inboundEvent)
        .set({ status: 'failed', attempts: ev.attempts + 1, lastError: message })
        .where(eq(inboundEvent.id, ev.id));
    }
  }

  return { found: candidates.length, processed, events, associated, recipients, failed };
}
