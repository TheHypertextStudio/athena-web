import { actor, db, fileUpload, organization } from '@docket/db';
import { and, eq, isNull, lte, or } from 'drizzle-orm';
import { getContainer } from '../container';
import { ConflictError } from '../error';
import { lockUpload, uploadCapability } from './upload-model';

/** Retire a pending capability durably before provider cleanup; completed uploads use normal removal. */
export async function cancelUpload(orgId: string, actorId: string, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const row = await lockUpload(tx, orgId, actorId, id);
    if (row.state === 'completed') throw new ConflictError();
    if (row.state === 'pending')
      await tx.update(fileUpload).set({ state: 'cancelled' }).where(eq(fileUpload.id, id));
  });
  await cleanCancelledUpload(id);
}

async function cleanCancelledUpload(id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(fileUpload).where(eq(fileUpload.id, id)).for('update');
    if (!row) return;
    const [org] = await tx
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.id, row.organizationId))
      .limit(1);
    if (row.state === 'cleaned' && !org) {
      await tx.delete(fileUpload).where(eq(fileUpload.id, id));
      return;
    }
    if (row.state !== 'cancelled') return;
    const capability = uploadCapability(row);
    await getContainer().blob.transfer.cancel(
      row.blobKey,
      capability?.kind === 'gcs' ? capability.uri : null,
    );
    await getContainer().blob.delete(row.blobKey);
    if (org)
      await tx
        .update(fileUpload)
        .set({ state: 'cleaned', capability: null })
        .where(eq(fileUpload.id, id));
    else await tx.delete(fileUpload).where(eq(fileUpload.id, id));
  });
}

/** Retry bounded pending cleanup; accepted files are preserved while their workspace exists. */
export async function sweepExpiredUploads(now = new Date()): Promise<number> {
  const candidates = await db
    .select({ upload: fileUpload, workspace: organization.id, owner: actor.id })
    .from(fileUpload)
    .leftJoin(organization, eq(organization.id, fileUpload.organizationId))
    .leftJoin(actor, eq(actor.id, fileUpload.actorId))
    .where(
      and(
        lte(fileUpload.cleanupAfter, now),
        or(
          isNull(organization.id),
          eq(fileUpload.state, 'cancelled'),
          and(
            eq(fileUpload.state, 'pending'),
            or(lte(fileUpload.expiresAt, now), isNull(actor.id)),
          ),
        ),
      ),
    )
    .limit(50);
  let cleaned = 0;
  for (const { upload: candidate, workspace, owner } of candidates) {
    await db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(fileUpload)
        .where(eq(fileUpload.id, candidate.id))
        .for('update');
      if (!row) return;
      if (
        (!workspace && row.state !== 'cleaned') ||
        (row.state === 'pending' && (row.expiresAt <= now || !owner))
      )
        await tx.update(fileUpload).set({ state: 'cancelled' }).where(eq(fileUpload.id, row.id));
    });
    try {
      await cleanCancelledUpload(candidate.id);
      cleaned++;
    } catch {
      // Retain the cancellation capability and reservation; isolate failed providers from later jobs.
      const attempts = candidate.cleanupAttempts + 1;
      const delay = Math.min(24 * 60 * 60 * 1000, 30_000 * 2 ** Math.min(attempts - 1, 10));
      await db
        .update(fileUpload)
        .set({ cleanupAttempts: attempts, cleanupAfter: new Date(now.getTime() + delay) })
        .where(eq(fileUpload.id, candidate.id));
    }
  }
  return cleaned;
}

/** Clear a failed buffered work write under the publication lock without deleting a completed retry. */
export async function cleanUnpublishedUpload(id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(fileUpload).where(eq(fileUpload.id, id)).for('update');
    if (row?.state !== 'pending') return;
    const capability = uploadCapability(row);
    await getContainer().blob.transfer.cancel(
      row.blobKey,
      capability?.kind === 'gcs' ? capability.uri : null,
    );
    await getContainer().blob.delete(row.blobKey);
    await tx.update(fileUpload).set({ capability: null }).where(eq(fileUpload.id, id));
  });
}
