/**
 * `@docket/api` — the service-status board for the operator back-office (mounted at `/status`).
 *
 * @remarks
 * Reads `service_probe`, the append-only record every scheduled check writes to. Uptime is computed
 * here rather than stored, so a window can be added without a migration and a backfilled probe row
 * is reflected immediately.
 *
 * Nothing in a response originates outside this codebase. Failure reasons are the probe runner's
 * closed vocabulary; provider text is never stored and so can never be served.
 */
import {
  agentSessionDispatch,
  agentSessionRun,
  billingProviderSync,
  db,
  objectCommandEffectJob,
  searchIndexJob,
  serviceProbe,
  syncRun,
} from '@docket/db';
import { desc, gte, sql } from 'drizzle-orm';
import { Hono } from 'hono';

import {
  AdminStatusOut,
  type AdminJobHealth,
  type AdminServiceStatus,
  type AdminUptimeWindow,
  ProbeOutcomeDto,
  ProbeReasonDto,
} from '../admin-dto';
import type { AppEnv } from '../context';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { readServiceControl } from '../services/service-controls';
import { probeTargets } from '../services/service-probes';

/** The windows the board reports uptime over, shortest first. */
const UPTIME_WINDOW_HOURS = [24, 24 * 7, 24 * 30] as const;

/** How far back the internal job ledgers are summarized. */
const JOB_WINDOW_HOURS = 24;

/** One probe row, narrowed to what the board needs. */
interface ProbeRow {
  readonly serviceKey: string;
  readonly outcome: string;
  readonly reason: string | null;
  readonly latencyMs: number;
  readonly statusCode: number | null;
  readonly checkedAt: Date;
}

/** Hours back from now, as a date. */
function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

/**
 * Compute one service's uptime over each reported window.
 *
 * @remarks
 * `disabled` and `unknown` checks are excluded from both halves of the ratio. A service switched off
 * on purpose has not failed, and a dependency with no traffic has not been measured — counting
 * either as a failure would invent an outage, and counting either as a success would invent uptime.
 *
 * A window with no measurable check reports `null` rather than `0` or `1`, because "we do not know"
 * is a third answer and rounding it to either of the others is the lie this whole feature exists to
 * avoid.
 *
 * @param rows - Every probe row for one service, newest first.
 * @returns the uptime for each window.
 */
function uptimeWindows(rows: readonly ProbeRow[]): AdminUptimeWindow[] {
  return UPTIME_WINDOW_HOURS.map((windowHours) => {
    const since = hoursAgo(windowHours);
    const measurable = rows.filter(
      (row) => row.checkedAt >= since && row.outcome !== 'disabled' && row.outcome !== 'unknown',
    );
    const successes = measurable.filter((row) => row.outcome === 'up').length;
    return {
      windowHours,
      checks: measurable.length,
      successes,
      uptime: measurable.length === 0 ? null : successes / measurable.length,
    };
  });
}

/**
 * Fold one service's probe history into its board entry.
 *
 * @param target - The catalogue entry describing the service.
 * @param rows - Its probe rows, newest first.
 * @returns the service's current state and recent record.
 */
function serviceStatus(
  target: ReturnType<typeof probeTargets>[number],
  rows: readonly ProbeRow[],
): AdminServiceStatus {
  const latest = rows[0];
  const lastSuccess = rows.find((row) => row.outcome === 'up');

  return {
    key: target.key,
    label: target.label,
    kind: target.kind,
    method: target.method,
    // A service that has never been checked reads as `unknown`, not as healthy.
    outcome: latest ? ProbeOutcomeDto.parse(latest.outcome) : 'unknown',
    reason: latest?.reason == null ? null : ProbeReasonDto.parse(latest.reason),
    latencyMs: latest?.latencyMs ?? null,
    statusCode: latest?.statusCode ?? null,
    checkedAt: latest?.checkedAt.toISOString() ?? null,
    lastSuccessAt: lastSuccess?.checkedAt.toISOString() ?? null,
    uptime: uptimeWindows(rows),
  };
}

/** One internal ledger, and how to read its recent failures. */
interface JobLedger {
  readonly key: string;
  readonly label: string;
  readonly read: (since: Date) => Promise<AdminJobHealth>;
}

/**
 * Summarize one ledger's recent runs.
 *
 * @param key - The ledger's identifier.
 * @param label - What an operator calls the work.
 * @param rows - Its rows in the window, each carrying a status and a timestamp.
 * @param failedWhen - Which status values count as a failure.
 * @returns the ledger's entry on the board.
 */
function summarize(
  key: string,
  label: string,
  rows: readonly { readonly status: string; readonly at: Date | null }[],
  failedWhen: readonly string[],
): AdminJobHealth {
  const failures = rows.filter((row) => failedWhen.includes(row.status));
  const lastFailure = failures
    .map((row) => row.at)
    .filter((at): at is Date => at !== null)
    .sort((a, b) => b.getTime() - a.getTime())[0];

  return {
    key,
    label,
    failures: failures.length,
    total: rows.length,
    lastFailureAt: lastFailure?.toISOString() ?? null,
  };
}

/** The ledgers that already record whether background work is succeeding. */
const JOB_LEDGERS: readonly JobLedger[] = [
  {
    key: 'connector_sync',
    label: 'Connector syncs',
    read: async (since) =>
      summarize(
        'connector_sync',
        'Connector syncs',
        (
          await db
            .select({ status: syncRun.status, at: syncRun.startedAt })
            .from(syncRun)
            .where(gte(syncRun.startedAt, since))
        ).map((row) => ({ status: row.status, at: row.at })),
        ['failed'],
      ),
  },
  {
    key: 'agent_runs',
    label: 'Agent sessions',
    read: async (since) =>
      summarize(
        'agent_runs',
        'Agent sessions',
        (
          await db
            .select({ status: agentSessionRun.status, at: agentSessionRun.queuedAt })
            .from(agentSessionRun)
            .where(gte(agentSessionRun.queuedAt, since))
        ).map((row) => ({ status: row.status, at: row.at })),
        ['failed'],
      ),
  },
  {
    key: 'agent_dispatch',
    label: 'Agent dispatch',
    read: async (since) =>
      summarize(
        'agent_dispatch',
        'Agent dispatch',
        (
          await db
            .select({ status: agentSessionDispatch.status, at: agentSessionDispatch.createdAt })
            .from(agentSessionDispatch)
            .where(gte(agentSessionDispatch.createdAt, since))
        ).map((row) => ({ status: row.status, at: row.at })),
        ['failed'],
      ),
  },
  {
    key: 'search_index',
    label: 'Search indexing',
    read: async (since) =>
      summarize(
        'search_index',
        'Search indexing',
        (
          await db
            .select({ status: searchIndexJob.status, at: searchIndexJob.createdAt })
            .from(searchIndexJob)
            .where(gte(searchIndexJob.createdAt, since))
        ).map((row) => ({ status: row.status, at: row.at })),
        ['failed'],
      ),
  },
  {
    key: 'command_effects',
    label: 'Command effects',
    read: async (since) =>
      summarize(
        'command_effects',
        'Command effects',
        (
          await db
            .select({ status: objectCommandEffectJob.status, at: objectCommandEffectJob.createdAt })
            .from(objectCommandEffectJob)
            .where(gte(objectCommandEffectJob.createdAt, since))
        ).map((row) => ({ status: row.status, at: row.at })),
        ['failed'],
      ),
  },
  {
    key: 'billing_sync',
    label: 'Billing provider sync',
    read: async (since) =>
      summarize(
        'billing_sync',
        'Billing provider sync',
        (
          await db
            .select({ status: billingProviderSync.status, at: billingProviderSync.updatedAt })
            .from(billingProviderSync)
            .where(gte(billingProviderSync.updatedAt, since))
        ).map((row) => ({ status: row.status, at: row.at })),
        ['failed'],
      ),
  },
];

/**
 * Read every probe row inside the longest reported window.
 *
 * @returns the rows, newest first.
 */
async function recentProbes(): Promise<ProbeRow[]> {
  const longest = UPTIME_WINDOW_HOURS[UPTIME_WINDOW_HOURS.length - 1] ?? 24;
  return db
    .select({
      serviceKey: serviceProbe.serviceKey,
      outcome: sql<string>`${serviceProbe.outcome}`,
      reason: serviceProbe.reason,
      latencyMs: serviceProbe.latencyMs,
      statusCode: serviceProbe.statusCode,
      checkedAt: serviceProbe.checkedAt,
    })
    .from(serviceProbe)
    .where(gte(serviceProbe.checkedAt, hoursAgo(longest)))
    .orderBy(desc(serviceProbe.checkedAt));
}

/**
 * Sub-router for the service-status board.
 *
 * @remarks
 * Mounted under `/admin`, so every route here already runs behind `staffMiddleware`.
 */
export const adminStatusRoutes = new Hono<AppEnv>().get(
  '/',
  apiDoc({
    tag: 'Admin',
    summary: 'Get service status',
    response: AdminStatusOut,
    description: `Returns the current health of every deployed service and dependency, with uptime and recent internal job failures.

**Services.** Each entry carries the latest check's outcome, how long it took, when it ran, and when the service last reported healthy. A service that has never been checked reads \`unknown\` rather than healthy.

**Uptime.** Successful checks over total checks, across 24 hours, 7 days, and 30 days. Checks recorded as \`disabled\` or \`unknown\` are excluded from both halves: a service switched off has not failed, and a dependency with no traffic has not been measured. A window holding no measurable check reports \`null\` rather than a zero or a one.

**Method.** \`http\` services answer a health endpoint, \`database\` is queried directly, and \`derived\` dependencies are read from the ledger of real traffic already sent to that provider — which detects a provider failing real requests, where a synthetic ping cannot.

**Jobs.** Failure counts over the last ${String(JOB_WINDOW_HOURS)} hours from the ledgers that already record background work: connector syncs, agent runs and dispatch, search indexing, command effects, and billing provider sync.

**Failure reasons.** A closed, application-owned set. Provider and exception text is never stored and never returned.

**Access.** Behind \`staffMiddleware\` (any staff tier — a read). Non-operator → \`403\`; anonymous → \`401\`.

**Side effects.** None.`,
  }),
  async (c) => {
    const jobSince = hoursAgo(JOB_WINDOW_HOURS);
    const [rows, probesEnabled, jobs] = await Promise.all([
      recentProbes(),
      readServiceControl('service_probes'),
      Promise.all(JOB_LEDGERS.map((ledger) => ledger.read(jobSince))),
    ]);

    const byService = new Map<string, ProbeRow[]>();
    for (const row of rows) {
      const existing = byService.get(row.serviceKey);
      if (existing) existing.push(row);
      else byService.set(row.serviceKey, [row]);
    }

    return ok(c, AdminStatusOut, {
      services: probeTargets().map((target) =>
        serviceStatus(target, byService.get(target.key) ?? []),
      ),
      jobs,
      probesEnabled,
      jobWindowHours: JOB_WINDOW_HOURS,
    });
  },
);
