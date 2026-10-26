import { attachment, db, searchIndexJob } from '@docket/db';
import { and, eq, isNull } from 'drizzle-orm';
import { NotFoundError } from '../error';
import { deferAfterResponse } from '../lib/after-response';
import { insertAuditEvents } from '../lib/provenance/audit-events';
import { searchIndexJobDedupeKey } from '../search/enqueue';
import { enqueueBlobCleanup, processAttachmentBlobCleanup } from './deliverable-blob-cleanup';
import { authorizeResourceSubject, type ResourceSubject } from './resource-subject';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type RemovedResource = Pick<typeof attachment.$inferSelect, 'id' | 'blobKey'>;

async function queueResourceRemoval(
  tx: Transaction,
  orgId: string,
  rows: readonly RemovedResource[],
): Promise<void> {
  for (const row of rows) {
    if (row.blobKey) await enqueueBlobCleanup(tx, orgId, row.blobKey);
    const job = {
      organizationId: orgId,
      sourceTable: 'attachment',
      entityId: row.id,
      operation: 'delete' as const,
      reason: 'entity_write' as const,
    };
    await tx
      .insert(searchIndexJob)
      .values({ ...job, dedupeKey: searchIndexJobDedupeKey(job) })
      .onConflictDoNothing();
  }
}

/** Queue owned byte cleanup atomically with permanent work deletion; preserve accepted retry receipts. */
export async function removeWorkResources(
  tx: Transaction,
  subject: Omit<ResourceSubject, 'actorId'>,
): Promise<void> {
  const rows = await tx
    .delete(attachment)
    .where(
      and(
        eq(attachment.organizationId, subject.orgId),
        eq(attachment.subjectType, subject.subjectType),
        eq(attachment.subjectId, subject.subjectId),
      ),
    )
    .returning({ id: attachment.id, blobKey: attachment.blobKey });
  await queueResourceRemoval(tx, subject.orgId, rows);
}

/** Remove an exact work attachment and retain its byte deletion in the shared durable cleanup queue. */
export async function removeResourceAttachment(
  subject: ResourceSubject,
  id: string,
): Promise<string> {
  const removedTitle = await db.transaction(async (tx) => {
    await authorizeResourceSubject(subject, 'contribute', tx);
    const [row] = await tx
      .delete(attachment)
      .where(
        and(
          eq(attachment.organizationId, subject.orgId),
          eq(attachment.id, id),
          eq(attachment.subjectType, subject.subjectType),
          eq(attachment.subjectId, subject.subjectId),
          isNull(attachment.archivedAt),
        ),
      )
      .returning();
    if (!row) throw new NotFoundError();
    await insertAuditEvents(tx, 'resource_remove', {
      organizationId: subject.orgId,
      actorId: subject.actorId,
      subjectType: subject.subjectType,
      subjectId: subject.subjectId,
      type: 'updated',
      metadata: { field: 'resource', label: 'Resource', from: row.title, to: null },
    });
    await queueResourceRemoval(tx, subject.orgId, [row]);
    return row.title;
  });
  try {
    await processAttachmentBlobCleanup(50);
  } catch {
    deferAfterResponse('resource-attachment-cleanup', () =>
      processAttachmentBlobCleanup(50).then(() => undefined),
    );
  }
  return removedTitle;
}
