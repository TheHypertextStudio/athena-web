import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { assertDefined } from '@docket/test-utils';
import { getDb } from '../../support/routes-harness';
import { enrolled } from './fixtures';
import { getContainer } from '../../../src/container';
import { recordMailProviderEvent, sweepMailOutbox } from '../../../src/services/athena-mail/outbox';
let schema: Awaited<ReturnType<typeof getDb>>;
beforeAll(async () => {
  schema = await getDb();
});
afterEach(() => {
  vi.restoreAllMocks();
});
async function outgoing(id: string) {
  const [row] = await schema.db
    .select()
    .from(schema.athenaMailOutbox)
    .where(eq(schema.athenaMailOutbox.id, id));
  return assertDefined(row);
}
describe('queued delivery integrity across later changes and process recovery', () => {
  it.each(['recipient', 'subject', 'body', 'attachments', 'review-reopened'] as const)(
    'does not send an external effect after its approved %s changes',
    async (change) => {
      const { owner, orgId, mailbox } = await enrolled(schema);
      const [session] = await schema.db
        .insert(schema.agentSession)
        .values({
          executorKind: 'athena',
          ownerUserId: owner,
          contextOrganizationId: orgId,
          kind: 'chat',
          workLinkage: 'conversation',
          trigger: 'delegation',
          status: 'pending',
        })
        .returning();
      const input = {
        orgId,
        to: 'intended-recipient@example.com',
        subject: 'Approved subject',
        body: 'Approved complete body',
        attachments: [] as unknown[],
      };
      const action = {
        kind: 'send_email',
        summary: 'Send the reviewed email',
        toolCall: { connection: 'docket', tool: 'send_email', toolUseId: 'reviewed-mail', input },
      };
      const [approved] = await schema.db
        .insert(schema.sessionActivity)
        .values({
          sessionId: assertDefined(session).id,
          organizationId: null,
          type: 'action',
          approvalStatus: 'applied',
          body: { action },
        })
        .returning();
      const id = `email-action-${assertDefined(approved).id}`;
      await schema.db.insert(schema.athenaMailOutbox).values({
        id,
        ownerUserId: owner,
        mailboxId: mailbox.id,
        sessionId: assertDefined(session).id,
        channelRevision: mailbox.revision,
        toAddress: input.to,
        subject: input.subject,
        bodyText: input.body,
        externalRecipient: true,
      });
      const changed = { ...input };
      if (change === 'recipient') changed.to = 'different-recipient@example.com';
      if (change === 'subject') changed.subject = 'Different subject';
      if (change === 'body') changed.body = 'Different complete body';
      if (change === 'attachments')
        changed.attachments = [
          {
            messageId: 'added-message',
            id: 'added-file',
            digest: '0'.repeat(64),
            filename: 'new-file.txt',
            contentType: 'text/plain',
            size: 100,
          },
        ];
      await schema.db
        .update(schema.sessionActivity)
        .set({
          approvalStatus: change === 'review-reopened' ? 'proposed' : 'applied',
          body: { action: { ...action, toolCall: { ...action.toolCall, input: changed } } },
        })
        .where(eq(schema.sessionActivity.id, assertDefined(approved).id));
      const send = vi.spyOn(getContainer().mailer, 'send');
      await sweepMailOutbox();
      const result = await outgoing(id);
      expect(result.status).toBe('canceled');
      expect(result.errorCode).toBe('approval_revoked');
      expect(result.providerMessageId).toBeNull();
      expect(
        send.mock.calls.some(([message]) => message.idempotencyKey === `athena-mail-${id}`),
      ).toBe(false);
    },
  );
  it('honors an active delivery lease and recovers the same intent only after its process lease expires', async () => {
    const { owner, mailbox } = await enrolled(schema);
    const now = new Date();
    const [intent] = await schema.db
      .insert(schema.athenaMailOutbox)
      .values({
        ownerUserId: owner,
        mailboxId: mailbox.id,
        channelRevision: mailbox.revision,
        toAddress: assertDefined(mailbox.ownerAddress),
        subject: 'Recover one interrupted send',
        bodyText: 'Send once using the same durable identity.',
        status: 'sending',
        attempts: 1,
        firstAttemptAt: new Date(now.getTime() - 120_000),
        leaseToken: 'other-live-process',
        leaseExpiresAt: new Date(now.getTime() + 60_000),
      })
      .returning();
    const id = assertDefined(intent).id;
    const send = vi.spyOn(getContainer().mailer, 'send');
    await sweepMailOutbox(now);
    expect((await outgoing(id)).status).toBe('sending');
    expect((await outgoing(id)).attempts).toBe(1);
    expect(
      send.mock.calls.some(([message]) => message.idempotencyKey === `athena-mail-${id}`),
    ).toBe(false);
    await sweepMailOutbox(new Date(now.getTime() + 61_000));
    const recovered = await outgoing(id);
    expect(recovered.status).toBe('sent');
    expect(recovered.providerMessageId).not.toBeNull();
    expect(
      send.mock.calls.filter(([message]) => message.idempotencyKey === `athena-mail-${id}`),
    ).toHaveLength(1);
    await sweepMailOutbox(new Date(now.getTime() + 180_000));
    expect(
      send.mock.calls.filter(([message]) => message.idempotencyKey === `athena-mail-${id}`),
    ).toHaveLength(1);
  });
  it.each(['delivered', 'bounced'] as const)(
    'resolves a parked uncertain send from an authenticated %s receipt without resending',
    async (receipt) => {
      const { owner, mailbox } = await enrolled(schema);
      const providerMessageId = `late-receipt-${Math.random()}`;
      const [intent] = await schema.db
        .insert(schema.athenaMailOutbox)
        .values({
          ownerUserId: owner,
          mailboxId: mailbox.id,
          channelRevision: mailbox.revision,
          toAddress: assertDefined(mailbox.ownerAddress),
          subject: 'Await provider evidence',
          bodyText: 'Already possibly delivered.',
          status: 'uncertain',
          errorCode: 'idempotency_expired',
          providerMessageId,
          firstAttemptAt: new Date(Date.now() - 25 * 3600_000),
        })
        .returning();
      const id = assertDefined(intent).id;
      const send = vi.spyOn(getContainer().mailer, 'send');
      await recordMailProviderEvent(providerMessageId, receipt, `late-event-${Math.random()}`);
      expect((await outgoing(id)).status).toBe(receipt);
      await sweepMailOutbox();
      expect((await outgoing(id)).status).toBe(receipt);
      expect(
        send.mock.calls.some(([message]) => message.idempotencyKey === `athena-mail-${id}`),
      ).toBe(false);
    },
  );
});
