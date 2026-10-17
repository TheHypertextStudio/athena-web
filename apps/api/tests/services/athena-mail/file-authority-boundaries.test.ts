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
  mailElicitationAttachmentContext,
  prepareMailAttachments,
  readMailAttachment,
  resolveOutboundAttachments,
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
const bytes = new TextEncoder().encode('Exact reviewed private content.');
async function operation() {
  const current = await enrolled(schema);
  const session = await ownerOperation(schema, current.mailbox);
  const [message] = await schema.db
    .select()
    .from(schema.athenaInboundMessage)
    .where(eq(schema.athenaInboundMessage.sessionId, session.id));
  Object.assign(getContainer().inboundMail, { retrieveAttachment: vi.fn(async () => bytes) });
  return { ...current, session, message: assertDefined(message) };
}
async function reviewedFile() {
  const current = await operation();
  const prepared = await prepareMailAttachments({
    ...current.message,
    attachments: [{ id: 'file', filename: 'notes.txt', contentType: 'text/plain' }],
  });
  const snapshot = await snapshotMailAttachment(
    current.owner,
    current.mailbox.id,
    current.mailbox.revision,
    {
      messageId: current.message.id,
      id: 'file',
      digest: assertDefined(prepared.attachments[0]?.digest),
    },
  );
  const input = {
    orgId: current.orgId,
    to: 'reviewed-recipient@example.com',
    subject: 'Reviewed file',
    body: 'Here is the exact reviewed attachment.',
    attachments: [snapshot],
  };
  const action = {
    kind: 'send_email',
    summary: 'Send the reviewed private file',
    toolCall: { connection: 'docket', tool: 'send_email', toolUseId: 'file-effect', input },
  };
  const [approved] = await schema.db
    .insert(schema.sessionActivity)
    .values({
      sessionId: current.session.id,
      organizationId: null,
      type: 'action',
      approvalStatus: 'applied',
      body: { action },
    })
    .returning();
  const id = `email-action-${assertDefined(approved).id}`;
  await schema.db.insert(schema.athenaMailOutbox).values({
    id,
    ownerUserId: current.owner,
    mailboxId: current.mailbox.id,
    sessionId: current.session.id,
    channelRevision: current.mailbox.revision,
    toAddress: input.to,
    subject: input.subject,
    bodyText: input.body,
    attachments: [snapshot],
    externalRecipient: true,
  });
  return { ...current, snapshot, input, action, approved: assertDefined(approved), id };
}
describe('reviewed attachment identity and private source recovery', () => {
  it('sends the exact reviewed private bytes once through the approved external action', async () => {
    const current = await reviewedFile();
    const send = vi.spyOn(getContainer().mailer, 'send');
    await sweepMailOutbox();
    await sweepMailOutbox();
    const attempts = send.mock.calls.filter(
      ([mail]) => mail.idempotencyKey === `athena-mail-${current.id}`,
    );
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.[0].attachments).toEqual([
      {
        filename: 'notes.txt',
        content: Buffer.from(bytes).toString('base64'),
        content_type: 'text/plain',
      },
    ]);
  });
  it.each(['messageId', 'id', 'digest', 'filename', 'contentType', 'size'] as const)(
    'does not send a file after approved %s is changed',
    async (field) => {
      const current = await reviewedFile();
      const changed = { ...current.snapshot };
      if (field === 'size') changed.size += 1;
      else changed[field] = field === 'digest' ? '0'.repeat(64) : `changed-${changed[field]}`;
      await schema.db
        .update(schema.sessionActivity)
        .set({
          body: {
            action: {
              ...current.action,
              toolCall: {
                ...current.action.toolCall,
                input: { ...current.input, attachments: [changed] },
              },
            },
          },
        })
        .where(eq(schema.sessionActivity.id, current.approved.id));
      const send = vi.spyOn(getContainer().mailer, 'send');
      await sweepMailOutbox();
      const [result] = await schema.db
        .select()
        .from(schema.athenaMailOutbox)
        .where(eq(schema.athenaMailOutbox.id, current.id));
      expect(assertDefined(result).status).toBe('canceled');
      expect(assertDefined(result).errorCode).toBe('approval_revoked');
      expect(
        send.mock.calls.some(([mail]) => mail.idempotencyKey === `athena-mail-${current.id}`),
      ).toBe(false);
    },
  );
  it('refuses an unreadable malformed approved file entry instead of sending the queued private file', async () => {
    const current = await reviewedFile();
    await schema.db
      .update(schema.sessionActivity)
      .set({
        body: {
          action: {
            ...current.action,
            toolCall: {
              ...current.action.toolCall,
              input: { ...current.input, attachments: [null] },
            },
          },
        },
      })
      .where(eq(schema.sessionActivity.id, current.approved.id));
    const send = vi.spyOn(getContainer().mailer, 'send');
    await sweepMailOutbox();
    expect(
      send.mock.calls.some(([mail]) => mail.idempotencyKey === `athena-mail-${current.id}`),
    ).toBe(false);
  });
  it('rejects provider-controlled URLs that fail security validation without storing or reading their contents', async () => {
    const current = await operation();
    Object.assign(getContainer().inboundMail, {
      retrieveAttachment: vi.fn(async () => {
        throw new Error('attachment_invalid_url');
      }),
    });
    const put = vi.spyOn(getContainer().blob, 'put');
    const prepared = await prepareMailAttachments({
      ...current.message,
      attachments: [{ id: 'file', filename: 'notes.txt', contentType: 'text/plain' }],
    });
    expect(prepared.attachments[0]?.status).toBe('rejected');
    expect(prepared.attachments[0]?.errorCode).toBe('attachment_rejected');
    expect(put).not.toHaveBeenCalled();
    expect(mailAttachmentContext(prepared)).toContain('was not read');
  });
  it('leaves recoverable storage intent when a message is deleted while its file download is in flight', async () => {
    const current = await operation();
    let release: (value: Uint8Array) => void = () => {
      throw new Error('Download not initialized');
    };
    let started: () => void = () => {
      throw new Error('Download not initialized');
    };
    const began = new Promise<void>((resolve) => {
      started = resolve;
    });
    const pending = new Promise<Uint8Array>((resolve) => {
      release = resolve;
    });
    Object.assign(getContainer().inboundMail, {
      retrieveAttachment: vi.fn(() => {
        started();
        return pending;
      }),
    });
    const preparation = prepareMailAttachments({
      ...current.message,
      attachments: [{ id: 'file', filename: 'notes.txt', contentType: 'text/plain' }],
    }).then(
      () => null,
      (error: unknown) => error,
    );
    await began;
    await schema.db
      .delete(schema.athenaInboundMessage)
      .where(eq(schema.athenaInboundMessage.id, current.message.id));
    release(bytes);
    expect(await preparation).toBeInstanceOf(Error);
    const [intent] = await schema.db
      .select()
      .from(schema.athenaMailBlob)
      .where(eq(schema.athenaMailBlob.messageId, current.message.id));
    const key = assertDefined(intent).key;
    expect(await getContainer().blob.get(key)).toEqual(bytes);
    await sweepMailAttachmentBlobs(new Date(Date.now() + 3601_000));
    expect(await getContainer().blob.get(key)).toBeNull();
  });
  it('does not download new private files after consent is revoked', async () => {
    const current = await operation();
    const retrieve = vi.fn(async () => bytes);
    Object.assign(getContainer().inboundMail, { retrieveAttachment: retrieve });
    await configureMailChannel(current.owner, {
      enabled: false,
      ownerRepliesEnabled: false,
      organizationId: OrganizationId.parse(current.orgId),
    });
    await expect(
      prepareMailAttachments({
        ...current.message,
        attachments: [{ id: 'file', filename: 'notes.txt', contentType: 'text/plain' }],
      }),
    ).rejects.toThrow();
    expect(retrieve).not.toHaveBeenCalled();
  });
  it('enforces the outgoing file-count limit even when each private reference is otherwise valid', async () => {
    const current = await reviewedFile();
    await expect(
      resolveOutboundAttachments(
        current.owner,
        current.mailbox.id,
        current.mailbox.revision,
        Array.from({ length: 6 }, () => current.snapshot),
      ),
    ).rejects.toThrow('Attachment limit exceeded');
  });
  it('does not expose a ready file when its private object is missing', async () => {
    const current = await reviewedFile();
    const [message] = await schema.db
      .select()
      .from(schema.athenaInboundMessage)
      .where(eq(schema.athenaInboundMessage.id, current.message.id));
    await getContainer().blob.delete(assertDefined(assertDefined(message).attachments[0]?.blobKey));
    await expect(readMailAttachment(current.owner, current.message.id, 'file')).rejects.toThrow();
  });
  it('bounds continuation attachment previews and excludes context from other questions', async () => {
    const current = await operation();
    const question = `file-question-${Math.random()}`;
    await schema.db.insert(schema.sessionActivity).values([
      {
        id: `mail-attachment-context:${current.message.id}:current`,
        sessionId: current.session.id,
        organizationId: null,
        type: 'response',
        body: {
          author: 'user',
          provenance: 'email',
          elicitationId: question,
          text: 'x'.repeat(25000) + 'PRIVATE OMITTED TAIL',
        },
      },
      {
        id: `mail-attachment-context:${current.message.id}:other`,
        sessionId: current.session.id,
        organizationId: null,
        type: 'response',
        body: {
          author: 'user',
          provenance: 'email',
          elicitationId: 'other-question',
          text: 'OTHER QUESTION PRIVATE FILE',
        },
      },
    ]);
    const context = await mailElicitationAttachmentContext(current.session.id, question);
    expect(context).toContain('Attachment context truncated at 20,000 characters');
    expect(context).not.toContain('PRIVATE OMITTED TAIL');
    expect(context).not.toContain('OTHER QUESTION PRIVATE FILE');
  });
});
