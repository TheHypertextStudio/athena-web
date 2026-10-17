import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { assertDefined } from '@docket/test-utils';
import { OrganizationId } from '@docket/identity-access/ids';
import { getDb } from '../../support/routes-harness';
import { enrolled, ownerOperation } from './fixtures';
import { getContainer } from '../../../src/container';
import { configureMailChannel } from '../../../src/services/athena-mail/channel';
import {
  mailAttachmentContext,
  mailAttachmentDigest,
  prepareMailAttachments,
  readMailAttachment,
  snapshotMailAttachment,
  sweepMailAttachmentBlobs,
} from '../../../src/services/athena-mail/attachments';
import { sweepMailOutbox } from '../../../src/services/athena-mail/outbox';
let schema: Awaited<ReturnType<typeof getDb>>;
beforeAll(async () => {
  schema = await getDb();
});
afterEach(() => {
  vi.restoreAllMocks();
});
const bytes = new TextEncoder().encode('Private attachment bytes.');
async function operation() {
  const owner = await enrolled(schema);
  const session = await ownerOperation(schema, owner.mailbox);
  const [message] = await schema.db
    .select()
    .from(schema.athenaInboundMessage)
    .where(eq(schema.athenaInboundMessage.sessionId, session.id));
  Object.assign(getContainer().inboundMail, { retrieveAttachment: vi.fn(async () => bytes) });
  return { ...owner, session, message: assertDefined(message) };
}
async function storedFile() {
  const current = await operation();
  const prepared = await prepareMailAttachments({
    ...current.message,
    attachments: [{ id: 'private-file', filename: 'notes.txt', contentType: 'text/plain' }],
  });
  const file = assertDefined(prepared.attachments[0]);
  const snapshot = await snapshotMailAttachment(
    current.owner,
    current.mailbox.id,
    current.mailbox.revision,
    { messageId: current.message.id, id: file.id, digest: assertDefined(file.digest) },
  );
  return { ...current, file, snapshot };
}
describe('file boundaries and recoverable private storage', () => {
  it('reads only the first five supported files and explains overflow without downloading it', async () => {
    const current = await operation();
    const retrieve = vi.fn(async () => bytes);
    Object.assign(getContainer().inboundMail, { retrieveAttachment: retrieve });
    const attachments = Array.from({ length: 6 }, (_, index) => ({
      id: `file-${index}`,
      filename: `notes-${index}.txt`,
      contentType: 'text/plain',
    }));
    const prepared = await prepareMailAttachments({ ...current.message, attachments });
    await prepareMailAttachments(prepared);
    expect(retrieve).toHaveBeenCalledTimes(5);
    expect(retrieve.mock.calls.some((call) => (call as unknown[])[1] === 'file-5')).toBe(false);
    const overflow = assertDefined(prepared.attachments[5]);
    expect(overflow.status).toBe('rejected');
    expect(overflow.blobKey).toBeUndefined();
    expect(overflow.extractedText).toBeUndefined();
    expect(mailAttachmentContext(prepared)).toContain(
      'notes-5.txt was not read (attachment_count_limit)',
    );
  });
  it('does not store or feed executable/binary payloads into Athena', async () => {
    const current = await operation();
    const retrieve = vi.fn(async () => new Uint8Array([0, 255, 0, 127]));
    Object.assign(getContainer().inboundMail, { retrieveAttachment: retrieve });
    const put = vi.spyOn(getContainer().blob, 'put');
    const prepared = await prepareMailAttachments({
      ...current.message,
      attachments: [
        { id: 'executable', filename: 'run.exe', contentType: 'application/octet-stream' },
        { id: 'binary', filename: 'fake.txt', contentType: 'text/plain' },
      ],
    });
    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(put).not.toHaveBeenCalled();
    expect(prepared.attachments.map((file) => file.errorCode)).toEqual([
      'attachment_unsupported',
      'attachment_invalid_text',
    ]);
    expect(
      prepared.attachments.every(
        (file) => file.status === 'rejected' && !file.blobKey && !file.extractedText,
      ),
    ).toBe(true);
    expect(mailAttachmentContext(prepared)).toContain('fake.txt was not read');
  });
  it('retries a transient provider outage without recording unread data as ready', async () => {
    const current = await operation();
    const retrieve = vi
      .fn()
      .mockRejectedValueOnce(new Error('Provider temporarily unavailable'))
      .mockResolvedValueOnce(bytes);
    Object.assign(getContainer().inboundMail, { retrieveAttachment: retrieve });
    const pending = {
      ...current.message,
      attachments: [{ id: 'file', filename: 'notes.txt', contentType: 'text/plain' }],
    };
    await expect(prepareMailAttachments(pending)).rejects.toThrow(
      'Provider temporarily unavailable',
    );
    expect(
      await schema.db
        .select()
        .from(schema.athenaMailBlob)
        .where(eq(schema.athenaMailBlob.messageId, current.message.id)),
    ).toHaveLength(0);
    const recovered = await prepareMailAttachments(pending);
    expect(recovered.attachments[0]?.status).toBe('ready');
    expect((await readMailAttachment(current.owner, current.message.id, 'file')).bytes).toEqual(
      bytes,
    );
  });
  it.each(['message', 'owner'] as const)(
    'recovers an interrupted upload after %s deletion without orphaning bytes',
    async (deletedSource) => {
      const current = await operation();
      const blob = getContainer().blob;
      const originalPut = blob.put.bind(blob);
      vi.spyOn(blob, 'put').mockImplementationOnce(async (key, data, type) => {
        await originalPut(key, data, type);
        throw new Error('Storage response lost after durable upload');
      });
      await expect(
        prepareMailAttachments({
          ...current.message,
          attachments: [{ id: 'file', filename: 'notes.txt', contentType: 'text/plain' }],
        }),
      ).rejects.toThrow('Storage response lost');
      const [intent] = await schema.db
        .select()
        .from(schema.athenaMailBlob)
        .where(eq(schema.athenaMailBlob.messageId, current.message.id));
      const key = assertDefined(intent).key;
      expect(await blob.get(key)).toEqual(bytes);
      if (deletedSource === 'owner')
        await schema.db.delete(schema.user).where(eq(schema.user.id, current.owner));
      else
        await schema.db
          .delete(schema.athenaInboundMessage)
          .where(eq(schema.athenaInboundMessage.id, current.message.id));
      // The grace prevents an immediate deletion from racing an interrupted uploader.
      await sweepMailAttachmentBlobs();
      expect(await blob.get(key)).toEqual(bytes);
      const deletion = vi
        .spyOn(blob, 'delete')
        .mockRejectedValueOnce(new Error('Storage unavailable'));
      const later = new Date(Date.now() + 3601_000);
      await sweepMailAttachmentBlobs(later);
      expect(
        await schema.db
          .select()
          .from(schema.athenaMailBlob)
          .where(eq(schema.athenaMailBlob.key, key)),
      ).toHaveLength(1);
      deletion.mockRestore();
      await sweepMailAttachmentBlobs(later);
      expect(await blob.get(key)).toBeNull();
      expect(
        await schema.db
          .select()
          .from(schema.athenaMailBlob)
          .where(eq(schema.athenaMailBlob.key, key)),
      ).toHaveLength(0);
    },
  );
  it.each(['digest', 'contentType', 'size'] as const)(
    'does not send a queued file whose approved %s was substituted',
    async (field) => {
      const current = await storedFile();
      const changed = { ...current.snapshot };
      if (field === 'digest') changed.digest = '0'.repeat(64);
      if (field === 'contentType') changed.contentType = 'text/csv';
      if (field === 'size') changed.size += 1;
      const [intent] = await schema.db
        .insert(schema.athenaMailOutbox)
        .values({
          ownerUserId: current.owner,
          mailboxId: current.mailbox.id,
          sessionId: current.session.id,
          channelRevision: current.mailbox.revision,
          toAddress: assertDefined(current.mailbox.ownerAddress),
          subject: 'Approval integrity check',
          bodyText: 'Do not send substituted attachments.',
          attachments: [changed],
        })
        .returning();
      const send = vi.spyOn(getContainer().mailer, 'send');
      await sweepMailOutbox();
      expect(
        send.mock.calls.some(
          ([message]) => message.idempotencyKey === `athena-mail-${assertDefined(intent).id}`,
        ),
      ).toBe(false);
      const [row] = await schema.db
        .select()
        .from(schema.athenaMailOutbox)
        .where(eq(schema.athenaMailOutbox.id, assertDefined(intent).id));
      expect(assertDefined(row).providerMessageId).toBeNull();
    },
  );
  it('blocks other owners, corrupted bytes and revoked access to a previously valid file', async () => {
    const current = await storedFile();
    expect(
      (await readMailAttachment(current.owner, current.message.id, current.file.id)).bytes,
    ).toEqual(bytes);
    const other = await enrolled(schema);
    await expect(
      readMailAttachment(other.owner, current.message.id, current.file.id),
    ).rejects.toThrow();
    const key = assertDefined(current.file.blobKey);
    await getContainer().blob.put(
      key,
      new TextEncoder().encode('Substituted private object'),
      'text/plain',
    );
    await expect(
      readMailAttachment(current.owner, current.message.id, current.file.id),
    ).rejects.toThrow();
    expect(mailAttachmentDigest(bytes)).toBe(current.file.digest);
    await getContainer().blob.put(key, bytes, 'text/plain');
    await configureMailChannel(current.owner, {
      enabled: false,
      ownerRepliesEnabled: false,
      organizationId: OrganizationId.parse(current.orgId),
    });
    await expect(
      readMailAttachment(current.owner, current.message.id, current.file.id),
    ).rejects.toThrow();
  });
});
