/**
 * `@docket/api` — the observation drain: turns inbound events into observations + bridges.
 *
 * @remarks
 * The asynchronous half of ambient ingestion. {@link sweepInboundEvents} drains the
 * write-ahead inbox ({@link inboundEvent}) the same way {@link sweepConnectorSync} drives
 * connector syncs: a per-row lease (`status='processing'` + `processingStartedAt`)
 * serializes concurrent/retried sweeps, and every row ends `processed` or `failed` — never
 * silently dropped. For each event it resolves the provider {@link Observer}, normalizes
 * the payload into {@link observation} rows (deduped by `(organizationId, dedupeKey)`), and
 * runs the surfacing **bridges**: a `mention` or `assignment` observation becomes a Hub
 * {@link notification}. (A "suggested daily-plan item" was considered but `daily_plan_item`
 * requires a real Task; an observation isn't one, so both bridges surface as notifications.)
 *
 * Kept behind one function so a `/v1/cron/process-events` tick and any future Cloud Tasks
 * push share identical, idempotent behavior. `now` is always passed in (never module scope).
 */
import { actor, db, inboundEvent, integration, notification, observation } from '@docket/db';
import { selectAdapter } from '@docket/boundaries';
import type {
  BoundaryEnv,
  ConnectorProvider,
  Observer,
  ObservationDraft,
} from '@docket/boundaries';
import { ObservationKind } from '@docket/types';
import { and, eq, lt, or } from 'drizzle-orm';

import { toBoundaryEnv } from '../container';
import { asConnectorProvider } from './integration-provider';
import { LEASE_STALE_MS } from './integration-sync';

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
  /** Observations created this run. */
  readonly observations: number;
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
  readonly env: BoundaryEnv;
  readonly observers: Map<ConnectorProvider, Observer>;
  readonly owners: Map<string, string | null>;
}

/** Resolve (and cache for the sweep) the provider observer. */
function observerFor(ctx: SweepCtx, provider: ConnectorProvider): Observer {
  let observer = ctx.observers.get(provider);
  if (!observer) {
    observer = selectAdapter('observer', ctx.env, { observerProvider: provider });
    ctx.observers.set(provider, observer);
  }
  return observer;
}

/**
 * Resolve (and cache for the sweep) the Better Auth user that owns an integration — the digest
 * recipient. One join replaces the former two PK lookups; the cache collapses the many events
 * that share a workspace into a single query.
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

/** Surface a fresh observation into the Hub inbox when it's a mention/assignment about the user. */
async function runBridges(
  draft: ObservationDraft,
  orgId: string,
  userId: string | null,
): Promise<void> {
  if (!userId) return;
  if (draft.kind !== 'mention' && draft.kind !== 'assignment') return;
  await db.insert(notification).values({
    userId,
    organizationId: orgId,
    type: draft.kind,
    body: {
      title: draft.title,
      ...(draft.summary ? { summary: draft.summary } : {}),
      ...(draft.permalink ? { url: draft.permalink } : {}),
    },
  });
}

/** Normalize + persist one inbound event's observations; returns the count created. */
async function processOne(ev: InboundEventRow, ctx: SweepCtx): Promise<number> {
  const now = ctx.now;
  const provider = asConnectorProvider(ev.provider);
  const orgId = ev.organizationId;
  // Unrouted (no matching integration) or unsupported provider: acknowledge without observations.
  if (!provider || !orgId) {
    await db
      .update(inboundEvent)
      .set({ status: 'skipped', processedAt: now })
      .where(eq(inboundEvent.id, ev.id));
    return 0;
  }

  const drafts = observerFor(ctx, provider).normalize({
    eventType: ev.eventType,
    payload: ev.payload,
    receivedAt: ev.receivedAt.toISOString(),
  });

  const userId = ev.integrationId ? await ownerUserId(ctx, ev.integrationId) : null;

  let created = 0;
  for (const draft of drafts) {
    const kind = ObservationKind.safeParse(draft.kind);
    if (!kind.success) continue; // skip drafts whose kind isn't a known enum value
    const inserted = await db
      .insert(observation)
      .values({
        organizationId: orgId,
        userId,
        integrationId: ev.integrationId,
        provider: ev.provider,
        kind: kind.data,
        occurredAt: new Date(draft.occurredAt),
        title: draft.title,
        summary: draft.summary ?? null,
        permalink: draft.permalink ?? null,
        externalActor: draft.externalActor ?? null,
        subject: draft.subject ?? null,
        participants: draft.participants ? [...draft.participants] : [],
        payload: draft.payload ?? {},
        sourceEventId: ev.id,
        externalId: draft.externalId ?? null,
        dedupeKey: draft.dedupeKey,
      })
      .onConflictDoNothing({ target: [observation.organizationId, observation.dedupeKey] })
      .returning({ id: observation.id });
    if (inserted.length > 0) {
      created += 1;
      await runBridges(draft, orgId, userId);
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
 * it into observations, run surfacing bridges, and record the outcome. Idempotent + lease-guarded.
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
    env: toBoundaryEnv(),
    observers: new Map(),
    owners: new Map(),
  };

  let processed = 0;
  let observations = 0;
  let failed = 0;
  for (const ev of candidates) {
    if (!(await claimEvent(ev.id, now, staleBefore))) continue;
    try {
      observations += await processOne(ev, ctx);
      processed += 1;
    } catch (err) {
      failed += 1;
      const message = err instanceof Error ? err.message : 'observation processing error';
      await db
        .update(inboundEvent)
        .set({ status: 'failed', attempts: ev.attempts + 1, lastError: message })
        .where(eq(inboundEvent.id, ev.id));
    }
  }

  return { found: candidates.length, processed, observations, failed };
}
