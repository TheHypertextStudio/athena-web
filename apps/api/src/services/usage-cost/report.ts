/**
 * `@docket/api` — the operator cost reports, built from the ledger and the rate card.
 *
 * @remarks
 * Reads are separate from the meters that fill the ledger. A report never writes, and the lens it is
 * asked for changes only how rows are grouped.
 */
import {
  actor,
  db,
  organization,
  role,
  usageDaily,
  usageMeterRun,
  usageRate,
  user,
  USAGE_METERS,
} from '@docket/db';
import { and, eq, gte, inArray, isNotNull, isNull, lt } from 'drizzle-orm';

import type {
  AdminCostDetailOut,
  AdminCostHolder,
  AdminCostLine,
  AdminCostMeter,
  AdminCostsOut,
} from '../../admin-cost-dto';
import {
  attributeLedger,
  totalByHolder,
  UNATTRIBUTED_KEY,
  type AttributedRow,
  type CostLens,
  type HolderTotals,
  type LedgerRow,
} from './attribution';
import type { RateRow } from './rates';

/** A meter that has not completed in this long is reported stale. */
const STALE_AFTER_MS = 48 * 60 * 60 * 1000;

/** The UTC month of an instant, as `YYYY-MM`. */
export function monthOf(instant: Date): string {
  return instant.toISOString().slice(0, 7);
}

/** The first day of a month and of the month after it, as `YYYY-MM-DD`. */
function monthBounds(month: string): { readonly from: string; readonly to: string } {
  const [year, number] = month.split('-').map(Number) as [number, number];
  const next = new Date(Date.UTC(year, number, 1));
  return { from: `${month}-01`, to: next.toISOString().slice(0, 10) };
}

/** Every rate on the card. */
export async function loadRates(): Promise<RateRow[]> {
  const rows = await db.select().from(usageRate);
  return rows.map((row) => ({
    resource: row.resource,
    dimension: row.dimension,
    microsPerMillionUnits: row.microsPerMillionUnits,
    effectiveFrom: row.effectiveFrom,
  }));
}

/** Ledger rows, optionally limited to the days in `[from, to)`. */
async function loadLedger(range?: {
  readonly from: string;
  readonly to: string;
}): Promise<LedgerRow[]> {
  const rows = await db
    .select()
    .from(usageDaily)
    .where(range ? and(gte(usageDaily.day, range.from), lt(usageDaily.day, range.to)) : undefined);
  return rows.map((row) => ({
    day: row.day,
    userId: row.userId,
    organizationId: row.organizationId,
    resource: row.resource,
    dimension: row.dimension,
    quantity: row.quantity,
    unmeasuredEvents: row.unmeasuredEvents,
  }));
}

/** Each workspace's active human owners. */
async function loadOwners(organizationIds: readonly string[]): Promise<Map<string, string[]>> {
  const owners = new Map<string, string[]>();
  if (organizationIds.length === 0) return owners;
  const rows = await db
    .select({ organizationId: actor.organizationId, userId: actor.userId })
    .from(actor)
    .innerJoin(role, eq(role.id, actor.roleId))
    .where(
      and(
        inArray(actor.organizationId, [...organizationIds]),
        eq(role.key, 'owner'),
        eq(actor.kind, 'human'),
        eq(actor.status, 'active'),
        isNotNull(actor.userId),
        isNull(actor.archivedAt),
      ),
    );
  for (const row of rows) {
    if (!row.userId) continue;
    owners.set(row.organizationId, [...(owners.get(row.organizationId) ?? []), row.userId]);
  }
  return owners;
}

/** Name the people and workspaces behind a set of holder keys. */
async function describeHolders(
  totals: readonly HolderTotals[],
): Promise<Map<string, Pick<AdminCostHolder, 'kind' | 'name' | 'email'>>> {
  const described = new Map<string, Pick<AdminCostHolder, 'kind' | 'name' | 'email'>>();
  const userIds = totals.filter((t) => t.key.startsWith('user:')).map((t) => t.key.slice(5));
  const orgIds = totals.filter((t) => t.key.startsWith('workspace:')).map((t) => t.key.slice(10));
  if (userIds.length > 0) {
    const users = await db
      .select({ id: user.id, name: user.name, email: user.email })
      .from(user)
      .where(inArray(user.id, userIds));
    for (const row of users) {
      described.set(`user:${row.id}`, { kind: 'user', name: row.name, email: row.email });
    }
  }
  if (orgIds.length > 0) {
    const orgs = await db
      .select({ id: organization.id, name: organization.name })
      .from(organization)
      .where(inArray(organization.id, orgIds));
    for (const row of orgs) {
      described.set(`workspace:${row.id}`, { kind: 'workspace', name: row.name, email: null });
    }
  }
  described.set(UNATTRIBUTED_KEY, { kind: 'unattributed', name: null, email: null });
  return described;
}

/** Combine a holder's totals with its name. */
function toHolder(
  totals: HolderTotals,
  described: ReadonlyMap<string, Pick<AdminCostHolder, 'kind' | 'name' | 'email'>>,
): AdminCostHolder {
  const known = described.get(totals.key);
  return {
    key: totals.key,
    kind: known?.kind ?? (totals.key.startsWith('user:') ? 'user' : 'workspace'),
    name: known?.name ?? null,
    email: known?.email ?? null,
    costMicros: totals.costMicros,
    hasUnpriced: totals.hasUnpriced,
    unmeasuredEvents: totals.unmeasuredEvents,
    topResource: totals.topResource,
  };
}

/** How fresh each meter is. */
async function loadMeters(now: Date): Promise<AdminCostMeter[]> {
  const rows = await db.select().from(usageMeterRun);
  return USAGE_METERS.map((meter): AdminCostMeter => {
    const row = rows.find((candidate) => candidate.meter === meter);
    const last = row?.lastSuccessAt ?? null;
    return {
      meter,
      lastSuccessAt: last ? last.toISOString() : null,
      failed: row?.failed ?? false,
      stale: !last || now.getTime() - last.getTime() > STALE_AFTER_MS,
    };
  });
}

/** Attribute ledger rows under a lens, loading the owners they need. */
async function attribute(
  rows: readonly LedgerRow[],
  rates: readonly RateRow[],
  lens: CostLens,
): Promise<AttributedRow[]> {
  const orgIds = [
    ...new Set(rows.flatMap((row) => (row.organizationId ? [row.organizationId] : []))),
  ];
  return attributeLedger(rows, rates, await loadOwners(orgIds), lens);
}

/**
 * Rank everyone's cost for a month.
 *
 * @param month - UTC month, `YYYY-MM`.
 * @param lens - Who caused the cost, or who pays.
 * @param now - The instant used to judge meter freshness.
 * @returns the ranked report.
 */
export async function buildCostReport(
  month: string,
  lens: CostLens,
  now: Date = new Date(),
): Promise<AdminCostsOut> {
  const [rows, rates, meters] = await Promise.all([
    loadLedger(monthBounds(month)),
    loadRates(),
    loadMeters(now),
  ]);
  const totals = totalByHolder(await attribute(rows, rates, lens));
  const described = await describeHolders(totals);
  const holders = totals.map((entry) => toHolder(entry, described));
  return {
    month,
    lens,
    totalCostMicros: holders.reduce((sum, holder) => sum + holder.costMicros, 0),
    hasUnpriced: holders.some((holder) => holder.hasUnpriced),
    holders,
    meters,
  };
}

/** Sum a number into a map entry. */
function add<K>(map: Map<K, number>, key: K, amount: number): void {
  map.set(key, (map.get(key) ?? 0) + amount);
}

/**
 * One holder's month by resource, workspace and day, plus their lifetime cost.
 *
 * @param key - The holder key from the ranked report.
 * @param month - UTC month, `YYYY-MM`.
 * @param lens - Who caused the cost, or who pays.
 * @returns the detail, or `null` when the holder has no recorded usage.
 */
export async function buildCostDetail(
  key: string,
  month: string,
  lens: CostLens,
): Promise<AdminCostDetailOut | null> {
  const [everything, rates] = await Promise.all([loadLedger(), loadRates()]);
  const mine = (await attribute(everything, rates, lens)).filter((row) => row.key === key);
  if (mine.length === 0) return null;

  const { from, to } = monthBounds(month);
  const inMonth = mine.filter((row) => row.day >= from && row.day < to);

  const lines = new Map<string, AdminCostLine>();
  const byWorkspace = new Map<string | null, number>();
  const byDay = new Map<string, number>();
  for (const row of inMonth) {
    const lineKey = `${row.resource}\u0000${row.dimension}`;
    const line = lines.get(lineKey) ?? {
      resource: row.resource,
      dimension: row.dimension,
      quantity: 0,
      costMicros: null,
      unmeasuredEvents: 0,
    };
    lines.set(lineKey, {
      ...line,
      quantity: line.quantity + row.quantity,
      unmeasuredEvents: line.unmeasuredEvents + Math.round(row.unmeasuredEvents),
      costMicros:
        row.costMicros === null
          ? line.costMicros
          : (line.costMicros ?? 0) + Math.round(row.costMicros),
    });
    if (row.costMicros !== null) {
      add(byWorkspace, row.organizationId, row.costMicros);
      add(byDay, row.day, row.costMicros);
    }
  }

  const totals = totalByHolder(inMonth);
  const holderTotals = totals[0] ?? {
    key,
    costMicros: 0,
    hasUnpriced: false,
    unmeasuredEvents: 0,
    topResource: null,
  };
  const described = await describeHolders([holderTotals]);
  const workspaceIds = [...byWorkspace.keys()].filter((id): id is string => id !== null);
  const names =
    workspaceIds.length === 0
      ? []
      : await db
          .select({ id: organization.id, name: organization.name })
          .from(organization)
          .where(inArray(organization.id, workspaceIds));

  return {
    month,
    lens,
    holder: toHolder(holderTotals, described),
    lifetimeCostMicros: Math.round(mine.reduce((sum, row) => sum + (row.costMicros ?? 0), 0)),
    lines: [...lines.values()].sort((a, b) => (b.costMicros ?? 0) - (a.costMicros ?? 0)),
    workspaces: [...byWorkspace.entries()]
      .map(([organizationId, costMicros]) => ({
        organizationId,
        name: names.find((candidate) => candidate.id === organizationId)?.name ?? null,
        costMicros: Math.round(costMicros),
      }))
      .sort((a, b) => b.costMicros - a.costMicros),
    daily: [...byDay.entries()]
      .map(([day, costMicros]) => ({ day, costMicros: Math.round(costMicros) }))
      .sort((a, b) => a.day.localeCompare(b.day)),
  };
}
