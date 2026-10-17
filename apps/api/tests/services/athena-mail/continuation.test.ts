import { loadTranscript } from '../../../src/agent/transcript';
import { beforeAll, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { assertDefined } from '@docket/test-utils';
import { MockAgentTurnRuntime } from '@docket/athena/turn';
import { getDb } from '../../support/routes-harness';
import { enrolled, ownerOperation } from './fixtures';
import { driveSession } from '../../../src/agent/loop';
import { claimRunGeneration } from '../../../src/agent/run-generation';
import {
  continueMailQuestion,
  prepareMailContinuation,
} from '../../../src/services/athena-mail/continuation';
import { prepareMailReplies } from '../../../src/services/athena-mail/outbox';
import { sweepMailIngress } from '../../../src/services/athena-mail/ingress';
let schema: Awaited<ReturnType<typeof getDb>>;
beforeAll(async () => {
  schema = await getDb();
});

async function waitingQuestion() {
  const { mailbox, orgId } = await enrolled(schema);
  const session = await ownerOperation(schema, mailbox);
  const runtime = new MockAgentTurnRuntime({
    script: [
      {
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'recovery-question',
              name: 'ask_user',
              input: {
                question: 'Which venue?',
                actionSummary: 'Choose venue',
              },
            },
          ],
        },
        stopReason: 'tool_use',
      },
    ],
  });
  await driveSession(orgId, session.id, { turnRuntime: runtime });
  await prepareMailReplies();
  const [question] = await schema.db
    .select()
    .from(schema.agentElicitation)
    .where(eq(schema.agentElicitation.sessionId, session.id));
  const [original] = await schema.db
    .select()
    .from(schema.athenaInboundMessage)
    .where(eq(schema.athenaInboundMessage.sessionId, session.id));
  return {
    mailbox,
    orgId,
    session,
    question: assertDefined(question),
    original: assertDefined(original),
  };
}

it('keeps the original operation recoverable when inline answer execution crashes', async () => {
  const { original, session, question } = await waitingQuestion();
  const [reply] = await schema.db
    .insert(schema.athenaInboundMessage)
    .values({
      ownerUserId: original.ownerUserId,
      mailboxId: original.mailboxId,
      organizationId: original.organizationId,
      provider: 'fixture',
      providerMessageId: `crash-${session.id}`,
      fromAddress: original.fromAddress,
      toAddress: original.toAddress,
      title: 'Re: Help',
      bodyText: 'Downtown',
      attachments: [
        {
          id: 'venue-notes',
          filename: 'venue.txt',
          contentType: 'text/plain',
          status: 'ready',
          digest: 'a'.repeat(64),
          size: 21,
          extractedText: 'Venue seats 40 people.',
        },
      ],
      processingStatus: 'answering',
      sessionId: session.id,
      threadId: question.id,
      channelRevision: original.channelRevision,
      authentication: { spf: 'pass', dkim: 'pass', dmarc: 'pass' },
    })
    .returning();
  await expect(
    continueMailQuestion(assertDefined(reply), async () => {
      const lease = await claimRunGeneration(session, { runnableStatuses: ['awaiting_input'] });
      await schema.db
        .update(schema.agentSessionRun)
        .set({ leaseExpiresAt: new Date(0) })
        .where(eq(schema.agentSessionRun.id, lease.runId));
      throw new Error('Simulated process crash');
    }),
  ).rejects.toThrow('Simulated process crash');
  const [stored] = await schema.db
    .select()
    .from(schema.athenaInboundMessage)
    .where(eq(schema.athenaInboundMessage.id, original.id));
  expect(assertDefined(stored).processingStatus).toBe('running');
  const recovery = new MockAgentTurnRuntime({
    script: [
      {
        message: { role: 'assistant', content: [{ type: 'text', text: 'Earlier question turn.' }] },
        stopReason: 'end_turn',
      },
      {
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Recovered the owner answer.' }],
        },
        stopReason: 'end_turn',
      },
    ],
  });
  await sweepMailIngress({
    run: async (org, id) => driveSession(org, id, { turnRuntime: recovery }),
  });
  const [settled] = await schema.db
    .select()
    .from(schema.agentSession)
    .where(eq(schema.agentSession.id, session.id));
  expect(assertDefined(settled).status).toBe('completed');
  expect(JSON.stringify(await loadTranscript(schema.db, session.id))).toContain(
    'Venue seats 40 people.',
  );
  const [answeredQuestion] = await schema.db
    .select()
    .from(schema.agentElicitation)
    .where(eq(schema.agentElicitation.id, question.id));
  expect(assertDefined(answeredQuestion).answer).toBe('Downtown');
});

it('threads replies to invalid-answer notices back to the same pending question', async () => {
  const { original, session, question, mailbox } = await waitingQuestion();
  await schema.db
    .update(schema.agentElicitation)
    .set({
      spec: {
        kind: 'text',
        multiline: false,
        minLength: 1,
        maxLength: 20,
        placeholder: null,
      },
    })
    .where(eq(schema.agentElicitation.id, question.id));
  const [reply] = await schema.db
    .insert(schema.athenaInboundMessage)
    .values({
      ownerUserId: original.ownerUserId,
      mailboxId: mailbox.id,
      organizationId: original.organizationId,
      provider: 'fixture',
      providerMessageId: `invalid-${session.id}`,
      fromAddress: original.fromAddress,
      toAddress: original.toAddress,
      title: 'Re: Help',
      rfc822MessageId: `<invalid-${session.id}@example.com>`,
      bodyText: 'An answer that is far too long for the question',
      processingStatus: 'answering',
      sessionId: session.id,
      threadId: question.id,
      channelRevision: mailbox.revision,
      authentication: { spf: 'pass', dkim: 'pass', dmarc: 'pass' },
    })
    .returning();
  await continueMailQuestion(assertDefined(reply));
  const [notice] = await schema.db
    .select()
    .from(schema.athenaMailOutbox)
    .where(eq(schema.athenaMailOutbox.inboundMessageId, assertDefined(reply).id));
  expect(assertDefined(notice).headers['Message-ID']).toContain('invalid-answer');
  expect(assertDefined(notice).headers['In-Reply-To']).toBe(assertDefined(reply).rfc822MessageId);
  const [retry] = await schema.db
    .insert(schema.athenaInboundMessage)
    .values({
      ownerUserId: original.ownerUserId,
      mailboxId: mailbox.id,
      organizationId: original.organizationId,
      provider: 'fixture',
      providerMessageId: `retry-${session.id}`,
      fromAddress: original.fromAddress,
      toAddress: original.toAddress,
      title: 'Re: Help',
      bodyText: 'Downtown',
      processingStatus: 'pending',
      channelRevision: mailbox.revision,
      headers: { 'in-reply-to': assertDefined(notice).headers['Message-ID'] ?? '' },
    })
    .returning();
  expect(await prepareMailContinuation(assertDefined(retry), mailbox)).toBe(true);
  const [correlated] = await schema.db
    .select()
    .from(schema.athenaInboundMessage)
    .where(eq(schema.athenaInboundMessage.id, assertDefined(retry).id));
  expect(assertDefined(correlated).threadId).toBe(question.id);
  expect(assertDefined(correlated).sessionId).toBe(session.id);
});
