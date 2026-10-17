import { beforeAll, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { assertDefined } from '@docket/test-utils';
import { MailSendError } from '@docket/mail';
import { MockAgentTurnRuntime } from '@docket/athena/turn';
import { getDb } from '../../support/routes-harness';
import { enrolled, ownerOperation } from './fixtures';
import { getContainer } from '../../../src/container';
import { driveSession } from '../../../src/agent/loop';
import { prepareMailReplies, sweepMailOutbox } from '../../../src/services/athena-mail/outbox';
let schema: Awaited<ReturnType<typeof getDb>>;
beforeAll(async () => {
  schema = await getDb();
});

it.each([
  [new MailSendError(400), 'failed', 'provider_rejected'],
  [new MailSendError(429), 'queued', 'send_failed'],
  [new Error('Response lost after provider accepted message'), 'queued', 'send_failed'],
] as const)(
  'distinguishes confirmed rejection from retryable or uncertain sends (%s)',
  async (failure, status, code) => {
    const { mailbox, orgId } = await enrolled(schema);
    const session = await ownerOperation(schema, mailbox);
    await driveSession(orgId, session.id, {
      turnRuntime: new MockAgentTurnRuntime({
        script: [
          {
            message: { role: 'assistant', content: [{ type: 'text', text: 'Owner response.' }] },
            stopReason: 'end_turn',
          },
        ],
      }),
    });
    await prepareMailReplies();
    const [intent] = await schema.db
      .select()
      .from(schema.athenaMailOutbox)
      .where(eq(schema.athenaMailOutbox.sessionId, session.id));
    const send = vi.spyOn(getContainer().mailer, 'send').mockRejectedValue(failure);
    try {
      await sweepMailOutbox();
      const [result] = await schema.db
        .select()
        .from(schema.athenaMailOutbox)
        .where(eq(schema.athenaMailOutbox.id, assertDefined(intent).id));
      expect(assertDefined(result).status).toBe(status);
      expect(assertDefined(result).errorCode).toBe(code);
      expect(assertDefined(result).providerMessageId).toBeNull();
      const call = send.mock.calls.find(
        ([message]) => message.idempotencyKey === `athena-mail-${assertDefined(intent).id}`,
      );
      expect(call).toBeDefined();
      if (status === 'queued') {
        const firstMessage = assertDefined(call?.[0]);
        send.mockResolvedValue({
          ...firstMessage,
          id: `receipt-${assertDefined(intent).id}`,
          sentAt: new Date().toISOString(),
        });
        await sweepMailOutbox(new Date(Date.now() + 120_000));
        const attempts = send.mock.calls.filter(
          ([message]) => message.idempotencyKey === firstMessage.idempotencyKey,
        );
        expect(attempts).toHaveLength(2);
        expect(attempts[1]?.[0]).toEqual(firstMessage);
      }
    } finally {
      send.mockRestore();
    }
  },
);
