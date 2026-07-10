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
import {
  ConnectorConfig,
  type SyncRunOut,
  type SyncRunPurpose,
  type SyncTrigger,
} from '@docket/types';
import type { ConnectorProvider } from '@docket/integrations';
import { MAIL_CAPABLE_PROVIDERS, type ImportedItem, isConnectorError } from '@docket/integrations';
import { and, eq, inArray, isNotNull, isNull, lt, notInArray, or } from 'drizzle-orm';
import type { z } from 'zod';

import {
  PROVIDER_DIRECTORY,
  asConnectorProvider,
  connectorFor,
  type IntegrationRow,
  resolveConnectorToken,
} from './integration-provider';
import { resolveImportTeam } from './integration-import';
import { reconcileTasks } from './integration-reconcile';
import { reconcileWorkGraph } from './integration-reconcile-graph';

/** The selected `sync_run` row shape. */
export type SyncRunRow = typeof syncRun.$inferSelect;

/**
 * A held lease is considered abandoned after this long (a process that crashed mid-run), so a
 * later run may reclaim it rather than the row getting stuck. Shared by the connector sync and
 * the observation drain so both lease windows stay in lockstep.
 */
export const LEASE_STALE_MS = 15 * 60 * 1000;

/**
 * A work-graph pull older than this always re-walks the full remote graph rather than an
 * incremental delta — bounding how stale an incremental-only mirror can silently become (a
 * long-running incremental chain would otherwise never re-verify entities the provider's delta
 * feed missed).
 */
const FULL_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * The overlap multiplier applied to an integration's cadence for the incremental pull's
 * `updatedAfter` cutoff (see {@link lookbackISO}) — widening the window beyond exactly one
 * cadence so an item that changed right at the edge of the previous sweep (a race between the
 * provider's write and our read) is never missed by the next one.
 */
const LOOKBACK_CADENCE_MULTIPLIER = 2;

/**
 * The external team ids a work-graph pull should be scoped to, derived from the integration's
 * `config`.
 *
 * @remarks
 * A lightweight extraction of the SAME precedence `buildTeamResolver` (T6a,
 * `integration-reconcile-graph.ts`) applies for routing — `teamMappings` (when non-empty) is
 * authoritative, else `listIds` — without duplicating its resolution logic (that module owns
 * external-team → Docket-team routing; this only narrows what the PULL itself fetches). Absent
 * config narrows to nothing configured, so the pull is unscoped (every team).
 */
function mappedExternalTeamIds(config: ConnectorConfig): readonly string[] {
  if (config.teamMappings && config.teamMappings.length > 0) {
    return config.teamMappings.map((m) => m.externalTeamId);
  }
  return config.listIds ?? [];
}

/**
 * The incremental work-graph pull's `updatedAfter` cutoff: `lastSyncedAt` minus a
 * {@link LOOKBACK_CADENCE_MULTIPLIER}x-cadence overlap window.
 *
 * @param lastSyncedAt - The integration's last successful sync (the caller has already proven
 *   this is non-null — a null `lastSyncedAt` is treated as a full sync, never passed here).
 * @param cadenceMinutes - The integration's background re-sync cadence; null/unset treated as 0
 *   (no overlap beyond `lastSyncedAt` itself).
 */
function lookbackISO(lastSyncedAt: Date, cadenceMinutes: number | null): string {
  const cadenceMs = (cadenceMinutes ?? 0) * 60_000;
  return new Date(lastSyncedAt.getTime() - LOOKBACK_CADENCE_MULTIPLIER * cadenceMs).toISOString();
}

/** Serialize a {@link SyncRunRow} to its {@link SyncRunOut} representation. */
export function toSyncRunOut(run: SyncRunRow): z.input<typeof SyncRunOut> {
  return {
    id: run.id,
    integrationId: run.integrationId,
    status: run.status,
    trigger: run.trigger,
    purpose: run.purpose,
    processed: run.processed,
    total: run.total,
    error: run.error,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
  };
}

/** Options for one sync run. */
export interface RunSyncOptions {
  /** The actor whose action is recorded on reconciled Docket work. */
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

/**
 * Finish a run as succeeded: stamp the run + promote the integration to a healthy state.
 *
 * @param opts.stampFullSync - When `true`, also advances `lastFullSyncedAt` to `now` (a
 *   work-graph full pull just completed) — omitted/`false` leaves it untouched, exactly as an
 *   incremental pull or the flat-import path (which has no full/incremental distinction) should.
 */
async function finishSuccess(
  run: SyncRunRow,
  row: IntegrationRow,
  processed: number,
  total: number,
  now: Date,
  opts?: { readonly stampFullSync?: boolean },
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
      ...(opts?.stampFullSync ? { lastFullSyncedAt: now } : {}),
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
      url: `/orgs/${row.organizationId}/settings/connections`,
    },
  });
}

/** What a {@link LeasedSyncExecutor} runs with: the claimed row, resolved token, and clock. */
export interface LeasedSyncContext {
  readonly row: IntegrationRow;
  readonly provider: ConnectorProvider;
  readonly token: string;
  readonly now: Date;
}

/**
 * One purpose's pull, run under the spine's lease with a resolved token.
 *
 * @remarks
 * Throwing is the failure channel: a thrown {@link import('@docket/integrations').ConnectorError}
 * with `kind: 'auth'` records the run as a reauth failure (status flip + owner notification);
 * anything else records a plain failure. Returning records success with the given tallies.
 */
export type LeasedSyncExecutor = (ctx: LeasedSyncContext) => Promise<{
  readonly processed: number;
  readonly total: number;
  /** Forwarded to {@link finishSuccess}'s `stampFullSync` — a work-graph full pull just completed. */
  readonly stampFullSync?: boolean;
}>;

/**
 * The shared leased-sync spine: claim the integration's lease, persist a purposed
 * {@link syncRun} row, resolve the provider + OAuth token, run the executor, and record the
 * outcome truthfully on both the run and the integration (including the needs-reauth owner
 * notification on a previously-healthy connection).
 *
 * @remarks
 * Both sync purposes run on this one spine — the task mirror ({@link runSync}) and the
 * email-to-task ingest — so leases, run history, honest status, and reauth surfacing are
 * implemented exactly once. See `docs/engineering/specs/integration-sync.md`.
 *
 * @param row - The integration to sync (its `status` is read to decide whether to notify).
 * @param opts - The acting Docket actor, the trigger, and the run's purpose. Provider credentials
 *   always come from `row.createdBy`, which owns the integration's bound external account.
 * @param execute - The purpose-specific pull.
 * @returns the finished {@link SyncRunRow}, or `null` if another run already holds the lease.
 */
export async function runLeasedSync(
  row: IntegrationRow,
  opts: RunSyncOptions & { readonly purpose: SyncRunPurpose },
  execute: LeasedSyncExecutor,
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
      purpose: opts.purpose,
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

  const tokenResult = await resolveConnectorToken(row.createdBy, provider, row.externalAccountId);
  if (!tokenResult.ok) {
    return finishFailure(run, row, tokenResult.message, { needsReauth: true, now });
  }

  try {
    const { processed, total, stampFullSync } = await execute({
      row,
      provider,
      token: tokenResult.token,
      now,
    });
    return await finishSuccess(run, row, processed, total, now, { stampFullSync });
  } catch (err) {
    const needsReauth = isConnectorError(err) && err.kind === 'auth';
    const message = err instanceof Error ? err.message : 'Connector error';
    return finishFailure(run, row, message, { needsReauth, now });
  }
}

/**
 * Run one connector task-mirror sync for an integration on the shared leased spine: pull
 * work, materialize it, and record the outcome.
 *
 * @param row - The integration to sync.
 * @param opts - The Docket actor to attribute reconciliation changes to and the trigger.
 * @returns the finished {@link SyncRunRow}, or `null` if another run already holds the lease.
 */
export async function runSync(
  row: IntegrationRow,
  opts: RunSyncOptions,
): Promise<SyncRunRow | null> {
  return runLeasedSync(row, { ...opts, purpose: 'task_sync' }, async ({ provider, token, now }) => {
    // Thrown here (no team resolvable) → the spine records a plain failure with the message.
    const teamId = await resolveImportTeam(row.organizationId, row);
    const config = ConnectorConfig.safeParse(row.config).data ?? {};
    const connector = connectorFor(provider, token);

    // Work-graph-capable connectors (Linear) branch onto the rich reconciler (T6a); every other
    // connector keeps the flat import + reconcile path below UNCHANGED.
    const graph = connector.asWorkGraph?.();
    if (graph) {
      const lastSyncedAt = row.lastSyncedAt;
      // Full vs incremental: no full sync yet, the last full sync is stale, or a manual trigger
      // (a user hitting "Sync now" always wants the complete, authoritative picture) all force a
      // full re-walk. A null `lastSyncedAt` is its own explicit branch (never a fallback
      // default) because it can only happen alongside a null `lastFullSyncedAt` anyway.
      const full =
        row.lastFullSyncedAt === null ||
        lastSyncedAt === null ||
        now.getTime() - row.lastFullSyncedAt.getTime() > FULL_SYNC_INTERVAL_MS ||
        opts.trigger === 'manual';

      // `!full` here PROVES `lastSyncedAt !== null` (it's one of `full`'s disjuncts above) —
      // TypeScript's aliased-condition narrowing carries that through, so `lastSyncedAt` is
      // already typed `Date` (not `Date | null`) in this branch; no redundant re-check needed.
      const snapshot = await graph.pullWorkGraph({
        externalTeamIds: mappedExternalTeamIds(config),
        ...(!full ? { updatedAfter: lookbackISO(lastSyncedAt, row.syncCadenceMinutes) } : {}),
      });
      const tally = await reconcileWorkGraph({
        orgId: row.organizationId,
        actorId: opts.actorId,
        row,
        snapshot,
        connector: graph,
        now,
      });
      // Honest processed/total, mirroring the flat path's semantics below: `total` is the pulled
      // WORK ITEMS (the graph's direct analogue of `items.length`), and `processed` is what
      // actually changed among them (created/pulled/tombstoned/pushed). Labels/projects/cycles
      // are supporting substrate materialized as a side effect of reconciling those items, not
      // "items" this run's progress is reported against — T6a's reconciler tallies them
      // separately (see `GET /:id/runs` for full per-kind detail if ever surfaced).
      const processed =
        tally.tasks.created + tally.tasks.updated + tally.tasks.removed + tally.tasks.pushed;
      return { processed, total: snapshot.items.length, stampFullSync: full };
    }

    const items: ImportedItem[] = await connector.importWork({
      connectionId: row.id,
      provider,
      ...(row.connection.externalWorkspaceId
        ? { externalWorkspaceId: row.connection.externalWorkspaceId }
        : {}),
      ...(config.listIds && config.listIds.length > 0 ? { listIds: config.listIds } : {}),
    });
    const tally = await reconcileTasks(row.organizationId, opts.actorId, row, teamId, items, {
      assigneeId: null,
      writable: connector.asWritable?.() ?? null,
    });
    const processed =
      tally.inserted + tally.pulled + tally.pushed + tally.deleted + tally.archived + tally.created;
    return { processed, total: items.length };
  });
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
        // Mail providers are ingested by the email-to-task sweep (purpose `email_ingest`),
        // not task-mirrored: a mailbox is not a task list, and double-pulling it here would
        // race the ingest sweep for the same lease.
        notInArray(integration.provider, [...MAIL_CAPABLE_PROVIDERS]),
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
