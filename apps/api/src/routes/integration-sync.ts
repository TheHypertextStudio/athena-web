/**
 * `@docket/api` — the connector sync engine shared by the manual and scheduled paths.
 *
 * @remarks
 * One code path runs a sync (`runSync`) so a manual "Sync now" and the background scheduler
 * behave identically and are both HONEST: every attempt is persisted as a {@link syncRun} row
 * AND reflected on the integration (`status` + `lastSync*`), a lease serializes concurrent
 * runs, and a failure that flips a previously-healthy connection into `error` notifies the
 * owner. Nothing about a run is ephemeral and no failure is swallowed — the spine of the
 * "never report success when nothing happened" invariant on the server side.
 */
import { actor, db, integration, notification, syncRun } from '@docket/db';
import type { SyncRunOut, SyncTrigger } from '@docket/types';
import { type ImportedItem, isConnectorError } from '@docket/boundaries';
import { and, eq, inArray, isNotNull, isNull, lt, or } from 'drizzle-orm';
import type { z } from 'zod';

import {
  PROVIDER_DIRECTORY,
  asConnectorProvider,
  connectorFor,
  type IntegrationRow,
  resolveConnectorToken,
} from './integration-provider';
import { importItems, resolveImportTeam } from './integration-import';

/** The selected `sync_run` row shape. */
export type SyncRunRow = typeof syncRun.$inferSelect;

/**
 * A held sync lease is considered abandoned after this long (a process that crashed
 * mid-sync), so a later run may reclaim it rather than the integration getting stuck.
 */
const LEASE_STALE_MS = 15 * 60 * 1000;

/** Serialize a {@link SyncRunRow} to its {@link SyncRunOut} representation. */
export function toSyncRunOut(run: SyncRunRow): z.input<typeof SyncRunOut> {
  return {
    id: run.id,
    integrationId: run.integrationId,
    status: run.status,
    trigger: run.trigger,
    processed: run.processed,
    total: run.total,
    error: run.error,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
  };
}

/** Options for one sync run. */
export interface RunSyncOptions {
  /** The actor whose provider grant funds the run (request actor, or the integration owner). */
  readonly actorId: string;
  /** Whether a user or the scheduler triggered it. */
  readonly trigger: SyncTrigger;
}

/**
 * Atomically claim the integration's sync lease.
 *
 * @returns `true` if this caller now holds the lease, `false` if another run holds a fresh one.
 */
async function claimLease(integrationId: string, now: Date): Promise<boolean> {
  const staleBefore = new Date(now.getTime() - LEASE_STALE_MS);
  const claimed = await db
    .update(integration)
    .set({ syncStartedAt: now })
    .where(
      and(
        eq(integration.id, integrationId),
        or(isNull(integration.syncStartedAt), lt(integration.syncStartedAt, staleBefore)),
      ),
    )
    .returning({ id: integration.id });
  return claimed.length > 0;
}

/** Finish a run as succeeded: stamp the run + promote the integration to a healthy state. */
async function finishSuccess(
  run: SyncRunRow,
  row: IntegrationRow,
  processed: number,
  total: number,
  now: Date,
): Promise<SyncRunRow> {
  await db
    .update(integration)
    .set({
      status: 'connected',
      lastSyncStatus: 'succeeded',
      lastSyncedAt: now,
      lastError: null,
      lastErrorAt: null,
      syncStartedAt: null,
    })
    .where(eq(integration.id, row.id));
  const [updated] = await db
    .update(syncRun)
    .set({ status: 'succeeded', processed, total, error: null, finishedAt: now })
    .where(eq(syncRun.id, run.id))
    .returning();
  return updated ?? run;
}

/**
 * Finish a run as failed: stamp the run, demote the integration to `error` with the reason,
 * and (only when the connection was previously healthy) notify the owner — so a connector
 * that breaks in the background is never silent, but a persistently-broken one doesn't spam.
 */
async function finishFailure(
  run: SyncRunRow,
  row: IntegrationRow,
  message: string,
  opts: { needsReauth: boolean; now: Date },
): Promise<SyncRunRow> {
  await db
    .update(integration)
    .set({
      status: 'error',
      lastSyncStatus: 'failed',
      lastError: message,
      lastErrorAt: opts.now,
      syncStartedAt: null,
    })
    .where(eq(integration.id, row.id));
  const [updated] = await db
    .update(syncRun)
    .set({ status: 'failed', error: message, finishedAt: opts.now })
    .where(eq(syncRun.id, run.id))
    .returning();
  if (row.status !== 'error') {
    await notifyOwner(row, opts.needsReauth, message);
  }
  return updated ?? run;
}

/** Create an inbox notification for the integration's owner about a connector failure. */
async function notifyOwner(
  row: IntegrationRow,
  needsReauth: boolean,
  message: string,
): Promise<void> {
  if (!row.createdBy) return;
  const owner = await db
    .select({ userId: actor.userId })
    .from(actor)
    .where(eq(actor.id, row.createdBy))
    .limit(1);
  const userId = owner[0]?.userId;
  if (!userId) return;

  const provider = asConnectorProvider(row.provider);
  const providerName = provider ? PROVIDER_DIRECTORY[provider].name : row.provider;
  await db.insert(notification).values({
    userId,
    organizationId: row.organizationId,
    type: needsReauth ? 'connector_needs_reauth' : 'connector_sync_failed',
    body: {
      title: needsReauth ? `Reconnect ${providerName}` : `${providerName} sync failed`,
      summary: needsReauth
        ? 'Your sign-in expired — reconnect to keep this integration syncing.'
        : message,
      url: `/orgs/${row.organizationId}/settings/integrations`,
    },
  });
}

/**
 * Run one connector sync for an integration: claim the lease, pull work, materialize it, and
 * record the outcome truthfully on both the run and the integration.
 *
 * @param row - The integration to sync (its `status` is read to decide whether to notify).
 * @param opts - The funding actor and the trigger.
 * @returns the finished {@link SyncRunRow}, or `null` if another run already holds the lease.
 */
export async function runSync(
  row: IntegrationRow,
  opts: RunSyncOptions,
): Promise<SyncRunRow | null> {
  const now = new Date();
  if (!(await claimLease(row.id, now))) return null;

  const [run] = await db
    .insert(syncRun)
    .values({
      organizationId: row.organizationId,
      integrationId: row.id,
      status: 'running',
      trigger: opts.trigger,
    })
    .returning();
  /* v8 ignore next -- @preserve defensive: insert always returns a row */
  if (!run) throw new Error('sync_run insert returned no row');

  const provider = asConnectorProvider(row.provider);
  if (!provider) {
    return finishFailure(run, row, 'Integration provider does not support sync', {
      needsReauth: false,
      now,
    });
  }

  const tokenResult = await resolveConnectorToken(opts.actorId, provider);
  if (!tokenResult.ok) {
    return finishFailure(run, row, tokenResult.message, { needsReauth: true, now });
  }

  let teamId: string;
  try {
    teamId = await resolveImportTeam(row.organizationId, row);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not resolve a team for import';
    return finishFailure(run, row, message, { needsReauth: false, now });
  }

  try {
    const items: ImportedItem[] = await connectorFor(provider, tokenResult.token).importWork({
      connectionId: row.id,
      provider,
      ...(row.connection.externalWorkspaceId
        ? { externalWorkspaceId: row.connection.externalWorkspaceId }
        : {}),
    });
    const created = await importItems(row.organizationId, opts.actorId, row.id, teamId, items, {
      assigneeId: null,
    });
    return await finishSuccess(run, row, created.length, items.length, now);
  } catch (err) {
    const needsReauth = isConnectorError(err) && err.kind === 'auth';
    const message = err instanceof Error ? err.message : 'Connector error';
    return finishFailure(run, row, message, { needsReauth, now });
  }
}

/** The number of due integrations one scheduler invocation will process. */
const SWEEP_BATCH_LIMIT = 50;

/** The result of one connector-sync sweep. */
export interface SweepResult {
  /** Integrations that were due and selected this run. */
  readonly due: number;
  /** Runs that completed (succeeded or failed). */
  readonly ran: number;
  /** Due integrations skipped because another run held the lease or had no resolvable owner. */
  readonly skipped: number;
}

/**
 * Run the background connector-sync sweep: find every mirror integration whose cadence is due
 * and sync it once, honestly recording each outcome.
 *
 * @remarks
 * Idempotent and safe to retry: the per-integration lease (see {@link runSync}) prevents a
 * concurrent or rapid re-invocation from double-syncing. `pending` (never validated) and
 * `disconnected` integrations are excluded; `error` ones ARE retried so a reconnect recovers
 * automatically. Processes at most {@link SWEEP_BATCH_LIMIT} per call, logging any remainder so
 * a backlog is never silently dropped.
 *
 * @param now - The sweep's reference time (read at request time, never module scope).
 */
export async function sweepConnectorSync(now: Date): Promise<SweepResult> {
  const candidates = await db
    .select()
    .from(integration)
    .where(
      and(
        eq(integration.syncMode, 'mirror'),
        isNotNull(integration.syncCadenceMinutes),
        inArray(integration.status, ['connected', 'error']),
      ),
    );

  const due = candidates.filter((row) => {
    const cadenceMs = (row.syncCadenceMinutes ?? 0) * 60_000;
    if (cadenceMs <= 0) return false;
    if (!row.lastSyncedAt) return true;
    return now.getTime() - row.lastSyncedAt.getTime() >= cadenceMs;
  });

  const batch = due.slice(0, SWEEP_BATCH_LIMIT);
  let ran = 0;
  let skipped = 0;
  for (const row of batch) {
    if (!row.createdBy) {
      skipped += 1;
      continue;
    }
    const result = await runSync(row, { actorId: row.createdBy, trigger: 'scheduled' });
    if (result) ran += 1;
    else skipped += 1;
  }

  if (due.length > batch.length) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        source: 'connector-sweep',
        event: 'batch_capped',
        due: due.length,
        processed: batch.length,
      }),
    );
  }

  return { due: due.length, ran, skipped };
}
