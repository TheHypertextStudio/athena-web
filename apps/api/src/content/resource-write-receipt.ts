import { writeResourceBytes } from './resource-write-storage';
import {
  attachment,
  db,
  externalResource,
  fileUpload,
  genId,
  organization,
  resourceWriteReceipt,
  searchIndexJob,
} from '@docket/db';
import { and, count, eq, gt, isNull, lt } from 'drizzle-orm';
import { assertPostVisible } from './post-access';
import { getContainer } from '../container';
import { ConflictError, NotFoundError, RateLimitedError } from '../error';
import { insertAuditEvents } from '../lib/provenance/audit-events';
import { searchIndexJobDedupeKey } from '../search/enqueue';
import { deferAfterResponse } from '../lib/after-response';
import { authorizeResourceSubject, type ResourceSubject } from './resource-subject';
import type { ResourceMaterial } from './resource-write-input';

/** Retry identity is derived from the authenticated client, actor, workspace and explicit request. */
export interface ResourceWriteIdentity extends ResourceSubject {
  readonly namespace: string;
  readonly requestId: string;
  readonly requestHash: string;
}
type Receipt = typeof resourceWriteReceipt.$inferSelect;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function receiptWhere(
  input: Pick<Receipt, 'organizationId' | 'actorId' | 'namespace' | 'requestId'>,
) {
  return and(
    eq(resourceWriteReceipt.organizationId, input.organizationId),
    eq(resourceWriteReceipt.actorId, input.actorId),
    eq(resourceWriteReceipt.namespace, input.namespace),
    eq(resourceWriteReceipt.requestId, input.requestId),
  );
}

/** Reserve a durable cleanup identity before storing any bytes, then serialize identical writers. */
export async function persistResourceWrite(
  input: ResourceWriteIdentity,
  material: ResourceMaterial,
): Promise<{ row: typeof attachment.$inferSelect; replayed: boolean }> {
  const attachmentId = genId();
  const identity = {
    organizationId: input.orgId,
    actorId: input.actorId,
    namespace: input.namespace,
    requestId: input.requestId,
  };
  await reserveReceipt({
    ...identity,
    requestHash: input.requestHash,
    attachmentId,
    blobKey: material.kind === 'file' ? `attachments/${input.orgId}/${attachmentId}` : null,
    byteSize: material.byteSize ?? material.bytes?.byteLength ?? null,
  });
  return db
    .transaction(async (tx) => {
      const [receipt] = await tx
        .select()
        .from(resourceWriteReceipt)
        .where(receiptWhere(identity))
        .for('update');
      if (receipt?.requestHash !== input.requestHash) throw new ConflictError();
      await authorizeResourceSubject(input, 'contribute', tx);
      await authorizeMaterialSource(tx, input, material);
      if (receipt.completedAt) return replayResourceWrite(tx, receipt);
      await writeResourceBytes(receipt.blobKey, material);
      const [row] = await tx
        .insert(attachment)
        .values({
          id: receipt.attachmentId,
          organizationId: input.orgId,
          createdBy: input.actorId,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          kind: material.kind,
          title: material.title,
          url: material.url,
          externalResourceId: material.externalResourceId,
          blobKey: receipt.blobKey,
          fileName: material.fileName,
          mimeType: material.mimeType,
          byteSize: material.byteSize ?? material.bytes?.byteLength,
        })
        .returning();
      if (!row) throw new Error('Resource attachment insert returned no row');
      await recordResourceWrite(tx, input, row);
      await tx
        .update(resourceWriteReceipt)
        .set({ completedAt: new Date() })
        .where(receiptWhere(identity));
      return { row, replayed: false };
    })
    .catch((error: unknown) => {
      // Reacquiring the receipt lock distinguishes a rolled-back write from an ambiguous commit
      // or a concurrent retry that has already completed. Never delete the winner's file.
      deferAfterResponse('resource-write-cleanup', () =>
        cleanFailedReceipt(identity, input.requestHash),
      );
      throw error;
    });
}

async function cleanFailedReceipt(
  identity: Pick<Receipt, 'organizationId' | 'actorId' | 'namespace' | 'requestId'>,
  requestHash: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [receipt] = await tx
      .select()
      .from(resourceWriteReceipt)
      .where(receiptWhere(identity))
      .for('update');
    if (receipt?.requestHash === requestHash && !receipt.completedAt && receipt.blobKey) {
      await getContainer().blob.delete(receipt.blobKey);
    }
  });
}

async function reserveReceipt(input: typeof resourceWriteReceipt.$inferInsert): Promise<void> {
  await db.transaction(async (tx) => {
    // Only the short reservation holds the workspace lock; blob I/O never blocks other callers here.
    const [workspace] = await tx
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.id, input.organizationId))
      .for('update');
    if (!workspace) throw new NotFoundError();
    const [existing] = await tx
      .select({ id: resourceWriteReceipt.attachmentId })
      .from(resourceWriteReceipt)
      .where(receiptWhere(input))
      .limit(1);
    if (existing) return;
    const [recent] = await tx
      .select({ total: count() })
      .from(resourceWriteReceipt)
      .where(
        and(
          eq(resourceWriteReceipt.organizationId, input.organizationId),
          gt(resourceWriteReceipt.createdAt, new Date(Date.now() - 60_000)),
        ),
      );
    const [uploads] = await tx
      .select({ total: count() })
      .from(fileUpload)
      .where(
        and(
          eq(fileUpload.organizationId, input.organizationId),
          gt(fileUpload.createdAt, new Date(Date.now() - 60_000)),
        ),
      );
    if ((recent?.total ?? 0) + (uploads?.total ?? 0) >= 30) throw new RateLimitedError(60);
    await tx.insert(resourceWriteReceipt).values(input).onConflictDoNothing();
  });
}

async function authorizeMaterialSource(
  tx: Tx,
  input: ResourceSubject,
  material: ResourceMaterial,
): Promise<void> {
  if (!material.source) return;
  if (material.source.kind === 'external_resource') {
    const [row] = await tx
      .select({ id: externalResource.id })
      .from(externalResource)
      .where(
        and(
          eq(externalResource.id, material.source.id),
          eq(externalResource.organizationId, input.orgId),
          isNull(externalResource.archivedAt),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundError();
    return;
  }
  const [row] = await tx
    .select()
    .from(attachment)
    .where(
      and(
        eq(attachment.id, material.source.id),
        eq(attachment.organizationId, input.orgId),
        isNull(attachment.archivedAt),
      ),
    )
    .limit(1);
  if (!row || row.subjectType === 'draft') throw new NotFoundError();
  if (row.subjectType === 'comment' || row.subjectType === 'update') {
    await assertPostVisible(input.orgId, input.actorId, row.subjectType, row.subjectId, tx);
    return;
  }
  await authorizeResourceSubject(
    { ...input, subjectType: row.subjectType, subjectId: row.subjectId },
    'view',
    tx,
  );
}

async function replayResourceWrite(
  tx: Tx,
  receipt: Receipt,
): Promise<{ row: typeof attachment.$inferSelect; replayed: true }> {
  const [row] = await tx
    .select()
    .from(attachment)
    .where(
      and(
        eq(attachment.id, receipt.attachmentId),
        eq(attachment.organizationId, receipt.organizationId),
        isNull(attachment.archivedAt),
      ),
    )
    .limit(1);
  if (!row) throw new ConflictError();
  return { row, replayed: true };
}

/** Record direct file publication with durable resource activity and search jobs. */
export async function recordResourceWrite(
  tx: Tx,
  input: ResourceSubject,
  row: typeof attachment.$inferSelect,
): Promise<void> {
  await insertAuditEvents(tx, 'resource_attach', {
    organizationId: input.orgId,
    actorId: input.actorId,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    type: 'updated',
    metadata: { field: 'resource', label: 'Resource', from: null, to: row.title },
  });
  for (const [sourceTable, entityId] of [
    ['attachment', row.id],
    [input.subjectType, input.subjectId],
  ] as const) {
    const job = {
      organizationId: input.orgId,
      sourceTable,
      entityId,
      operation: 'upsert' as const,
      reason: 'entity_write' as const,
    };
    await tx
      .insert(searchIndexJob)
      .values({ ...job, dedupeKey: searchIndexJobDedupeKey(job) })
      .onConflictDoNothing();
  }
}

/** Clean abandoned allocations under the same row lock as writers; completed files are never touched. */
export async function sweepAbandonedResourceWrites(now = new Date()): Promise<number> {
  const stale = await db
    .select()
    .from(resourceWriteReceipt)
    .where(
      and(
        isNull(resourceWriteReceipt.completedAt),
        lt(resourceWriteReceipt.createdAt, new Date(now.getTime() - 60 * 60 * 1000)),
      ),
    )
    .limit(50);
  let cleaned = 0;
  for (const candidate of stale) {
    await db.transaction(async (tx) => {
      const [receipt] = await tx
        .select()
        .from(resourceWriteReceipt)
        .where(receiptWhere(candidate))
        .for('update');
      if (!receipt || receipt.completedAt) return;
      const [existing] = await tx
        .select({ id: attachment.id })
        .from(attachment)
        .where(eq(attachment.id, receipt.attachmentId))
        .limit(1);
      if (existing) return;
      if (receipt.blobKey) await getContainer().blob.delete(receipt.blobKey);
      await tx.delete(resourceWriteReceipt).where(receiptWhere(receipt));
      cleaned++;
    });
  }
  return cleaned;
}
