/**
 * `@docket/api` — the ledgers that already record whether background work succeeded.
 *
 * @remarks
 * Six tables in this codebase are the same shape: one row per attempt, carrying a status and a
 * timestamp. Nothing had ever read them as health, so a connector failing every sync for a day was
 * visible only to someone who went looking in the database.
 *
 * They are catalogued once, here, because two surfaces read them and would otherwise each carry
 * their own copy of "this table records this work, its status column is X, its time column is Y" —
 * a fact that has no business being written twice. The status board reports all six as background
 * work; the probe runner projects three of them into third-party health, since the record of what
 * a provider did with our real requests is a truer signal than a synthetic ping.
 */
import {
  agentSessionDispatch,
  agentSessionRun,
  billingProviderSync,
  db,
  objectCommandEffectJob,
  searchIndexJob,
  syncRun,
} from '@docket/db';
import { count, gte, sql, type AnyColumn, type SQL } from 'drizzle-orm';

/** One table that records attempts at some background work. */
export interface WorkLedger {
  /** Stable identifier for the ledger. */
  readonly key: string;
  /** What an operator calls the work it records. */
  readonly label: string;
  /** The column carrying each attempt's outcome. */
  readonly status: AnyColumn;
  /** The column carrying when the attempt happened. */
  readonly at: AnyColumn;
}

/** Every ledger, in the order an operator should read them. */
export const WORK_LEDGERS = [
  {
    key: 'connector_sync',
    label: 'Connector syncs',
    status: syncRun.status,
    at: syncRun.startedAt,
  },
  {
    key: 'agent_runs',
    label: 'Agent sessions',
    status: agentSessionRun.status,
    at: agentSessionRun.queuedAt,
  },
  {
    key: 'agent_dispatch',
    label: 'Agent dispatch',
    status: agentSessionDispatch.status,
    at: agentSessionDispatch.createdAt,
  },
  {
    key: 'search_index',
    label: 'Search indexing',
    status: searchIndexJob.status,
    at: searchIndexJob.createdAt,
  },
  {
    key: 'command_effects',
    label: 'Command effects',
    status: objectCommandEffectJob.status,
    at: objectCommandEffectJob.createdAt,
  },
  {
    key: 'billing_sync',
    label: 'Billing provider sync',
    status: billingProviderSync.status,
    at: billingProviderSync.updatedAt,
  },
] as const satisfies readonly WorkLedger[];

/** The status every one of these ledgers writes when an attempt fails. */
const FAILED = 'failed';

/**
 * Read a timestamp aggregate as a `Date`.
 *
 * @remarks
 * A raw `max(...)` carries no column decoder, so the driver hands back whatever it parsed the
 * expression as — a string under `postgres-js`. The ledger's timestamp column is `AnyColumn` here,
 * so Drizzle's `.mapWith` cannot narrow it either; converting once at the boundary is what keeps
 * the failure from surfacing as a `toISOString is not a function` at the far end of the request.
 *
 * @param value - The aggregate as the driver returned it.
 * @returns the instant, or `null` when the aggregate matched no rows.
 */
export function instantOf(value: string | Date | null): Date | null {
  if (value === null) return null;
  return value instanceof Date ? value : new Date(value);
}

/** What one ledger recorded inside a window. */
export interface LedgerWindow {
  /** Attempts recorded in the window. */
  readonly total: number;
  /** How many of them failed. */
  readonly failed: number;
  /** When the most recent failure was recorded, or `null` when there was none. */
  readonly lastFailureAt: Date | null;
}

/**
 * Read one ledger's window as three numbers.
 *
 * @remarks
 * Aggregated in Postgres rather than by fetching the rows and counting them in JavaScript. These
 * tables are the busiest in the schema — search indexing and command effects run continuously — so
 * fetching a day of them to produce three scalars transfers tens of thousands of rows per request,
 * on a board that polls every thirty seconds.
 *
 * @param ledger - The ledger to read.
 * @param since - The start of the window.
 * @returns what the ledger recorded.
 */
export async function readLedgerWindow(ledger: WorkLedger, since: Date): Promise<LedgerWindow> {
  const failed: SQL = sql`${ledger.status} = ${FAILED}`;
  const rows = await db
    .select({
      total: count(),
      failed: sql<number>`count(*) filter (where ${failed})::int`,
      lastFailureAt: sql<string | Date | null>`max(${ledger.at}) filter (where ${failed})`,
    })
    .from(ledger.status.table)
    .where(gte(ledger.at, since));

  const row = rows[0];
  return {
    total: row?.total ?? 0,
    failed: row?.failed ?? 0,
    lastFailureAt: instantOf(row?.lastFailureAt ?? null),
  };
}
