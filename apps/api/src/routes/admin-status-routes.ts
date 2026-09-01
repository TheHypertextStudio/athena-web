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
import { db, serviceProbe } from '@docket/db';
import { desc, gte, sql, type SQL } from 'drizzle-orm';
import { Hono } from 'hono';

import {
  AdminStatusOut,
  type AdminJobHealth,
  type AdminServiceStatus,
  type AdminUptimeWindow,
  ProbeReasonDto,
} from '../admin-dto';
import type { AppEnv } from '../context';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { readServiceControl } from '../services/service-controls';
import { PROBE_TARGETS, type ProbeTarget } from '../services/service-probes';
import { WORK_LEDGERS, instantOf, readLedgerWindow } from '../services/work-ledgers';

/** The windows the board reports uptime over, shortest first. */
const UPTIME_WINDOW_HOURS = [24, 24 * 7, 24 * 30] as const;

/** How far back the internal job ledgers are summarized. */
const JOB_WINDOW_HOURS = 24;

/** Hours back from now, as a date. */
function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

/**
 * An outcome that counts toward uptime.
 *
 * @remarks
 * `disabled` and `unknown` are excluded from both halves of the ratio. A service switched off on
 * purpose has not failed, and a dependency with no traffic has not been measured — counting either
 * as a failure invents an outage, and counting either as a success invents uptime.
 */
const MEASURABLE = sql`${serviceProbe.outcome} not in ('disabled', 'unknown')`;

/** One service's uptime counts, as Postgres aggregates them. */
interface UptimeRow {
  readonly serviceKey: string;
  readonly checks24h: number;
  readonly up24h: number;
  readonly checks7d: number;
  readonly up7d: number;
  readonly checks30d: number;
  readonly up30d: number;
  readonly lastSuccessAt: string | Date | null;
}

/** Count the measurable checks in one window, and how many of them reported `up`. */
function windowCounts(hours: number): { checks: SQL<number>; up: SQL<number> } {
  const inWindow = sql`${serviceProbe.checkedAt} >= ${hoursAgo(hours)} and ${MEASURABLE}`;
  return {
    checks: sql<number>`count(*) filter (where ${inWindow})::int`,
    up: sql<number>`count(*) filter (where ${inWindow} and ${serviceProbe.outcome} = 'up')::int`,
  };
}

/**
 * Read every service's uptime counts and last success.
 *
 * @remarks
 * Aggregated in Postgres. Folding this in JavaScript meant selecting the entire retention window —
 * around seventy thousand rows at the current cadence, growing without bound — to produce
 * twenty-four ratios, on a route the console polls every thirty seconds.
 *
 * @returns one row per service that has ever been probed.
 */
async function uptimeCounts(): Promise<UptimeRow[]> {
  const day = windowCounts(UPTIME_WINDOW_HOURS[0]);
  const week = windowCounts(UPTIME_WINDOW_HOURS[1]);
  const month = windowCounts(UPTIME_WINDOW_HOURS[2]);

  return db
    .select({
      serviceKey: serviceProbe.serviceKey,
      checks24h: day.checks,
      up24h: day.up,
      checks7d: week.checks,
      up7d: week.up,
      checks30d: month.checks,
      up30d: month.up,
      lastSuccessAt: sql<Date | null>`max(${serviceProbe.checkedAt}) filter (where ${serviceProbe.outcome} = 'up')`,
    })
    .from(serviceProbe)
    .where(gte(serviceProbe.checkedAt, hoursAgo(UPTIME_WINDOW_HOURS[2])))
    .groupBy(serviceProbe.serviceKey);
}

/** The most recent check for each service. */
interface LatestRow {
  readonly serviceKey: string;
  readonly outcome: AdminServiceStatus['outcome'];
  readonly reason: string | null;
  readonly latencyMs: number;
  readonly statusCode: number | null;
  readonly checkedAt: Date;
}

/**
 * Read the latest check for every service.
 *
 * @returns one row per service, newest first within each.
 */
async function latestProbes(): Promise<LatestRow[]> {
  return db
    .selectDistinctOn([serviceProbe.serviceKey], {
      serviceKey: serviceProbe.serviceKey,
      outcome: serviceProbe.outcome,
      reason: serviceProbe.reason,
      latencyMs: serviceProbe.latencyMs,
      statusCode: serviceProbe.statusCode,
      checkedAt: serviceProbe.checkedAt,
    })
    .from(serviceProbe)
    .where(gte(serviceProbe.checkedAt, hoursAgo(UPTIME_WINDOW_HOURS[2])))
    .orderBy(serviceProbe.serviceKey, desc(serviceProbe.checkedAt));
}

/** What a service that has never been probed reports. */
const NO_COUNTS: UptimeRow = {
  serviceKey: '',
  checks24h: 0,
  up24h: 0,
  checks7d: 0,
  up7d: 0,
  checks30d: 0,
  up30d: 0,
  lastSuccessAt: null,
};

/** Build one service's uptime windows from its aggregate row. */
function uptimeWindows(counts: UptimeRow | undefined): AdminUptimeWindow[] {
  const row = counts ?? NO_COUNTS;
  const pairs: readonly (readonly [number, number])[] = [
    [row.checks24h, row.up24h],
    [row.checks7d, row.up7d],
    [row.checks30d, row.up30d],
  ];

  return UPTIME_WINDOW_HOURS.map((windowHours, index) => {
    const [checks, successes] = pairs[index] ?? [0, 0];
    // A window holding no measurable check reports nothing rather than a zero or a one: "we do not
    // know" is a third answer, and rounding it to either of the others is the lie this exists to avoid.
    return { windowHours, checks, successes, uptime: checks === 0 ? null : successes / checks };
  });
}

/**
 * Fold one service's records into its board entry.
 *
 * @param target - The catalogue entry describing the service.
 * @param latest - Its most recent check, when it has one.
 * @param counts - Its uptime aggregates, when it has any.
 * @returns the service's current state and recent record.
 */
function serviceStatus(
  target: ProbeTarget,
  latest: LatestRow | undefined,
  counts: UptimeRow | undefined,
): AdminServiceStatus {
  return {
    key: target.key,
    label: target.label,
    kind: target.kind,
    method: target.method,
    ...latestCheck(latest),
    lastSuccessAt: instantOf(counts?.lastSuccessAt ?? null)?.toISOString() ?? null,
    uptime: uptimeWindows(counts),
  };
}

/** The part of a board entry that describes the most recent check. */
type LatestCheck = Pick<
  AdminServiceStatus,
  'outcome' | 'reason' | 'latencyMs' | 'statusCode' | 'checkedAt'
>;

/**
 * Describe a service's most recent check, or the absence of one.
 *
 * @remarks
 * A service that has never been checked reads as `unknown` rather than healthy, which is the whole
 * reason the board maps over the catalogue instead of over the rows it found.
 *
 * @param latest - The newest probe row, when there is one.
 * @returns the check fields of the board entry.
 */
function latestCheck(latest: LatestRow | undefined): LatestCheck {
  if (!latest) {
    return { outcome: 'unknown', reason: null, latencyMs: null, statusCode: null, checkedAt: null };
  }
  return {
    outcome: latest.outcome,
    reason: latest.reason === null ? null : ProbeReasonDto.parse(latest.reason),
    latencyMs: latest.latencyMs,
    statusCode: latest.statusCode,
    checkedAt: latest.checkedAt.toISOString(),
  };
}

/** Summarize one background-work ledger for the board. */
async function jobHealth(
  ledger: (typeof WORK_LEDGERS)[number],
  since: Date,
): Promise<AdminJobHealth> {
  const window = await readLedgerWindow(ledger, since);
  return {
    key: ledger.key,
    label: ledger.label,
    failures: window.failed,
    total: window.total,
    lastFailureAt: window.lastFailureAt?.toISOString() ?? null,
  };
}

/** Index rows by the service they belong to. */
function byService<T extends { readonly serviceKey: string }>(rows: readonly T[]): Map<string, T> {
  return new Map(rows.map((row) => [row.serviceKey, row]));
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
    const [latest, counts, probesEnabled, jobs] = await Promise.all([
      latestProbes(),
      uptimeCounts(),
      readServiceControl('service_probes'),
      Promise.all(WORK_LEDGERS.map((ledger) => jobHealth(ledger, jobSince))),
    ]);

    const latestByService = byService(latest);
    const countsByService = byService(counts);

    return ok(c, AdminStatusOut, {
      services: PROBE_TARGETS.map((target) =>
        serviceStatus(target, latestByService.get(target.key), countsByService.get(target.key)),
      ),
      jobs,
      probesEnabled,
      jobWindowHours: JOB_WINDOW_HOURS,
    });
  },
);
