/**
 * `@docket/api` — who a ledger row's cost belongs to.
 *
 * @remarks
 * The ledger stores the person whose activity caused a row and the workspace it happened in. This
 * module answers the two questions an operator asks of it: who caused the cost, and who pays. It is
 * pure, so both lenses are testable without a database and the toggle never touches stored data.
 */
import type { UsageResource } from '@docket/db';

import { costMicros, resolveRate, type RateRow } from './rates';

/** Which question the report answers. */
export type CostLens = 'caused' | 'pays';

/** One ledger row as attribution reads it. */
export interface LedgerRow {
  /** UTC day, `YYYY-MM-DD`. */
  readonly day: string;
  /** The person whose activity caused the row, when recorded. */
  readonly userId: string | null;
  /** The workspace the row belongs to, when there is one. */
  readonly organizationId: string | null;
  /** The metered resource. */
  readonly resource: UsageResource;
  /** The model, table or store. */
  readonly dimension: string;
  /** Units consumed or held. */
  readonly quantity: number;
  /** Events in the row that could not be quantified. */
  readonly unmeasuredEvents: number;
}

/** A ledger row assigned to one account holder, with its price applied. */
export interface AttributedRow {
  /** Who the row is assigned to: `user:<id>`, `workspace:<id>` or `unattributed`. */
  readonly key: string;
  /** The workspace the row belongs to, when there is one. */
  readonly organizationId: string | null;
  /** UTC day. */
  readonly day: string;
  /** The metered resource. */
  readonly resource: UsageResource;
  /** The model, table or store. */
  readonly dimension: string;
  /** This account holder's share of the units. */
  readonly quantity: number;
  /** This account holder's share of the unmeasured events. */
  readonly unmeasuredEvents: number;
  /** Cost in millionths of a dollar, or `null` when no rate applied. */
  readonly costMicros: number | null;
}

/** The ledger resources whose owner pays directly, wherever the work happened. */
const PERSONALLY_OWNED: ReadonlySet<UsageResource> = new Set([
  'ai_input_tokens',
  'ai_output_tokens',
  'ai_cache_read_tokens',
  'ai_cache_write_tokens',
]);

/** The key for a person. */
export function userKey(userId: string): string {
  return `user:${userId}`;
}

/** The key for a workspace's cost that no person can be named for. */
export function workspaceKey(organizationId: string): string {
  return `workspace:${organizationId}`;
}

/** The key for cost with neither a person nor a workspace. */
export const UNATTRIBUTED_KEY = 'unattributed';

/** The person each lens assigns a row to, split equally when several share it. */
function holders(
  row: LedgerRow,
  lens: CostLens,
  owners: ReadonlyMap<string, readonly string[]>,
): readonly string[] {
  if (lens === 'caused') {
    if (row.userId) return [userKey(row.userId)];
    return [row.organizationId ? workspaceKey(row.organizationId) : UNATTRIBUTED_KEY];
  }
  if (row.userId && (PERSONALLY_OWNED.has(row.resource) || !row.organizationId)) {
    return [userKey(row.userId)];
  }
  if (row.organizationId) {
    const payers = owners.get(row.organizationId) ?? [];
    if (payers.length > 0) return payers.map(userKey);
    return [workspaceKey(row.organizationId)];
  }
  return [UNATTRIBUTED_KEY];
}

/**
 * Assign every ledger row to an account holder and price it.
 *
 * @remarks
 * Under `caused`, a row belongs to the person recorded on it, else to its workspace, else to
 * `unattributed`. Under `pays`, AI usage belongs to the person who owns it, and everything else
 * belongs to the workspace's owners, split equally. A workspace with no owner and a row with neither
 * person nor workspace stay visible under their own keys.
 *
 * @param rows - Ledger rows.
 * @param rates - The rate card.
 * @param owners - Each workspace's owners, by workspace id.
 * @param lens - Which question to answer.
 * @returns one row per account holder per ledger row.
 */
export function attributeLedger(
  rows: readonly LedgerRow[],
  rates: readonly RateRow[],
  owners: ReadonlyMap<string, readonly string[]>,
  lens: CostLens,
): AttributedRow[] {
  return rows.flatMap((row) => {
    const rate = resolveRate(rates, row.resource, row.dimension, row.day);
    const total = rate ? costMicros(row.quantity, rate.microsPerMillionUnits) : null;
    const shares = holders(row, lens, owners);
    return shares.map((key): AttributedRow => ({
      key,
      organizationId: row.organizationId,
      day: row.day,
      resource: row.resource,
      dimension: row.dimension,
      quantity: row.quantity / shares.length,
      unmeasuredEvents: row.unmeasuredEvents / shares.length,
      costMicros: total === null ? null : total / shares.length,
    }));
  });
}

/** One account holder's totals for a period. */
export interface HolderTotals {
  /** The account holder's key. */
  readonly key: string;
  /** Priced cost in millionths of a dollar. Unpriced quantity adds nothing here. */
  readonly costMicros: number;
  /** Whether any quantity had no rate, so {@link costMicros} is a floor. */
  readonly hasUnpriced: boolean;
  /** Events that could not be quantified. */
  readonly unmeasuredEvents: number;
  /** The resource with the largest priced cost, or `null` when nothing is priced. */
  readonly topResource: UsageResource | null;
}

/**
 * Total attributed rows per account holder, largest cost first.
 *
 * @param attributed - Output of {@link attributeLedger}.
 * @returns one entry per account holder.
 */
export function totalByHolder(attributed: readonly AttributedRow[]): HolderTotals[] {
  const byKey = new Map<
    string,
    { cost: number; unpriced: boolean; unmeasured: number; byResource: Map<UsageResource, number> }
  >();
  for (const row of attributed) {
    const entry = byKey.get(row.key) ?? {
      cost: 0,
      unpriced: false,
      unmeasured: 0,
      byResource: new Map<UsageResource, number>(),
    };
    entry.unmeasured += row.unmeasuredEvents;
    if (row.costMicros === null) {
      entry.unpriced ||= row.quantity > 0;
    } else {
      entry.cost += row.costMicros;
      entry.byResource.set(
        row.resource,
        (entry.byResource.get(row.resource) ?? 0) + row.costMicros,
      );
    }
    byKey.set(row.key, entry);
  }
  return [...byKey.entries()]
    .map(([key, entry]): HolderTotals => {
      const top = [...entry.byResource.entries()].sort((a, b) => b[1] - a[1])[0];
      return {
        key,
        costMicros: Math.round(entry.cost),
        hasUnpriced: entry.unpriced,
        unmeasuredEvents: Math.round(entry.unmeasured),
        topResource: top ? top[0] : null,
      };
    })
    .sort((a, b) => b.costMicros - a.costMicros || a.key.localeCompare(b.key));
}
