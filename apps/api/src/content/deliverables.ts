import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { attachment, deliverableUploadSession, db, genId } from '@docket/db';
import { DeliverableDraftOut, type DeliverableOut } from '@docket/work/attachment-contract';
import { and, asc, eq, gt, inArray, isNotNull, isNull, lte } from 'drizzle-orm';
import { enqueueSearchDelete, enqueueSearchUpsert } from '../search/write-through';
import { IdempotencyConflictError, NotFoundError } from '../error';
import { loadReadableAttachment } from './attachment-file';
import { assertPostVisible } from './post-access';
import {
  deliverableOut,
  draftBlobKey,
  draftOwnerWhere,
  sameDraftOwner,
  uploadOwner,
} from './deliverable-model';
import type { AttachmentRow, DraftOwner } from './deliverable-model';
import { storeDeliverableDraft } from './deliverable-draft-storage';
import { enqueueBlobCleanup, processAttachmentBlobCleanup } from './deliverable-blob-cleanup';

export { deliverableOut } from './deliverable-model';
export type { DraftOwner } from './deliverable-model';
export { uploadDeliverable } from './deliverable-draft-storage';
export { processAttachmentBlobCleanup } from './deliverable-blob-cleanup';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const UPLOAD_SESSION_RETENTION_MS = 15 * 60 * 1000;

/** Create a 15-minute upload-only capability tied to the current verified performer. */
export async function createDeliverableUploadSession(
  orgId: string,
  actorId: string,
  input: { readonly fileName: string; readonly mimeType: string; readonly title?: string },
): Promise<{ readonly id: string; readonly token: string; readonly expiresAt: Date }> {
  const owner = uploadOwner(actorId);
  const id = genId();
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + UPLOAD_SESSION_RETENTION_MS);
  const [row] = await db
    .insert(deliverableUploadSession)
    .values({
      id,
      organizationId: orgId,
      actorId,
      performerKind: owner.performerKind,
      performerId: owner.performerId,
      clientId: owner.clientId,
      fileName: input.fileName,
      mimeType: input.mimeType,
      title: input.title ?? input.fileName,
      tokenHash: createHash('sha256').update(token).digest('hex'),
      expiresAt,
    })
    .returning({ id: deliverableUploadSession.id });
  if (!row) throw new Error('Upload session did not persist.');
  return { id, token, expiresAt };
}

/** Validate the upload-only token and return its private owner and file metadata. */
export async function loadDeliverableUploadSession(
  id: string,
  token: string,
  now = new Date(),
): Promise<typeof deliverableUploadSession.$inferSelect> {
  if (token.length < 32 || token.length > 128) throw new NotFoundError();
  const [row] = await db
    .select()
    .from(deliverableUploadSession)
    .where(and(eq(deliverableUploadSession.id, id), gt(deliverableUploadSession.expiresAt, now)))
    .limit(1);
  if (!row) throw new NotFoundError();
  const expected = Buffer.from(row.tokenHash, 'hex');
  const received = Buffer.from(createHash('sha256').update(token).digest('hex'), 'hex');
  if (expected.length !== received.length || !timingSafeEqual(expected, received))
    throw new NotFoundError();
  return row;
}

/** Remove expired upload capabilities after their short-lived token can no longer authorize bytes. */
export async function sweepExpiredDeliverableUploadSessions(
  now = new Date(),
  limit = 500,
): Promise<number> {
  const expired = await db
    .select({ id: deliverableUploadSession.id })
    .from(deliverableUploadSession)
    .where(lte(deliverableUploadSession.expiresAt, now))
    .orderBy(asc(deliverableUploadSession.expiresAt), asc(deliverableUploadSession.id))
    .limit(limit);
  if (expired.length === 0) return 0;
  const removed = await db
    .delete(deliverableUploadSession)
    .where(
      and(
        inArray(
          deliverableUploadSession.id,
          expired.map((row) => row.id),
        ),
        lte(deliverableUploadSession.expiresAt, now),
      ),
    )
    .returning({ id: deliverableUploadSession.id });
  return removed.length;
}

/** Bind a completed upload to its session so a retried HTTP response returns the same file. */
export async function completeDeliverableUploadSession(
  session: typeof deliverableUploadSession.$inferSelect,
  file: { readonly bytes: Uint8Array; readonly name: string; readonly type: string },
): Promise<DeliverableOut> {
  const uploadHash = deliverableUploadHash(file, session.title);
  if (session.attachmentId) {
    if (session.uploadHash !== uploadHash) throw new IdempotencyConflictError();
    const row = await readableSessionDeliverable(session, session.attachmentId);
    return deliverableOut(row);
  }

  const owner: DraftOwner = {
    actorId: session.actorId,
    performerKind: session.performerKind,
    performerId: session.performerId,
    clientId: session.clientId,
  };
  const uploaded = await storeDeliverableDraft({
    orgId: session.organizationId,
    actorId: session.actorId,
    file,
    title: session.title,
    uploadId: session.id,
    owner,
  });
  const [completed] = await db
    .update(deliverableUploadSession)
    .set({ attachmentId: uploaded.id, uploadHash })
    .where(eq(deliverableUploadSession.id, session.id))
    .returning({ id: deliverableUploadSession.id });
  if (!completed) throw new NotFoundError();
  return uploaded;
}

/** Hash bytes and stable display metadata for session retry conflict checks. */
function deliverableUploadHash(
  file: { readonly bytes: Uint8Array; readonly name: string; readonly type: string },
  title: string,
): string {
  return createHash('sha256')
    .update(file.bytes)
    .update('\0')
    .update(file.name)
    .update('\0')
    .update(file.type || 'application/octet-stream')
    .update('\0')
    .update(title)
    .digest('base64url');
}

async function readableSessionDeliverable(
  session: typeof deliverableUploadSession.$inferSelect,
  id: string,
): Promise<AttachmentRow> {
  const [row] = await db
    .select()
    .from(attachment)
    .where(
      and(
        eq(attachment.organizationId, session.organizationId),
        eq(attachment.id, id),
        isNull(attachment.archivedAt),
      ),
    )
    .limit(1);
  if (row?.kind !== 'file') throw new NotFoundError();
  if (row.subjectType === 'draft') {
    if (
      !sameDraftOwner(row, {
        actorId: session.actorId,
        performerKind: session.performerKind,
        performerId: session.performerId,
        clientId: session.clientId,
      }) ||
      !row.draftExpiresAt ||
      row.draftExpiresAt <= new Date()
    )
      throw new NotFoundError();
  } else if (row.subjectType === 'comment' || row.subjectType === 'update') {
    await loadReadableAttachment(session.organizationId, session.actorId, id);
  } else throw new NotFoundError();
  return row;
}

/** Claim all selected uploads in the post transaction; any missing or previously claimed ID rolls it back. */
export async function claimDeliverables(
  tx: Transaction,
  orgId: string,
  actorId: string,
  post: { kind: 'comment' | 'update'; id: string },
  ids: readonly string[] = [],
): Promise<void> {
  if (ids.length === 0) return;
  const rows = await tx
    .update(attachment)
    .set({
      subjectType: post.kind,
      subjectId: post.id,
      draftOwnerActorId: null,
      draftOwnerPerformerKind: null,
      draftOwnerPerformerId: null,
      draftOwnerClientId: null,
      draftExpiresAt: null,
      draftUploadId: null,
      draftUploadHash: null,
    })
    .where(
      and(
        eq(attachment.organizationId, orgId),
        eq(attachment.subjectType, 'draft'),
        draftOwnerWhere(uploadOwner(actorId)),
        gt(attachment.draftExpiresAt, new Date()),
        isNotNull(attachment.blobKey),
        isNull(attachment.archivedAt),
        inArray(attachment.id, [...ids]),
      ),
    )
    .returning({ id: attachment.id });
  if (rows.length !== ids.length) throw new NotFoundError('One or more uploads are unavailable.');
}

/** Read a file under its private draft owner or its current post's visibility boundary. */
export async function readableDeliverable(
  orgId: string,
  actorId: string,
  id: string,
): Promise<AttachmentRow> {
  const [row] = await db
    .select()
    .from(attachment)
    .where(
      and(
        eq(attachment.organizationId, orgId),
        eq(attachment.id, id),
        isNull(attachment.archivedAt),
      ),
    )
    .limit(1);
  if (row?.kind !== 'file') throw new NotFoundError();
  if (row.subjectType === 'draft') {
    if (
      !sameDraftOwner(row, uploadOwner(actorId)) ||
      !row.draftExpiresAt ||
      row.draftExpiresAt <= new Date()
    )
      throw new NotFoundError();
  } else {
    await loadReadableAttachment(orgId, actorId, id);
  }
  return row;
}

/** List the current performer's unexpired private drafts for browser and agent recovery. */
export async function listDraftDeliverables(
  orgId: string,
  actorId: string,
): Promise<DeliverableDraftOut[]> {
  const owner = uploadOwner(actorId);
  const rows = await db
    .select()
    .from(attachment)
    .where(
      and(
        eq(attachment.organizationId, orgId),
        eq(attachment.subjectType, 'draft'),
        eq(attachment.kind, 'file'),
        draftOwnerWhere(owner),
        gt(attachment.draftExpiresAt, new Date()),
        isNotNull(attachment.blobKey),
        isNull(attachment.archivedAt),
      ),
    )
    .orderBy(asc(attachment.createdAt), asc(attachment.id));
  return rows.flatMap((row) =>
    row.draftExpiresAt === null
      ? []
      : [
          DeliverableDraftOut.parse({
            ...deliverableOut(row),
            expiresAt: row.draftExpiresAt.toISOString(),
          }),
        ],
  );
}

/** List the files of a readable post, with no storage keys or pending uploads exposed. */
export async function listDeliverables(
  orgId: string,
  actorId: string,
  kind: 'comment' | 'update',
  id: string,
): Promise<DeliverableOut[]> {
  await assertPostVisible(orgId, actorId, kind, id);
  const rows = await db
    .select()
    .from(attachment)
    .where(
      and(
        eq(attachment.organizationId, orgId),
        eq(attachment.subjectType, kind),
        eq(attachment.subjectId, id),
        isNull(attachment.archivedAt),
      ),
    )
    .orderBy(asc(attachment.createdAt), asc(attachment.id));
  return rows.map(deliverableOut);
}

/** Discard a pending upload owned by this performer; published files belong to their post. */
export async function discardDeliverable(
  orgId: string,
  actorId: string,
  id: string,
): Promise<void> {
  const owner = uploadOwner(actorId);
  await db.transaction(async (tx) => {
    const [deleted] = await tx
      .delete(attachment)
      .where(
        and(
          eq(attachment.organizationId, orgId),
          eq(attachment.id, id),
          eq(attachment.subjectType, 'draft'),
          draftOwnerWhere(owner),
        ),
      )
      .returning();
    if (!deleted) throw new NotFoundError();
    await enqueueBlobCleanup(tx, orgId, deleted.blobKey ?? draftBlobKey(orgId, deleted.id));
    return deleted;
  });
  await processAttachmentBlobCleanup(10);
}

/** Hydrate an already selected post page in one file query, checking parents only for posts with files. */
export async function withDeliverables<T extends { id: string }>(
  orgId: string,
  actorId: string,
  kind: 'comment' | 'update',
  posts: readonly T[],
): Promise<(T & { attachments?: DeliverableOut[] })[]> {
  if (posts.length === 0) return [];
  const files = await db
    .select()
    .from(attachment)
    .where(
      and(
        eq(attachment.organizationId, orgId),
        eq(attachment.subjectType, kind),
        inArray(
          attachment.subjectId,
          posts.map((post) => post.id),
        ),
        isNull(attachment.archivedAt),
      ),
    )
    .orderBy(asc(attachment.createdAt), asc(attachment.id));
  const grouped = new Map<string, DeliverableOut[]>();
  for (const file of files) {
    const group = grouped.get(file.subjectId) ?? [];
    group.push(deliverableOut(file));
    grouped.set(file.subjectId, group);
  }
  const visibleIds = new Set<string>();
  for (const id of grouped.keys()) {
    try {
      await assertPostVisible(orgId, actorId, kind, id);
      visibleIds.add(id);
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
    }
  }
  return posts.map((post) =>
    visibleIds.has(post.id) ? { ...post, attachments: grouped.get(post.id) ?? [] } : post,
  );
}

/** Remove a post's attachment records in the same transaction as the post itself. */
export async function removePostDeliverables(
  tx: Transaction,
  orgId: string,
  kind: 'comment' | 'update',
  id: string,
): Promise<AttachmentRow[]> {
  const files = await tx
    .select()
    .from(attachment)
    .where(
      and(
        eq(attachment.organizationId, orgId),
        eq(attachment.subjectType, kind),
        eq(attachment.subjectId, id),
      ),
    );
  for (const file of files) {
    if (file.blobKey) await enqueueBlobCleanup(tx, orgId, file.blobKey);
  }
  await tx
    .delete(attachment)
    .where(
      and(
        eq(attachment.organizationId, orgId),
        eq(attachment.subjectType, kind),
        eq(attachment.subjectId, id),
      ),
    );
  return files;
}

/** Clean up removed post files after commit; blob cleanup cannot undo an accepted deletion. */
export async function cleanupPostDeliverables(
  orgId: string,
  files: readonly AttachmentRow[],
): Promise<void> {
  for (const file of files) {
    await enqueueSearchDelete(orgId, 'attachment', file.id);
  }
  if (files.some((file) => file.blobKey)) await processAttachmentBlobCleanup(100);
}

/** Reclaim expired drafts, atomically recording byte deletion before dropping their metadata. */
export async function sweepExpiredDeliverableDrafts(
  now = new Date(),
  limit = 100,
): Promise<number> {
  const expired = await db
    .select()
    .from(attachment)
    .where(
      and(
        eq(attachment.subjectType, 'draft'),
        lte(attachment.draftExpiresAt, now),
        isNull(attachment.archivedAt),
      ),
    )
    .orderBy(asc(attachment.draftExpiresAt), asc(attachment.id))
    .limit(limit);
  if (expired.length === 0) return 0;
  const removed = await db.transaction(async (tx) => {
    let count = 0;
    for (const row of expired) {
      const [deleted] = await tx
        .delete(attachment)
        .where(
          and(
            eq(attachment.organizationId, row.organizationId),
            eq(attachment.id, row.id),
            eq(attachment.subjectType, 'draft'),
            lte(attachment.draftExpiresAt, now),
            isNull(attachment.archivedAt),
          ),
        )
        .returning();
      if (!deleted) continue;
      await enqueueBlobCleanup(
        tx,
        deleted.organizationId,
        deleted.blobKey ?? draftBlobKey(deleted.organizationId, deleted.id),
      );
      count += 1;
    }
    return count;
  });
  return removed;
}

/** Hydrate one already selected post without assuming an array item exists. */
export async function withPostDeliverables<T extends { id: string }>(
  orgId: string,
  actorId: string,
  kind: 'comment' | 'update',
  post: T,
): Promise<T & { attachments?: DeliverableOut[] }> {
  const [result] = await withDeliverables(orgId, actorId, kind, [post]);
  if (!result) throw new NotFoundError();
  return result;
}

/** Publish attachment search work only after its owning post transaction commits. */
export async function indexDeliverables(orgId: string, ids: readonly string[] = []): Promise<void> {
  for (const id of ids) await enqueueSearchUpsert(orgId, 'attachment', id);
}
