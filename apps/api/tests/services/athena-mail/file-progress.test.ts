import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { assertDefined } from '@docket/test-utils';
import { getDb } from '../../support/routes-harness';
import { enrolled } from './fixtures';
import { getContainer } from '../../../src/container';
import { mailboxAddress } from '../../../src/routes/athena-mail-store';
import { deliverInboundMail } from '../../../src/routes/inbound-mail-delivery';
import { prepareMailAttachments } from '../../../src/services/athena-mail/attachments';
import { sweepMailIngress } from '../../../src/services/athena-mail/ingress';
let schema: Awaited<ReturnType<typeof getDb>>;
beforeAll(async () => {
  schema = await getDb();
});
afterEach(() => {
  vi.restoreAllMocks();
});
const bytes = new TextEncoder().encode('Readable private text.');
async function received() {
  const { mailbox } = await enrolled(schema);
  const key = `file-progress-${Math.random()}`;
  await deliverInboundMail(
    {
      providerMessageId: key,
      rfc822MessageId: `<${key}@example.com>`,
      fromAddress: assertDefined(mailbox.ownerAddress),
      fromName: null,
      to: [assertDefined(mailboxAddress(mailbox))],
      cc: [],
      subject: 'Read both attachments',
      text: 'Compare the two files.',
      html: null,
      bodyStatus: 'complete',
      receivedAt: new Date().toISOString(),
      authentication: { spf: 'pass', dkim: 'pass', dmarc: 'pass' },
      attachments: [
        {
          id: 'first',
          filename: 'first.txt',
          contentType: 'text/plain',
          contentDisposition: 'attachment',
          contentId: null,
        },
        {
          id: 'second',
          filename: 'second.txt',
          contentType: 'text/plain',
          contentDisposition: 'attachment',
          contentId: null,
        },
      ],
    },
    'fixture',
  );
  const [message] = await schema.db
    .select()
    .from(schema.athenaInboundMessage)
    .where(eq(schema.athenaInboundMessage.providerMessageId, key));
  return assertDefined(message);
}
async function reload(id: string) {
  const [message] = await schema.db
    .select()
    .from(schema.athenaInboundMessage)
    .where(eq(schema.athenaInboundMessage.id, id));
  return assertDefined(message);
}
async function scheduledSweep() {
  return sweepMailIngress({
    run: async (_organizationId, sessionId) => {
      const [session] = await schema.db
        .select()
        .from(schema.agentSession)
        .where(eq(schema.agentSession.id, sessionId));
      return assertDefined(session);
    },
  });
}
describe('durable file progress in scheduled email admission', () => {
  it('preserves the first file across a later rate limit and admits only after the next sweep completes both', async () => {
    const message = await received();
    let limited = true;
    const retrieve = vi.fn(async (_emailId: string, attachmentId: string) => {
      if (attachmentId === 'second' && limited) {
        limited = false;
        throw new Error('Provider rate limit');
      }
      return bytes;
    });
    Object.assign(getContainer().inboundMail, { retrieveAttachment: retrieve });
    await scheduledSweep();
    const partial = await reload(message.id);
    expect(partial.processingStatus).toBe('pending');
    expect(partial.sessionId).toBeNull();
    expect(partial.attachments.map((file) => file.status)).toEqual(['ready', 'unavailable']);
    await scheduledSweep();
    const complete = await reload(message.id);
    expect(complete.processingStatus).toBe('running');
    expect(complete.sessionId).not.toBeNull();
    expect(complete.attachments.map((file) => file.status)).toEqual(['ready', 'ready']);
    expect(complete.attachments.every((file) => file.errorCode === undefined)).toBe(true);
    expect(retrieve.mock.calls.filter(([, file]) => file === 'first')).toHaveLength(1);
    expect(retrieve.mock.calls.filter(([, file]) => file === 'second')).toHaveLength(2);
    const activities = await schema.db
      .select()
      .from(schema.sessionActivity)
      .where(eq(schema.sessionActivity.sessionId, assertDefined(complete.sessionId)));
    expect(
      activities.some(
        (row) =>
          row.body.text?.includes('first.txt') &&
          row.body.text.includes('second.txt') &&
          row.body.text.includes('Readable private text.'),
      ),
    ).toBe(true);
  });
  it('keeps unavailable adapter files pending until retrieval capability is restored', async () => {
    const message = await received();
    const receiver = getContainer().inboundMail;
    const previous = receiver.retrieveAttachment?.bind(receiver);
    try {
      Object.assign(receiver, { retrieveAttachment: undefined });
      await scheduledSweep();
      const waiting = await reload(message.id);
      expect(waiting.sessionId).toBeNull();
      expect(waiting.processingStatus).toBe('pending');
      expect(waiting.attachments.every((file) => file.status === 'unavailable')).toBe(true);
      Object.assign(receiver, { retrieveAttachment: vi.fn(async () => bytes) });
      await scheduledSweep();
      const recovered = await reload(message.id);
      expect(recovered.sessionId).not.toBeNull();
      expect(recovered.attachments.every((file) => file.status === 'ready')).toBe(true);
      expect(recovered.attachments.every((file) => file.errorCode === undefined)).toBe(true);
    } finally {
      Object.assign(receiver, { retrieveAttachment: previous });
    }
  });
  it('keeps a completed sibling batch when a stale overlapping worker later records a temporary failure', async () => {
    const message = await received();
    let failFirst: (error: Error) => void = () => {
      throw new Error('Retrieval has not started');
    };
    let started: () => void = () => undefined;
    const firstStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const delayed = new Promise<Uint8Array>((_resolve, reject) => {
      failFirst = reject;
    });
    const retrieve = vi
      .fn()
      .mockImplementationOnce(() => {
        started();
        return delayed;
      })
      .mockResolvedValue(bytes);
    Object.assign(getContainer().inboundMail, { retrieveAttachment: retrieve });
    const stale = prepareMailAttachments(message).then(
      () => null,
      (error: unknown) => error,
    );
    await firstStarted;
    await prepareMailAttachments(message);
    failFirst(new Error('Late temporary provider failure'));
    expect(await stale).toBeInstanceOf(Error);
    expect((await reload(message.id)).attachments.map((file) => file.status)).toEqual([
      'ready',
      'ready',
    ]);
    await scheduledSweep();
    expect((await reload(message.id)).sessionId).not.toBeNull();
  });
});
