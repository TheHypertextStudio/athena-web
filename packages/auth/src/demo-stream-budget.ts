/** Account-wide, expiring stream slots shared by all reviewer sessions and API instances. */
import { randomUUID } from 'node:crypto';
import { db, demoBudget } from '@docket/db';
import { and, eq } from 'drizzle-orm';
import { DemoBudgetExceeded, lockDemoBudget } from './demo-budget';

/** A stream closes before its crash-recovery slot expires. */
export const DEMO_STREAM_LIFETIME_MS = 60_000;
const LEASE_MS = 90_000;
const STREAM_LIMIT = 3;

/** Claim one of three shared stream slots; expiry recovers a crashed server without granting extra slots. */
export async function acquireDemoStream(
  demoId: string,
  now = Date.now(),
): Promise<() => Promise<void>> {
  const token = randomUUID();
  const id = await db.transaction(async (tx) => {
    if (!(await lockDemoBudget(tx, { demoId }))) throw new DemoBudgetExceeded(90);
    for (let slot = 0; slot < STREAM_LIMIT; slot++) {
      const key = `docket:demo:${demoId}:stream:${slot}`;
      const [row] = await tx.select().from(demoBudget).where(eq(demoBudget.id, key)).limit(1);
      if (row && row.lastRequest > now) continue;
      await tx
        .insert(demoBudget)
        .values({ id: key, demoId, key: token, count: 1, lastRequest: now + LEASE_MS })
        .onConflictDoUpdate({
          target: demoBudget.id,
          set: { key: token, lastRequest: now + LEASE_MS },
        });
      return key;
    }
    throw new DemoBudgetExceeded(90);
  });
  return async () => {
    await db.delete(demoBudget).where(and(eq(demoBudget.id, id), eq(demoBudget.key, token)));
  };
}
