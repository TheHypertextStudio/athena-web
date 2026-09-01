/**
 * `@docket/api` — what Athena did and what it cost (mounted at `/athena-usage`).
 *
 * @remarks
 * Reads the token columns each generation records on `agent_session_run`, joined to its session for
 * the dimensions an operator groups by.
 *
 * Every figure is paired with how many generations were actually measured. A generation that ran on
 * a person's own Lattice runtime reports no counts — the compute is theirs and its provider is not
 * ours to ask — so a token total on its own cannot distinguish light use from work we simply cannot
 * see. Reporting the measured count beside it is what keeps the number honest.
 */
import { agentSession, agentSessionRun, db } from '@docket/db';
import { count, eq, gte, sql, type SQL } from 'drizzle-orm';
import { Hono } from 'hono';

import { AdminAthenaUsageOut, type AdminTokenTotals, type AdminUsageSlice } from '../admin-dto';
import type { AppEnv } from '../context';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';

/** How far back the report covers. */
const USAGE_WINDOW_HOURS = 24 * 30;

/** The token columns, summed. Coalesced so an all-unmeasured group reports zero rather than null. */
const TOKEN_SUMS = {
  inputTokens: sql<number>`coalesce(sum(${agentSessionRun.inputTokens}), 0)::int`,
  outputTokens: sql<number>`coalesce(sum(${agentSessionRun.outputTokens}), 0)::int`,
  cacheReadTokens: sql<number>`coalesce(sum(${agentSessionRun.cacheReadTokens}), 0)::int`,
  cacheCreationTokens: sql<number>`coalesce(sum(${agentSessionRun.cacheCreationTokens}), 0)::int`,
} as const;

/** How many rows in the group reported any token count at all. */
const MEASURED_RUNS = sql<number>`count(*) filter (where ${agentSessionRun.inputTokens} is not null)::int`;

/** A row as the grouped reads return it. */
interface SliceRow {
  readonly key: string | null;
  readonly runs: number;
  readonly measuredRuns: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheCreationTokens: number;
}

/** Pull the token fields out of a row. */
function tokensOf(row: Omit<SliceRow, 'key' | 'runs' | 'measuredRuns'>): AdminTokenTotals {
  return {
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cacheReadTokens: row.cacheReadTokens,
    cacheCreationTokens: row.cacheCreationTokens,
  };
}

/**
 * Group generations by one session dimension.
 *
 * @remarks
 * A run whose grouping value is null is reported under `unknown` rather than dropped: a generation
 * that ran is part of the total whether or not we can say which slice it belongs to, and silently
 * omitting it would make the slices disagree with the headline.
 *
 * @param column - The column to group by.
 * @param since - The start of the window.
 * @returns each value's run counts and token totals, busiest first.
 */
async function sliceBy(
  column: SQL | typeof agentSessionRun.model,
  since: Date,
): Promise<AdminUsageSlice[]> {
  const rows: SliceRow[] = await db
    .select({
      key: sql<string | null>`${column}`,
      runs: count(),
      measuredRuns: MEASURED_RUNS,
      ...TOKEN_SUMS,
    })
    .from(agentSessionRun)
    .leftJoin(agentSession, eq(agentSession.id, agentSessionRun.sessionId))
    .where(gte(agentSessionRun.queuedAt, since))
    .groupBy(sql`${column}`)
    .orderBy(sql`count(*) desc`);

  return rows.map((row) => ({
    key: row.key ?? 'unknown',
    runs: row.runs,
    measuredRuns: row.measuredRuns,
    tokens: tokensOf(row),
  }));
}

/**
 * Sub-router for Athena usage.
 *
 * @remarks
 * Mounted under `/admin`, so every route here already runs behind `staffMiddleware`.
 */
export const adminAthenaUsageRoutes = new Hono<AppEnv>().get(
  '/',
  apiDoc({
    tag: 'Admin',
    summary: 'Get Athena usage',
    response: AdminAthenaUsageOut,
    description: `Returns what Athena ran over the last ${String(USAGE_WINDOW_HOURS / 24)} days and what it consumed at the model provider.

**Tokens.** Input, output, cache-read, and cache-write counts are recorded per generation and summed here. Cache reads and writes are separate because they are priced differently.

**Measured versus total.** Every token figure is paired with \`measuredRuns\`. A generation executed on a person's own runtime reports no counts, so a token total alone cannot distinguish light use from work that is simply not visible to this deployment. Compare the two before drawing a conclusion from a small number.

**Grouping.** By model, by execution surface, and by session kind. A generation whose session row is missing a value is grouped under \`unknown\` rather than dropped, so the slices always sum to the headline.

**Access.** Behind \`staffMiddleware\` (any staff tier — a read). Non-operator → \`403\`; anonymous → \`401\`.

**Side effects.** None.`,
  }),
  async (c) => {
    const since = new Date(Date.now() - USAGE_WINDOW_HOURS * 60 * 60 * 1000);

    const [totals, byModel, bySurface, byKind] = await Promise.all([
      db
        .select({
          runs: count(),
          measuredRuns: MEASURED_RUNS,
          failedRuns: sql<number>`count(*) filter (where ${agentSessionRun.status} = 'failed')::int`,
          ...TOKEN_SUMS,
        })
        .from(agentSessionRun)
        .where(gte(agentSessionRun.queuedAt, since)),
      sliceBy(agentSessionRun.model, since),
      sliceBy(sql`${agentSession.executionSurface}`, since),
      sliceBy(sql`${agentSession.kind}`, since),
    ]);

    const headline = totals[0];

    return ok(c, AdminAthenaUsageOut, {
      windowHours: USAGE_WINDOW_HOURS,
      runs: headline?.runs ?? 0,
      failedRuns: headline?.failedRuns ?? 0,
      measuredRuns: headline?.measuredRuns ?? 0,
      tokens: headline
        ? tokensOf(headline)
        : { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
      byModel,
      bySurface,
      byKind,
    });
  },
);
