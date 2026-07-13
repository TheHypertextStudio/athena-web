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
  /** Events that errored (recorded + attempts incremented). */
  readonly failed: number;
}

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

/** Lift a draft actor into a canonical {@link ActorRef} stamped with the resolved source. */
function toActorRef(draftActor: EventDraft['actor'], source: SourceSystemKind): ActorRef | null {
  if (!draftActor) return null;
  return {
    source,
    externalId: draftActor.externalId,
    displayName: draftActor.displayName ?? null,
    avatarUrl: draftActor.avatarUrl ?? null,
    docketActorId: null,
  };
}

/** Lift a draft entity into a canonical {@link EntityRef} stamped with the resolved source. */
function toEntityRef(
  draftEntity: EventDraft['entity'],
  source: SourceSystemKind,
): EntityRef | null {
  if (!draftEntity) return null;
  const maybeMapped = draftEntity as EventDraft['entity'] & { docketEntityId?: unknown };
  return {
    kind: draftEntity.kind,
    source,
    externalId: draftEntity.externalId,
    title: draftEntity.title ?? null,
    url: draftEntity.url ?? null,
    docketEntityId:
      typeof maybeMapped.docketEntityId === 'string' ? maybeMapped.docketEntityId : null,
  };
}

/** Normalize + persist one inbound event's canonical events; returns the count created. */
async function processOne(ev: InboundEventRow, ctx: SweepCtx): Promise<number> {
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
    return 0;
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

  let created = 0;
  for (const draft of drafts) {
    const kind = EventKind.safeParse(draft.kind);
    if (!kind.success) continue; // skip drafts whose kind isn't a known enum value
    const occurredAt = new Date(draft.occurredAt);
    const entityKind: CanonicalEntityKind | null = draft.entity?.kind ?? null;
    const entityRef = toEntityRef(draft.entity, source);
    // Resolve mentioned external users → linked Docket users, so the mention routes to whoever was
    // actually named (the integration-owner fallback below still applies for unlinked participants).
    const externalRecipients = await resolveLinkedIdentityRecipients(
      source,
      draft.participants,
      kind.data,
    );

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
          actor: toActorRef(draft.actor, source),
          entity: entityRef,
          entityKind,
          participants: (draft.participants ?? []).flatMap((p) => {
            const ref = toActorRef(p, source);
            return ref ? [ref] : [];
          }),
          detail: draft.detail ?? null,
          sourceEventId: ev.id,
          externalId: draft.externalId ?? null,
          dedupeKey: draft.dedupeKey,
        })
        .onConflictDoNothing({ target: [event.organizationId, event.dedupeKey] })
        .returning({ id: event.id });

      if (!row) return null; // duplicate — already recorded

      const routableEntity: RoutableEntity | null = entityRef
        ? {
            kind: entityRef.kind,
            source: entityRef.source,
            externalId: entityRef.externalId,
            docketEntityId: entityRef.docketEntityId,
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
      const entityReindexTarget = eventSearchReindexTarget(entityRef);
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
          docketEntityId: entityRef?.docketEntityId ?? null,
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
  return created;
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
  let failed = 0;
  for (const ev of candidates) {
    if (!(await claimEvent(ev.id, now, staleBefore))) continue;
    try {
      events += await processOne(ev, ctx);
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

  return { found: candidates.length, processed, events, failed };
}
