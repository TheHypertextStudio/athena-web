/** Private inert-text attachment processing. No document parser, code or formula execution. */
import { createHash } from 'node:crypto';
import { athenaInboundMessage, athenaMailBlob, user, sessionActivity, db } from '@docket/db';
import type { AthenaMailAttachmentMeta, AthenaMailAttachmentSnapshot } from '@docket/db';
import { and, eq, notExists, lte, or, asc, sql } from 'drizzle-orm';
import {
  MAIL_ATTACHMENT_MAX_COUNT,
  supportedTextAttachment,
  validateTextAttachment,
} from '@docket/mail';
import { getContainer } from '../../container';
import { mailChannelAuthority } from './channel';
import { markProvenance } from '../../agent/provenance';
import { NotFoundError, ConflictError } from '../../error';
type Inbound = typeof athenaInboundMessage.$inferSelect;
/** Stable content identity, verified again before every download and send. */
export function mailAttachmentDigest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
async function prepareFile(
  message: Inbound,
  file: AthenaMailAttachmentMeta,
  index: number,
): Promise<AthenaMailAttachmentMeta> {
  if (file.status === 'ready' || file.status === 'rejected') return file;
  if (
    index >= MAIL_ATTACHMENT_MAX_COUNT ||
    !supportedTextAttachment(file.filename, file.contentType)
  )
    return {
      ...file,
      status: 'rejected',
      errorCode:
        index >= MAIL_ATTACHMENT_MAX_COUNT ? 'attachment_count_limit' : 'attachment_unsupported',
    };
  const receiver = getContainer().inboundMail;
  if (!receiver.retrieveAttachment)
    return { ...file, status: 'unavailable', errorCode: 'attachment_unavailable' };
  let bytes: Uint8Array;
  try {
    bytes = await receiver.retrieveAttachment(message.providerMessageId, file.id);
  } catch (error) {
    if (
      error instanceof Error &&
      [
        'attachment_invalid_metadata',
        'attachment_invalid_url',
        'attachment_too_large',
        'attachment_size_mismatch',
        'attachment_invalid_bytes',
      ].includes(error.message)
    )
      return { ...file, status: 'rejected', errorCode: 'attachment_rejected' };
    throw error;
  }
  let text: string;
  try {
    text = validateTextAttachment(file.filename, file.contentType, bytes).text;
  } catch {
    return { ...file, status: 'rejected', errorCode: 'attachment_invalid_text' };
  }
  const digest = mailAttachmentDigest(bytes);
  // Keys derive exclusively from persisted identities and server-computed digests, never filenames.
  const blobKey = `athena-mail/${message.ownerUserId}/${message.id}/${digest}`;
  await db
    .insert(athenaMailBlob)
    .values({ key: blobKey, ownerUserId: message.ownerUserId, messageId: message.id })
    .onConflictDoNothing();
  await getContainer().blob.put(blobKey, bytes, file.contentType ?? 'text/plain');
  return {
    ...file,
    status: 'ready',
    digest,
    size: bytes.byteLength,
    blobKey,
    extractedText: text.slice(0, 12000),
  };
}
/** Retrieve only after enrolled-owner authorization; a failed network read remains recoverable. */
export async function prepareMailAttachments(message: Inbound): Promise<Inbound> {
  if (!message.attachments.length) return message;
  if (!(await mailChannelAuthority(message.mailboxId, message.channelRevision ?? -1)))
    throw new ConflictError('Email channel is unavailable');
  const attachments: AthenaMailAttachmentMeta[] = [];
  for (const [index, file] of message.attachments.entries())
    attachments.push(await prepareFile(message, file, index));
  await db
    .update(athenaInboundMessage)
    .set({ attachments })
    .where(eq(athenaInboundMessage.id, message.id));
  return { ...message, attachments };
}
/** Bound extracted context and mark it untrusted; unsupported files are explained explicitly. */
export function mailAttachmentContext(message: Pick<Inbound, 'id' | 'attachments'>): string {
  return message.attachments
    .slice(0, 100)
    .map((file) =>
      file.status === 'ready'
        ? `Attachment ${file.filename} (messageId=${message.id}, id=${file.id}, digest=${file.digest}, filename=${file.filename}, contentType=${file.contentType}, size=${file.size}; preview contains at most the first 12,000 characters, not necessarily the complete file):\n${markProvenance(file.extractedText ?? '', 'email', 'untrusted inert-text attachment')}`
        : `Attachment ${file.filename} was not read (${file.errorCode ?? 'attachment_unavailable'}). Supported: UTF-8 .txt, .md and .csv, at most 5 files of 64 KiB each.`,
    )
    .join('\n\n')
    .slice(0, 64000);
}
async function readyFile(
  owner: string,
  mailboxId: string,
  revision: number,
  messageId: string,
  attachmentId: string,
): Promise<AthenaMailAttachmentMeta> {
  if (!(await mailChannelAuthority(mailboxId, revision)))
    throw new NotFoundError('Attachment not found');
  const [message] = await db
    .select()
    .from(athenaInboundMessage)
    .where(
      and(
        eq(athenaInboundMessage.id, messageId),
        eq(athenaInboundMessage.ownerUserId, owner),
        eq(athenaInboundMessage.mailboxId, mailboxId),
        eq(athenaInboundMessage.channelRevision, revision),
      ),
    );
  const file = message?.attachments.find(
    (item) => item.id === attachmentId && item.status === 'ready',
  );
  if (!file?.blobKey || !file.digest || file.size === undefined || !file.contentType)
    throw new NotFoundError('Attachment not found');
  return file;
}
/** Resolve an owner-held immutable file to the exact approval snapshot. */
export async function snapshotMailAttachment(
  owner: string,
  mailboxId: string,
  revision: number,
  ref: { messageId: string; id: string; digest: string },
): Promise<AthenaMailAttachmentSnapshot> {
  const file = await readyFile(owner, mailboxId, revision, ref.messageId, ref.id);
  if (file.digest !== ref.digest) throw new ConflictError('Attachment content changed');
  return {
    messageId: ref.messageId,
    id: ref.id,
    digest: ref.digest,
    filename: file.filename,
    contentType: file.contentType ?? '',
    size: file.size ?? 0,
  };
}
/** Owner-bound private read; no signed public URL is exposed. */
export async function readMailAttachment(
  owner: string,
  messageId: string,
  attachmentId: string,
): Promise<{ bytes: Uint8Array; filename: string }> {
  const [message] = await db
    .select()
    .from(athenaInboundMessage)
    .where(
      and(eq(athenaInboundMessage.id, messageId), eq(athenaInboundMessage.ownerUserId, owner)),
    );
  if (!message) throw new NotFoundError('Attachment not found');
  const file = await readyFile(
    owner,
    message.mailboxId,
    message.channelRevision ?? -1,
    messageId,
    attachmentId,
  );
  const bytes = await getContainer().blob.get(file.blobKey ?? '');
  if (!bytes || mailAttachmentDigest(bytes) !== file.digest)
    throw new NotFoundError('Attachment not found');
  return { bytes, filename: file.filename };
}
/** Revalidate consent, ownership and exact approval content before provider delivery. */
export async function resolveOutboundAttachments(
  owner: string,
  mailboxId: string,
  revision: number,
  refs: readonly AthenaMailAttachmentSnapshot[],
): Promise<{ filename: string; content: string; content_type: string }[]> {
  if (refs.length > MAIL_ATTACHMENT_MAX_COUNT) throw new ConflictError('Attachment limit exceeded');
  const result = [];
  for (const ref of refs) {
    const snapshot = await snapshotMailAttachment(owner, mailboxId, revision, ref);
    if (
      snapshot.filename !== ref.filename ||
      snapshot.contentType !== ref.contentType ||
      snapshot.size !== ref.size
    )
      throw new ConflictError('Attachment content changed');
    const file = await readMailAttachment(owner, ref.messageId, ref.id);
    result.push({
      filename: ref.filename,
      content: Buffer.from(file.bytes).toString('base64'),
      content_type: ref.contentType,
    });
  }
  return result;
}

/** Reclaim private bytes after account/message deletion; ledger is removed only after successful deletion.
 * A one-hour grace exceeds the bounded upload operation and prevents racing an interrupted writer.
 */
export async function sweepMailAttachmentBlobs(now = new Date()): Promise<number> {
  const rows = await db
    .select()
    .from(athenaMailBlob)
    .where(
      and(
        lte(athenaMailBlob.createdAt, new Date(now.getTime() - 3600_000)),
        or(
          notExists(
            db.select({ id: user.id }).from(user).where(eq(user.id, athenaMailBlob.ownerUserId)),
          ),
          notExists(
            db
              .select({ id: athenaInboundMessage.id })
              .from(athenaInboundMessage)
              .where(eq(athenaInboundMessage.id, athenaMailBlob.messageId)),
          ),
        ),
      ),
    )
    .orderBy(asc(athenaMailBlob.createdAt))
    .limit(100);
  let deleted = 0;
  for (const row of rows) {
    try {
      await getContainer().blob.delete(row.key);
      await db.delete(athenaMailBlob).where(eq(athenaMailBlob.key, row.key));
      deleted++;
    } catch {
      /* Keep durable intent for the next scheduled retry. */
    }
  }
  return deleted;
}

/** Compare ordered attachment references without depending on JSON object-key ordering. */
export function sameMailAttachmentRefs(
  input: unknown,
  refs: readonly {
    messageId: string;
    id: string;
    digest: string;
    filename?: string;
    contentType?: string;
    size?: number;
  }[],
): boolean {
  if (input === undefined) return refs.length === 0;
  if (!Array.isArray(input) || input.length !== refs.length) return false;
  return refs.every((ref, index) => {
    const item: unknown = input[index];
    if (!item || typeof item !== 'object') return false;
    const value = item as Record<string, unknown>;
    return (
      value['messageId'] === ref.messageId &&
      value['id'] === ref.id &&
      value['digest'] === ref.digest &&
      value['filename'] === ref.filename &&
      value['contentType'] === ref.contentType &&
      value['size'] === ref.size
    );
  });
}

/** Load only the authenticated continuation's bounded untrusted attachment context. */
export async function mailElicitationAttachmentContext(
  sessionId: string,
  questionId: string,
): Promise<string> {
  const rows = await db
    .select()
    .from(sessionActivity)
    .where(
      and(
        eq(sessionActivity.sessionId, sessionId),
        eq(sessionActivity.type, 'response'),
        sql`${sessionActivity.id} LIKE 'mail-attachment-context:%'`,
        sql`${sessionActivity.body}->>'elicitationId' = ${questionId}`,
        sql`${sessionActivity.body}->>'provenance' = 'email'`,
      ),
    )
    .orderBy(asc(sessionActivity.createdAt))
    .limit(5);
  const text = rows.map((row) => row.body.text ?? '').join('\n\n');
  return text.length > 20000
    ? `${text.slice(0, 20000)}\n[Attachment context truncated at 20,000 characters.]`
    : text;
}
