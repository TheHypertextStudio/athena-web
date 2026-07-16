/** Persistent replay protection for the signed Cloudflare execution boundary. */
import { db, executionRequestNonce, type ExecutionRequestDirection } from '@docket/db';
import { lt } from 'drizzle-orm';

/**
 * Atomically claim a directional request nonce.
 *
 * @returns `true` only for the first request carrying this direction/nonce pair.
 */
export async function claimExecutionNonce(
  direction: ExecutionRequestDirection,
  nonce: string,
  expiresAt: Date,
  now = new Date(),
): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx.delete(executionRequestNonce).where(lt(executionRequestNonce.expiresAt, now));
    const [claimed] = await tx
      .insert(executionRequestNonce)
      .values({ direction, nonce, expiresAt })
      .onConflictDoNothing({
        target: [executionRequestNonce.direction, executionRequestNonce.nonce],
      })
      .returning({ id: executionRequestNonce.id });
    return Boolean(claimed);
  });
}
