import { attachmentBlobCleanup, db, genId } from '@docket/db';
import { asc, eq, lte } from 'drizzle-orm';
import { getContainer } from '../container';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Record byte deletion in the transaction that removes its attachment metadata. */
export async function enqueueBlobCleanup(
  tx: Transaction,
  orgId: string,
  blobKey: string,
): Promise<void> {
  await tx
    .insert(attachmentBlobCleanup)
    .values({ id: genId(), organizationId: orgId, blobKey })
    .onConflictDoNothing({ target: attachmentBlobCleanup.blobKey });
}

/** Retry due blob deletions, retaining a durable job after every transient storage failure. */
export async function processAttachmentBlobCleanup(limit = 100): Promise<{
  readonly considered: number;
  readonly deleted: number;
  readonly failed: number;
}> {
  const due = await db
    .select()
    .from(attachmentBlobCleanup)
    .where(lte(attachmentBlobCleanup.nextAttemptAt, new Date()))
    .orderBy(asc(attachmentBlobCleanup.nextAttemptAt), asc(attachmentBlobCleanup.id))
    .limit(limit);
  let deleted = 0;
  let failed = 0;
  for (const job of due) {
    try {
      await getContainer().blob.delete(job.blobKey);
      await db.delete(attachmentBlobCleanup).where(eq(attachmentBlobCleanup.id, job.id));
      deleted += 1;
    } catch {
      const attempts = job.attempts + 1;
      const delayMs = Math.min(24 * 60 * 60 * 1000, 30_000 * 2 ** Math.min(attempts - 1, 10));
      await db
        .update(attachmentBlobCleanup)
        .set({ attempts, nextAttemptAt: new Date(Date.now() + delayMs) })
        .where(eq(attachmentBlobCleanup.id, job.id));
      failed += 1;
    }
  }
  return { considered: due.length, deleted, failed };
}
