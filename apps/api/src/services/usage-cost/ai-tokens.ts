/**
 * `@docket/api` — the AI token meter.
 *
 * @remarks
 * Derived from `agent_session_run` rather than hooked into the run code, so metering cannot slow or
 * break a generation. A pass replaces the ledger rows for its window, which makes it safe to repeat
 * and lets a generation that finishes late land in the right day on the next pass.
 */
import { agentSession, agentSessionRun, db, usageDaily, type UsageResource } from '@docket/db';
import { and, gte, inArray, isNotNull, lt, sql } from 'drizzle-orm';

/** The ledger resources this meter owns. */
const AI_RESOURCES: readonly UsageResource[] = [
  'ai_input_tokens',
  'ai_output_tokens',
  'ai_cache_read_tokens',
  'ai_cache_write_tokens',
];

/** The window a pass recomputes, as UTC days; `to` is exclusive. */
export interface UsageWindow {
  /** First day, `YYYY-MM-DD`. */
  readonly from: string;
  /** Day after the last, `YYYY-MM-DD`. */
  readonly to: string;
}

/** A run's day: when it finished, else when it started. */
const RUN_AT = sql`coalesce(${agentSessionRun.completedAt}, ${agentSessionRun.startedAt})`;

/**
 * Recompute the AI token rows for a window of days.
 *
 * @remarks
 * Attribution follows the session: the owning person for Athena, and the workspace the session was
 * operating in (falling back to the registered agent's workspace). A registered-agent run has no
 * person. A run with no token counts adds to `unmeasured_events` on the input-token row and adds no
 * quantity, because its provider is not ours to ask.
 *
 * @param window - The days to replace.
 * @returns the number of ledger rows written.
 */
export async function rollupAiTokens(window: UsageWindow): Promise<number> {
  const groups = await db
    .select({
      day: sql<string>`to_char(${RUN_AT}, 'YYYY-MM-DD')`,
      userId: agentSession.ownerUserId,
      organizationId: sql<
        string | null
      >`coalesce(${agentSession.contextOrganizationId}, ${agentSession.organizationId})`,
      model: sql<string>`coalesce(${agentSessionRun.model}, '')`,
      // `bigint` sums arrive as strings from `postgres-js` and numbers from PGlite.
      input: sql<string | number>`coalesce(sum(${agentSessionRun.inputTokens}), 0)::bigint`,
      output: sql<string | number>`coalesce(sum(${agentSessionRun.outputTokens}), 0)::bigint`,
      cacheRead: sql<string | number>`coalesce(sum(${agentSessionRun.cacheReadTokens}), 0)::bigint`,
      cacheWrite: sql<
        string | number
      >`coalesce(sum(${agentSessionRun.cacheCreationTokens}), 0)::bigint`,
      unmeasured: sql<number>`count(*) filter (where ${agentSessionRun.inputTokens} is null)::int`,
    })
    .from(agentSessionRun)
    .innerJoin(agentSession, sql`${agentSession.id} = ${agentSessionRun.sessionId}`)
    .where(
      and(
        isNotNull(agentSessionRun.startedAt),
        gte(RUN_AT, sql`${window.from}::date`),
        lt(RUN_AT, sql`${window.to}::date`),
      ),
    )
    .groupBy(
      sql`to_char(${RUN_AT}, 'YYYY-MM-DD')`,
      agentSession.ownerUserId,
      sql`coalesce(${agentSession.contextOrganizationId}, ${agentSession.organizationId})`,
      sql`coalesce(${agentSessionRun.model}, '')`,
    );

  const rows: (typeof usageDaily.$inferInsert)[] = groups.flatMap((group) => {
    const base = {
      day: group.day,
      userId: group.userId,
      organizationId: group.organizationId,
      dimension: group.model,
    };
    const quantities: readonly [UsageResource, number, number][] = [
      ['ai_input_tokens', Number(group.input), group.unmeasured],
      ['ai_output_tokens', Number(group.output), 0],
      ['ai_cache_read_tokens', Number(group.cacheRead), 0],
      ['ai_cache_write_tokens', Number(group.cacheWrite), 0],
    ];
    return quantities
      .filter(([, quantity, unmeasured]) => quantity > 0 || unmeasured > 0)
      .map(([resource, quantity, unmeasuredEvents]) => ({
        ...base,
        resource,
        quantity,
        unmeasuredEvents,
      }));
  });

  await db.transaction(async (tx) => {
    await tx
      .delete(usageDaily)
      .where(
        and(
          inArray(usageDaily.resource, [...AI_RESOURCES]),
          gte(usageDaily.day, window.from),
          lt(usageDaily.day, window.to),
        ),
      );
    if (rows.length > 0) await tx.insert(usageDaily).values(rows);
  });
  return rows.length;
}
