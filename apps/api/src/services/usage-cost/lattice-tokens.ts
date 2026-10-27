/** Usage retained in durable own-hardware results, independent of subsequent human review. */
import { agentDelegation, db, type usageDaily } from '@docket/db';
import { and, gte, lt, sql } from 'drizzle-orm';
import { z } from 'zod';

import type { UsageWindow } from './ai-tokens';

type LedgerRow = typeof usageDaily.$inferInsert;
const Result = z.object({ model: z.string().optional(), usage: z.unknown().optional() });
const Usage = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
});
// Older receipts have no timestamp; their submission day is an explicit historical approximation.
const RESULT_AT = sql`coalesce(${agentDelegation.resultReceivedAt}, ${agentDelegation.submittedAt}, ${agentDelegation.createdAt})`;

/** Read completed Lattice results without mistaking a placeholder compute counter for token usage. */
export async function loadLatticeTokenRows(window: UsageWindow): Promise<LedgerRow[]> {
  const results = await db
    .select({
      day: sql<string>`to_char(${RESULT_AT} at time zone 'UTC', 'YYYY-MM-DD')`,
      userId: agentDelegation.ownerUserId,
      organizationId: agentDelegation.organizationId,
      outcome: agentDelegation.terminalOutcome,
    })
    .from(agentDelegation)
    .where(
      and(
        gte(RESULT_AT, sql`${window.from}::date`),
        lt(RESULT_AT, sql`${window.to}::date`),
        sql`${agentDelegation.terminalOutcome} is not null`,
      ),
    );
  return results.flatMap((row) => {
    const result = Result.safeParse(row.outcome?.payload);
    const usage = Usage.safeParse(result.success ? result.data.usage : undefined);
    if (!usage.success && row.outcome?.outcome !== 'completed') return [];
    const base = {
      day: row.day,
      userId: row.userId,
      organizationId: row.organizationId,
      dimension: `lattice:${result.success ? (result.data.model ?? '') : ''}`,
    };
    const input: LedgerRow = {
      ...base,
      resource: 'ai_input_tokens',
      quantity: usage.success ? usage.data.inputTokens : 0,
      unmeasuredEvents: usage.success ? 0 : 1,
    };
    if (!usage.success || usage.data.outputTokens === 0) return [input];
    return [input, { ...base, resource: 'ai_output_tokens', quantity: usage.data.outputTokens }];
  });
}

/** Merge both AI sources before the shared replacement so matching owner/model rows are stored once. */
export function mergeTokenRows(rows: readonly LedgerRow[]): LedgerRow[] {
  const totals = new Map<string, LedgerRow>();
  for (const row of rows) {
    const key = JSON.stringify([
      row.day,
      row.userId,
      row.organizationId,
      row.resource,
      row.dimension,
    ]);
    const previous = totals.get(key);
    totals.set(key, {
      ...row,
      quantity: (previous?.quantity ?? 0) + (row.quantity ?? 0),
      unmeasuredEvents: (previous?.unmeasuredEvents ?? 0) + (row.unmeasuredEvents ?? 0),
    });
  }
  return [...totals.values()];
}
