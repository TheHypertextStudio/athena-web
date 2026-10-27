/** Convert retained direct calls into the same token dimensions as session runs. */
import { aiCallUsage, db, type usageDaily, type UsageResource } from '@docket/db';
import { and, gte, lt, sql } from 'drizzle-orm';
import type { UsageWindow } from './ai-tokens';

/** Load the replacement window without mutating source measurements. */
export async function loadDirectCallTokenRows(
  window: UsageWindow,
): Promise<(typeof usageDaily.$inferInsert)[]> {
  const calls = await db
    .select({
      day: sql<string>`to_char(${aiCallUsage.occurredAt} at time zone 'UTC', 'YYYY-MM-DD')`,
      userId: aiCallUsage.userId,
      organizationId: aiCallUsage.organizationId,
      model: aiCallUsage.model,
      backend: aiCallUsage.backend,
      input: aiCallUsage.inputTokens,
      output: aiCallUsage.outputTokens,
      cacheRead: aiCallUsage.cacheReadTokens,
      cacheWrite: aiCallUsage.cacheWriteTokens,
    })
    .from(aiCallUsage)
    .where(
      and(
        gte(aiCallUsage.occurredAt, new Date(`${window.from}T00:00:00.000Z`)),
        lt(aiCallUsage.occurredAt, new Date(`${window.to}T00:00:00.000Z`)),
      ),
    );
  return calls.flatMap((call) => {
    const amounts: readonly [UsageResource, number | null, number][] = [
      ['ai_input_tokens', call.input, call.input === null ? 1 : 0],
      ['ai_output_tokens', call.output, 0],
      ['ai_cache_read_tokens', call.cacheRead, 0],
      ['ai_cache_write_tokens', call.cacheWrite, 0],
    ];
    return amounts
      .filter(([, value, missing]) => (value ?? 0) > 0 || missing > 0)
      .map(([resource, value, unmeasuredEvents]) => ({
        day: call.day,
        userId: call.userId,
        organizationId: call.organizationId,
        dimension: `${call.backend === 'lattice' ? 'lattice:' : ''}${call.model ?? ''}`,
        resource,
        quantity: value ?? 0,
        unmeasuredEvents,
      }));
  });
}
