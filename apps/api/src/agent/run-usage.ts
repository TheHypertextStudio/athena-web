import type { TurnUsage } from '@docket/athena/turn';
import { agentSessionRun, type db } from '@docket/db';
import { eq, sql } from 'drizzle-orm';

/**
 * Add one turn's provider usage to its run's running totals.
 *
 * @remarks
 * Accumulates in SQL rather than reading, adding, and writing back, so two turns settling close
 * together cannot lose one another's counts.
 *
 * A turn that reported no usage leaves the columns exactly as they were — still null if nothing has
 * ever reported for this run. This applies to both hosted providers and a person's Lattice runtime:
 * missing provider counts must remain distinguishable from a measured zero.
 *
 * @param tx - The transaction persisting the turn this usage belongs to.
 * @param runId - The generation to credit.
 * @param usage - What the turn consumed, or `undefined` when the runtime reported nothing.
 * @param usageBackend - Own-hardware provenance, preserved even without reported counts.
 */
export async function addRunUsage(
  tx: Pick<typeof db, 'update'>,
  runId: string,
  usage: TurnUsage | undefined,
  usageBackend?: 'lattice',
): Promise<void> {
  if (!usage) {
    if (usageBackend)
      await tx.update(agentSessionRun).set({ usageBackend }).where(eq(agentSessionRun.id, runId));
    return;
  }

  await tx
    .update(agentSessionRun)
    .set({
      inputTokens: sql`coalesce(${agentSessionRun.inputTokens}, 0) + ${usage.inputTokens}`,
      outputTokens: sql`coalesce(${agentSessionRun.outputTokens}, 0) + ${usage.outputTokens}`,
      cacheReadTokens: sql`coalesce(${agentSessionRun.cacheReadTokens}, 0) + ${usage.cacheReadTokens}`,
      cacheCreationTokens: sql`coalesce(${agentSessionRun.cacheCreationTokens}, 0) + ${usage.cacheCreationTokens}`,
      model: usage.model,
      ...(usageBackend ? { usageBackend } : {}),
    })
    .where(eq(agentSessionRun.id, runId));
}
