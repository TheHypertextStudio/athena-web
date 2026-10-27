import { consumeDemoBudgetInTransaction, DemoBudgetExceeded } from '@docket/auth/demo-budget';
import { createHash } from 'node:crypto';
import { db, fileUpload, genId, organization, resourceWriteReceipt } from '@docket/db';
import { and, count, eq, gt, inArray, sum } from 'drizzle-orm';
import { type UploadBegin } from '../contracts/uploads';
import { ConflictError, NotFoundError, RateLimitedError } from '../error';
import { type DraftOwner } from './deliverable-model';
import { type UploadTx, uploadOwnerKey } from './upload-model';

/** Reserve retry identity and storage budget before any provider operation. */
export async function reserveUpload(
  orgId: string,
  actorId: string,
  input: UploadBegin,
  owner: DraftOwner,
): Promise<string> {
  const ownerKey = uploadOwnerKey(owner);
  const requestHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  return db.transaction(async (tx) => {
    const [org] = await tx
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.id, orgId))
      .for('update');
    if (!org || owner.actorId !== actorId) throw new NotFoundError();
    const [existing] = await tx
      .select()
      .from(fileUpload)
      .where(
        and(
          eq(fileUpload.organizationId, orgId),
          eq(fileUpload.ownerKey, ownerKey),
          eq(fileUpload.requestId, input.requestId),
        ),
      )
      .limit(1);
    if (existing) {
      if (existing.requestHash !== requestHash) throw new ConflictError();
      return existing.id;
    }
    await checkUploadBudget(tx, orgId, input.byteSize);
    try {
      await consumeDemoBudgetInTransaction(tx, { organizationId: orgId }, [
        { kind: 'bytes', amount: input.byteSize },
      ]);
    } catch (error) {
      if (error instanceof DemoBudgetExceeded) throw new RateLimitedError(error.retryAfter);
      throw error;
    }
    const id = genId();
    const attachmentId = genId();
    await tx.insert(fileUpload).values({
      id,
      organizationId: orgId,
      actorId,
      ownerKey,
      performerKind: owner.performerKind,
      performerId: owner.performerId,
      clientId: owner.clientId,
      requestId: input.requestId,
      requestHash,
      subjectType: input.destination.kind === 'draft' ? 'draft' : input.destination.subjectType,
      subjectId: input.destination.kind === 'draft' ? null : input.destination.subjectId,
      fileName: input.fileName,
      mimeType: input.mimeType,
      title: input.title ?? input.fileName,
      byteSize: input.byteSize,
      crc32c: input.crc32c,
      attachmentId,
      blobKey: `attachments/${orgId}/${attachmentId}`,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    return id;
  });
}

async function checkUploadBudget(tx: UploadTx, orgId: string, byteSize: number): Promise<void> {
  const [recent] = await tx
    .select({ total: count() })
    .from(fileUpload)
    .where(
      and(
        eq(fileUpload.organizationId, orgId),
        gt(fileUpload.createdAt, new Date(Date.now() - 60_000)),
      ),
    );
  const [resourceWrites] = await tx
    .select({ total: count() })
    .from(resourceWriteReceipt)
    .where(
      and(
        eq(resourceWriteReceipt.organizationId, orgId),
        gt(resourceWriteReceipt.createdAt, new Date(Date.now() - 60_000)),
      ),
    );
  const [pending] = await tx
    .select({ bytes: sum(fileUpload.byteSize) })
    .from(fileUpload)
    .where(
      and(
        eq(fileUpload.organizationId, orgId),
        inArray(fileUpload.state, ['pending', 'cancelled']),
      ),
    );
  if (
    (recent?.total ?? 0) + (resourceWrites?.total ?? 0) >= 30 ||
    Number(pending?.bytes ?? 0) + byteSize > 1024 * 1024 * 1024
  )
    throw new RateLimitedError(60);
}
