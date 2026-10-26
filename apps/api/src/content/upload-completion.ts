import { attachment, fileUpload } from '@docket/db';
import { and, eq, isNull } from 'drizzle-orm';
import { WorkResourceSubjectType } from '@docket/work/attachment-contract';
import { getContainer } from '../container';
import { ConflictError } from '../error';
import { assertPostVisible } from './post-access';
import { deliverableOut } from './deliverable-model';
import { recordResourceWrite } from './resource-write-receipt';
import {
  assertPendingUpload,
  authorizeUpload,
  type UploadRow,
  type UploadTx,
} from './upload-model';

/** Replay the accepted identity after a lost response, never reconstructing removed metadata. */
export async function acceptedUploadFile(
  tx: UploadTx,
  row: UploadRow,
): Promise<ReturnType<typeof deliverableOut>> {
  const [file] = await tx
    .select()
    .from(attachment)
    .where(
      and(
        eq(attachment.id, row.attachmentId),
        eq(attachment.organizationId, row.organizationId),
        isNull(attachment.archivedAt),
      ),
    )
    .limit(1);
  if (!file) throw new ConflictError();
  if (file.subjectType === 'draft' && (!file.draftExpiresAt || file.draftExpiresAt <= new Date()))
    throw new ConflictError();
  if (file.subjectType === 'comment' || file.subjectType === 'update')
    await assertPostVisible(row.organizationId, row.actorId, file.subjectType, file.subjectId, tx);
  return deliverableOut(file);
}

/** Validate provider-owned integrity and publish file metadata under the session lock. */
export async function publishUpload(tx: UploadTx, row: UploadRow): Promise<UploadRow> {
  await authorizeUpload(row, tx);
  if (row.state === 'completed') {
    await acceptedUploadFile(tx, row);
    return row;
  }
  assertPendingUpload(row);
  const actual = await getContainer().blob.transfer.stat(row.blobKey);
  if (actual?.byteSize !== row.byteSize || actual.crc32c !== row.crc32c) throw new ConflictError();
  const subjectType =
    row.subjectType === 'draft' ? 'draft' : WorkResourceSubjectType.parse(row.subjectType);
  const [file] = await tx
    .insert(attachment)
    .values({
      id: row.attachmentId,
      organizationId: row.organizationId,
      createdBy: row.actorId,
      subjectType,
      subjectId: row.subjectId ?? row.ownerKey,
      kind: 'file',
      title: row.title,
      fileName: row.fileName,
      mimeType: row.mimeType,
      byteSize: row.byteSize,
      blobKey: row.blobKey,
      ...(subjectType === 'draft'
        ? {
            draftOwnerActorId: row.actorId,
            draftOwnerPerformerKind: row.performerKind,
            draftOwnerPerformerId: row.performerId,
            draftOwnerClientId: row.clientId,
            draftExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          }
        : {}),
    })
    .returning();
  if (!file) throw new Error('Upload publication did not persist');
  if (subjectType !== 'draft')
    await recordResourceWrite(
      tx,
      {
        orgId: row.organizationId,
        actorId: row.actorId,
        subjectType,
        subjectId: row.subjectId ?? '',
      },
      file,
    );
  const [completed] = await tx
    .update(fileUpload)
    .set({ state: 'completed', capability: null, completedAt: new Date() })
    .where(eq(fileUpload.id, row.id))
    .returning();
  if (!completed) throw new Error('Upload completion did not persist');
  return completed;
}
