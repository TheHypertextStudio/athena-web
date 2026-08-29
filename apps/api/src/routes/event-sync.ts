/**
 * `@docket/api` — the event drain: turns inbound provider webhooks into canonical events.
 *
 * @remarks
 * The asynchronous half of ambient ingestion. {@link sweepInboundEvents} drains the
 * write-ahead inbox ({@link inboundEvent}) the same way {@link sweepConnectorSync} drives
 * connector syncs: a per-row lease (`status='processing'` + `processingStartedAt`)
 * serializes concurrent/retried sweeps, and every row ends `processed`, `skipped`, or
 * `failed` — never silently dropped.
 *
 * This module owns only the *webhook* half of that: the lease, the provider {@link Observer}, the
 * Linear freshness side-trip, and the inbox row's own lifecycle. Turning the resulting drafts into
 * canonical rows — identity resolution, dedupe, recipient fan-out, search, live publish and
 * automations — belongs to {@link writeEventDrafts}, which a polled activity source calls with
 * exactly the same drafts. Webhook and poll are two ways of *acquiring* activity, not two ways of
 * recording it.
 *
 * Notifications are a deferred Phase-2 consumer: the old inline "mention/assignment → Hub
 * notification" bridge was removed. The personal feed (event_recipient) is the surface now.
 *
 * Kept behind one function so a `/v1/cron/process-events` tick and any future Cloud Tasks
 * push share identical, idempotent behavior. `now` is always passed in (never module scope).
 */
import { actor, db, inboundEvent, integration } from '@docket/db';
import type { Observer, ObserverProvider } from '@docket/integrations';
import { providerSourceSystem } from '@docket/types';
import { and, eq, lt, or } from 'drizzle-orm';

import { buildObserver, toAppRuntimeEnv, type AppRuntimeEnv } from '../container';
import { EMPTY_DRAFT_TALLY, writeEventDrafts, type DraftWriteTally } from '../events/write-drafts';
import { processExternalAgentInboxEvent } from '../lib/external-agent-processor';
import { asObserverProvider } from './integration-provider';
import { LEASE_STALE_MS, runSync } from './integration-sync';

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

/** Normalize + persist one inbound event's canonical events; returns what it produced. */
async function processOne(ev: InboundEventRow, ctx: SweepCtx): Promise<DraftWriteTally> {
  const now = ctx.now;
  if (
    ev.provider === 'linear_agent' ||
    ev.provider === 'slack_agent' ||
    ev.provider === 'github_agent' ||
    ev.provider === 'jira_a2a'
  ) {
    if (!ev.organizationId || !ev.integrationId) {
      await db
        .update(inboundEvent)
        .set({ status: 'skipped', processedAt: now })
        .where(eq(inboundEvent.id, ev.id));
      return EMPTY_DRAFT_TALLY;
    }
    await processExternalAgentInboxEvent(ev);
    await db
      .update(inboundEvent)
      .set({ status: 'processed', processedAt: now })
      .where(eq(inboundEvent.id, ev.id));
    return EMPTY_DRAFT_TALLY;
  }
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
    return EMPTY_DRAFT_TALLY;
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

  const tally = await writeEventDrafts(drafts, {
    organizationId: orgId,
    userId,
    sourceSystem: source,
    integrationId: ev.integrationId,
    sourceEventId: ev.id,
  });

  await db
    .update(inboundEvent)
    .set({ status: 'processed', processedAt: now })
    .where(eq(inboundEvent.id, ev.id));
  return tally;
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
