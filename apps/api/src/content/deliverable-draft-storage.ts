import { createHash } from 'node:crypto';
import { attachment, db, genId } from '@docket/db';
import type { DeliverableOut } from '@docket/work/attachment-contract';
import { and, eq, isNull } from 'drizzle-orm';
import { getContainer } from '../container';
import { IdempotencyConflictError, NotFoundError } from '../error';
import { hasSqlState } from '../lib/sql-state';
import { MAX_ATTACHMENT_BYTES } from './attachment-file';
import { enqueueBlobCleanup, processAttachmentBlobCleanup } from './deliverable-blob-cleanup';
import { deliverableOut, draftBlobKey, draftOwnerWhere, uploadOwner } from './deliverable-model';
import type { AttachmentRow, DraftOwner } from './deliverable-model';

const DRAFT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

interface DraftStorageInput {
  readonly orgId: string;
  readonly actorId: string;
  readonly file: { readonly name: string; readonly type: string; readonly bytes: Uint8Array };
  readonly title: string | undefined;
  readonly uploadId: string | undefined;
  readonly owner: DraftOwner;
}

/** Store a private seven-day draft under the current verified performer. */
export async function uploadDeliverable(
  orgId: string,
  actorId: string,
  file: DraftStorageInput['file'],
  title?: string,
  uploadId?: string,
): Promise<DeliverableOut> {
  return storeDeliverableDraft({
    orgId,
    actorId,
    file,
    title,
    uploadId,
    owner: uploadOwner(actorId),
  });
}

/** Store bytes under a verified current performer or a previously authenticated upload session. */
export async function storeDeliverableDraft(input: DraftStorageInput): Promise<DeliverableOut> {
  const { uploadId } = input;
  const mimeType = validatedMimeType(input);
  const uploadHash = uploadId ? draftHash(input, mimeType) : null;
  if (uploadId) {
    const existing = await findDraft(input);
    if (existing) return restoreDraft(input, existing, uploadHash);
  }
  let row: AttachmentRow;
  try {
    row = await insertDraft(input, mimeType, uploadHash);
  } catch (error) {
    if (!uploadId || !hasSqlState(error, '23505')) throw error;
    return restoreDraft(input, await findDraft(input), uploadHash);
  }
  try {
    return await writeDraftBytes(input, row);
  } catch (error) {
    // Retain an uncertain keyed upload so the same identity can restore its bytes on retry.
    if (uploadId) throw error;
    await db.transaction(async (tx) => {
      await enqueueBlobCleanup(tx, input.orgId, draftBlobKey(input.orgId, row.id));
      await tx.delete(attachment).where(eq(attachment.id, row.id));
    });
    await processAttachmentBlobCleanup(10);
    throw error;
  }
}

function draftHash(input: DraftStorageInput, mimeType: string): string {
  return createHash('sha256')
    .update(input.file.bytes)
    .update('\0')
    .update(input.file.name)
    .update('\0')
    .update(mimeType)
    .update('\0')
    .update(input.title ?? input.file.name)
    .digest('base64url');
}

async function findDraft(input: DraftStorageInput): Promise<AttachmentRow | undefined> {
  if (!input.uploadId) return undefined;
  const [existing] = await db
    .select()
    .from(attachment)
    .where(
      and(
        eq(attachment.organizationId, input.orgId),
        eq(attachment.subjectType, 'draft'),
        eq(attachment.draftUploadId, input.uploadId),
        draftOwnerWhere(input.owner),
        isNull(attachment.archivedAt),
      ),
    )
    .limit(1);
  return existing;
}

async function restoreDraft(
  input: DraftStorageInput,
  existing: AttachmentRow | undefined,
  uploadHash: string | null,
): Promise<DeliverableOut> {
  if (existing?.draftUploadHash !== uploadHash) throw new IdempotencyConflictError();
  if (!existing.draftExpiresAt || existing.draftExpiresAt <= new Date()) throw new NotFoundError();
  return writeDraftBytes(input, existing);
}

async function insertDraft(
  input: DraftStorageInput,
  mimeType: string,
  uploadHash: string | null,
): Promise<AttachmentRow> {
  const { orgId, actorId, file, owner, uploadId, title } = input;
  const id = genId();
  const [row] = await db
    .insert(attachment)
    .values({
      id,
      organizationId: orgId,
      createdBy: actorId,
      subjectType: 'draft',
      subjectId: JSON.stringify([
        owner.actorId,
        owner.performerKind,
        owner.performerId,
        owner.clientId,
      ]),
      draftOwnerActorId: owner.actorId,
      draftOwnerPerformerKind: owner.performerKind,
      draftOwnerPerformerId: owner.performerId,
      draftOwnerClientId: owner.clientId,
      draftExpiresAt: new Date(Date.now() + DRAFT_RETENTION_MS),
      draftUploadId: uploadId ?? null,
      draftUploadHash: uploadHash,
      kind: 'file',
      title: title ?? file.name,
      fileName: file.name,
      mimeType,
      byteSize: file.bytes.length,
      blobKey: null,
    })
    .returning();
  if (!row) throw new Error('File upload did not persist.');
  return row;
}

function validatedMimeType(input: DraftStorageInput): string {
  if (input.owner.actorId !== input.actorId) throw new NotFoundError();
  if (input.file.bytes.length === 0 || input.file.bytes.length > MAX_ATTACHMENT_BYTES)
    throw new Error('File size must be validated before upload.');
  return input.file.type || 'application/octet-stream';
}

async function writeDraftBytes(
  input: DraftStorageInput,
  row: AttachmentRow,
): Promise<DeliverableOut> {
  const blobKey = draftBlobKey(input.orgId, row.id);
  await getContainer().blob.put(
    blobKey,
    input.file.bytes,
    input.file.type || 'application/octet-stream',
  );
  // A storage key denotes acknowledged bytes. Unconfirmed metadata stays private and unclaimable.
  const [ready] = await db
    .update(attachment)
    .set({ blobKey })
    .where(and(eq(attachment.id, row.id), eq(attachment.organizationId, input.orgId)))
    .returning();
  if (ready) return deliverableOut(ready);
  // Discard or expiry may have raced the transfer; requeue cleanup after the final byte write.
  await db.transaction((tx) => enqueueBlobCleanup(tx, input.orgId, blobKey));
  await processAttachmentBlobCleanup(10);
  throw new NotFoundError();
}
