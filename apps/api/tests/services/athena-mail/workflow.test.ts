import { OrganizationId } from '@docket/identity-access/ids';
import { enrolled, ownerOperation } from './fixtures';
import { assertDefined } from '@docket/test-utils';
import { vi } from 'vitest';
import { answerElicitation } from '../../../src/services/elicitation-service';
import { getContainer } from '../../../src/container';
import { claimRunGeneration } from '../../../src/agent/run-generation';
import { resumeSessionExecution } from '../../../src/agent/loop';
import {
  continueMailQuestion,
  resumeMailQuestion,
} from '../../../src/services/athena-mail/continuation';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerAthenaMailTools } from '../../../src/mcp/athena-mail-tools';
import { internalUserContext } from '../../../src/mcp/internal-session';
import { MockAgentTurnRuntime } from '@docket/athena/turn';
import { driveSession, approveAndResume } from '../../../src/agent/loop';
import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '../../support/routes-harness';
import {
  configureMailChannel,
  mailChannelAuthority,
} from '../../../src/services/athena-mail/channel';
import { deliverInboundMail } from '../../../src/routes/inbound-mail-delivery';
import { mailboxAddress } from '../../../src/routes/athena-mail-store';
import { sweepMailIngress } from '../../../src/services/athena-mail/ingress';
import {
  prepareMailReplies,
  recordMailProviderEvent,
  sweepMailOutbox,
  reconcileMailProviderEvents,
} from '../../../src/services/athena-mail/outbox';
let schema: Awaited<ReturnType<typeof getDb>>;
beforeAll(async () => {
  schema = await getDb();
});
describe('native owner email workflow without a client connection', () => {
  it('stores once, admits isolated owner work, sends only to enrolled owner, and reconciles callbacks', async () => {
    const { owner, orgId, mailbox } = await enrolled(schema);
    const message = {
      providerMessageId: `in-${mailbox.id}`,
      rfc822MessageId: `<in-${mailbox.id}@example.com>`,
      fromAddress: assertDefined(mailbox.ownerAddress),
      fromName: null,
      to: [assertDefined(mailboxAddress(mailbox))],
      cc: ['stranger@example.com'],
      subject: 'What needs attention?',
      text: 'Summarize my priorities',
      html: null,
      bodyStatus: 'complete' as const,
      receivedAt: new Date().toISOString(),
      attachments: [],
      authentication: { spf: 'pass', dkim: 'pass', dmarc: 'pass' },
      headers: { 'reply-to': 'stranger@example.com' },
    };
    const first = await deliverInboundMail(message, 'fixture');
    expect(first.status).toBe('delivered');
    expect((await deliverInboundMail(message, 'fixture')).status).toBe('duplicate');
    await sweepMailIngress();
    const [inbound] = await schema.db
      .select()
      .from(schema.athenaInboundMessage)
      .where(eq(schema.athenaInboundMessage.providerMessageId, message.providerMessageId));
    expect(assertDefined(inbound).sessionId).not.toBeNull();
    const [session] = await schema.db
      .select()
      .from(schema.agentSession)
      .where(eq(schema.agentSession.id, assertDefined(assertDefined(inbound).sessionId)));
    expect(assertDefined(session).externalRunRef).toBe(`athena-mail:${assertDefined(inbound).id}`);
    await driveSession(orgId, assertDefined(session).id, {
      turnRuntime: new MockAgentTurnRuntime({
        script: [
          {
            message: {
              role: 'assistant',
              content: [{ type: 'text', text: 'Your launch needs the final decision.' }],
            },
            stopReason: 'end_turn',
          },
        ],
      }),
    });
    await prepareMailReplies();
    await prepareMailReplies();
    const outbox = await schema.db
      .select()
      .from(schema.athenaMailOutbox)
      .where(eq(schema.athenaMailOutbox.ownerUserId, owner));
    expect(outbox).toHaveLength(1);
    expect(assertDefined(outbox[0]).toAddress).toBe(mailbox.ownerAddress);
    expect(assertDefined(outbox[0]).bodyText).toContain('Your launch');
    await sweepMailOutbox();
    const [sent] = await schema.db
      .select()
      .from(schema.athenaMailOutbox)
      .where(eq(schema.athenaMailOutbox.id, assertDefined(outbox[0]).id));
    expect(assertDefined(sent).status).toBe('sent');
    await recordMailProviderEvent(
      assertDefined(assertDefined(sent).providerMessageId),
      'delivered',
    );
    const [delivered] = await schema.db
      .select()
      .from(schema.athenaMailOutbox)
      .where(eq(schema.athenaMailOutbox.id, assertDefined(sent).id));
    expect(assertDefined(delivered).status).toBe('delivered');
    await recordMailProviderEvent('racing-provider-id', 'bounced');
    await schema.db
      .update(schema.athenaMailOutbox)
      .set({ providerMessageId: 'racing-provider-id', status: 'sent' })
      .where(eq(schema.athenaMailOutbox.id, assertDefined(sent).id));
    await reconcileMailProviderEvents();
    const [bounced] = await schema.db
      .select()
      .from(schema.athenaMailOutbox)
      .where(eq(schema.athenaMailOutbox.id, assertDefined(sent).id));
    expect(assertDefined(bounced).status).toBe('bounced');
    expect(orgId).toBe(assertDefined(inbound).organizationId);
  });
  it('loses channel authority when membership is archived', async () => {
    const { mailbox, humanActorId } = await enrolled(schema);
    expect(await mailChannelAuthority(mailbox.id)).not.toBeNull();
    await schema.db
      .update(schema.actor)
      .set({ archivedAt: new Date() })
      .where(eq(schema.actor.id, humanActorId));
    expect(await mailChannelAuthority(mailbox.id)).toBeNull();
  });
  it('requires exact signed-in approval for external recipients and cancels queued delivery after revocation', async () => {
    const { owner, orgId, mailbox, humanActorId } = await enrolled(schema);
    const session = await ownerOperation(schema, mailbox);
    const server = new McpServer(
      { name: 'mail-test', version: '1' },
      { capabilities: { tools: {} } },
    );
    registerAthenaMailTools(server, await internalUserContext(owner), session.id);
    const client = new Client({ name: 'mail-test', version: '1' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(st), client.connect(ct)]);
    const input = {
      orgId,
      to: 'colleague@example.com',
      subject: 'Launch decision',
      body: 'Please approve the launch.',
    };
    try {
      expect((await client.callTool({ name: 'send_email', arguments: input })).isError).toBe(true);
      const runtime = new MockAgentTurnRuntime({
        script: [
          {
            message: {
              role: 'assistant',
              content: [{ type: 'tool_use', id: 'email-tool-1', name: 'send_email', input }],
            },
            stopReason: 'tool_use',
          },
          {
            message: {
              role: 'assistant',
              content: [{ type: 'text', text: 'The approved email is queued.' }],
            },
            stopReason: 'end_turn',
          },
        ],
      });
      const paused = await driveSession(orgId, session.id, { turnRuntime: runtime });
      expect(paused.status).toBe('awaiting_approval');
      const [proposal] = await schema.db
        .select()
        .from(schema.sessionActivity)
        .where(eq(schema.sessionActivity.sessionId, session.id))
        .then((rows) => rows.filter((row) => row.type === 'action'));
      expect(assertDefined(proposal).approvalStatus).toBe('proposed');
      expect(
        (
          await client.callTool({
            name: 'send_email',
            arguments: { ...input, body: 'Different content' },
          })
        ).isError,
      ).toBe(true);
      await approveAndResume(
        orgId,
        humanActorId,
        session.id,
        assertDefined(proposal).id,
        { decision: 'approve' },
        { turnRuntime: runtime },
      );
      const queued = await schema.db
        .select()
        .from(schema.athenaMailOutbox)
        .where(eq(schema.athenaMailOutbox.sessionId, session.id));
      expect(queued).toHaveLength(1);
      expect(assertDefined(queued[0]).bodyText).toBe(input.body);
      expect(assertDefined(queued[0]).externalRecipient).toBe(true);
      await configureMailChannel(owner, {
        enabled: false,
        ownerRepliesEnabled: false,
        organizationId: OrganizationId.parse(orgId),
      });
      await sweepMailOutbox();
      const [canceled] = await schema.db
        .select()
        .from(schema.athenaMailOutbox)
        .where(eq(schema.athenaMailOutbox.id, assertDefined(queued[0]).id));
      expect(assertDefined(canceled).status).toBe('canceled');
    } finally {
      await client.close();
      await server.close();
    }
  });
  it('emails a text question and continues the same operation from the owner reply', async () => {
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
                id: 'mail-question',
                name: 'ask_user',
                input: { question: 'Which venue?', actionSummary: 'Choose venue' },
              },
            ],
          },
          stopReason: 'tool_use',
        },
        {
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'I will use the downtown venue.' }],
          },
          stopReason: 'end_turn',
        },
      ],
    });
    await driveSession(orgId, session.id, { turnRuntime: runtime });
    await prepareMailReplies();
    const [questionMail] = await schema.db
      .select()
      .from(schema.athenaMailOutbox)
      .where(eq(schema.athenaMailOutbox.sessionId, session.id));
    expect(assertDefined(questionMail).bodyText).toContain('Which venue?');
    const key = `answer-${session.id}`;
    await deliverInboundMail(
      {
        providerMessageId: key,
        rfc822MessageId: `<${key}@example.com>`,
        fromAddress: assertDefined(mailbox.ownerAddress),
        fromName: null,
        to: [assertDefined(mailboxAddress(mailbox))],
        cc: [],
        subject: 'Re: Help me',
        text: 'The downtown venue.\nOn Friday, Athena wrote:\nWhich venue?',
        html: null,
        bodyStatus: 'complete',
        receivedAt: new Date().toISOString(),
        attachments: [],
        authentication: { spf: 'pass', dkim: 'pass', dmarc: 'pass' },
        headers: {
          'in-reply-to': assertDefined(assertDefined(questionMail).headers['Message-ID']),
        },
      },
      'fixture',
    );
    await sweepMailIngress();
    const [answer] = await schema.db
      .select()
      .from(schema.athenaInboundMessage)
      .where(eq(schema.athenaInboundMessage.providerMessageId, key));
    expect(assertDefined(answer).sessionId).toBe(session.id);
    expect(assertDefined(answer).processingStatus).toBe('answering');
    await continueMailQuestion(assertDefined(answer), async (id, org) =>
      resumeSessionExecution(org, id, { turnRuntime: runtime }),
    );
    const [question] = await schema.db
      .select()
      .from(schema.agentElicitation)
      .where(eq(schema.agentElicitation.sessionId, session.id));
    expect(assertDefined(question).answer).toBe('The downtown venue.');
    await prepareMailReplies();
    const responses = await schema.db
      .select()
      .from(schema.athenaMailOutbox)
      .where(eq(schema.athenaMailOutbox.sessionId, session.id));
    expect(responses).toHaveLength(2);
    expect(responses.map((row) => row.bodyText).join(' ')).toContain(
      'I will use the downtown venue.',
    );
  });
  it('persists an asynchronous wake and tolerates consumed-answer replay', async () => {
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
                id: 'async-mail-question',
                name: 'ask_user',
                input: { question: 'Which venue?', actionSummary: 'Choose venue' },
              },
            ],
          },
          stopReason: 'tool_use',
        },
      ],
    });
    await driveSession(orgId, session.id, { turnRuntime: runtime });
    const [question] = await schema.db
      .select()
      .from(schema.agentElicitation)
      .where(eq(schema.agentElicitation.sessionId, session.id));
    const q = assertDefined(question);
    await answerElicitation({
      elicitationId: q.id,
      userId: assertDefined(mailbox.ownerUserId),
      value: 'Downtown',
    });
    const transport = vi.fn(
      async (_input: URL, _init: RequestInit) => new Response('', { status: 202 }),
    );
    const dependencies = {
      config: {
        APP_MODE: 'staging' as const,
        ATHENA_ASYNC_RUNNER_ENABLED: true,
        CLOUDFLARE_ATHENA_RUNNER_URL: 'https://runner.example.com',
        DOCKET_TO_CLOUDFLARE_HMAC_SECRET: 'test-mail-wake-secret',
      },
      fetch: transport,
    };
    await resumeMailQuestion(session.id, orgId, q.id, dependencies);
    const dispatches = await schema.db.select().from(schema.agentSessionDispatch);
    const wake = dispatches.find((row) => row.action === 'wake');
    expect(wake).toBeDefined();
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0]?.[0].pathname).toBe('/wake');
    await schema.db
      .update(schema.agentSessionRun)
      .set({ status: 'completed' })
      .where(eq(schema.agentSessionRun.sessionId, session.id));
    await resumeMailQuestion(session.id, orgId, q.id, dependencies);
    expect(transport).toHaveBeenCalledTimes(1);
    // A later question must never be woken by replaying this earlier answer.
    await schema.db
      .update(schema.agentElicitation)
      .set({ id: `later-${q.id}` })
      .where(eq(schema.agentElicitation.id, q.id));
    await schema.db
      .update(schema.agentSessionRun)
      .set({ status: 'waiting' })
      .where(eq(schema.agentSessionRun.sessionId, session.id));
    await resumeMailQuestion(session.id, orgId, q.id, dependencies);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('recovers a running job after its previous process lease expires', async () => {
    const { mailbox, orgId } = await enrolled(schema);
    const session = await ownerOperation(schema, mailbox);
    const lease = await claimRunGeneration(session);
    await schema.db
      .update(schema.agentSessionRun)
      .set({ leaseExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.agentSessionRun.id, lease.runId));
    const runtime = new MockAgentTurnRuntime({
      script: [
        {
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'Recovered the interrupted request.' }],
          },
          stopReason: 'end_turn',
        },
      ],
    });
    await sweepMailIngress({
      run: async (org, id) => driveSession(org, id, { turnRuntime: runtime }),
    });
    const [recovered] = await schema.db
      .select()
      .from(schema.agentSession)
      .where(eq(schema.agentSession.id, session.id));
    expect(assertDefined(recovered).status).toBe('completed');
    expect(assertDefined(recovered).contextOrganizationId).toBe(orgId);
  });
  it('retries missing provider content before admitting owner work', async () => {
    const { mailbox } = await enrolled(schema);
    const key = `hydrate-${mailbox.id}`;
    await deliverInboundMail(
      {
        providerMessageId: key,
        rfc822MessageId: null,
        fromAddress: assertDefined(mailbox.ownerAddress),
        fromName: null,
        to: [assertDefined(mailboxAddress(mailbox))],
        cc: [],
        subject: 'Retry content',
        text: null,
        html: null,
        bodyStatus: 'metadata-only',
        receivedAt: new Date().toISOString(),
        attachments: [],
      },
      'fixture',
    );
    const receiver = getContainer().inboundMail;
    const read = vi
      .spyOn(receiver, 'retrieve')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        text: null,
        html: '<p>Please review my launch.</p>',
        authentication: { spf: 'pass', dkim: 'pass', dmarc: 'pass' },
      });
    try {
      await sweepMailIngress();
      await sweepMailIngress();
      await sweepMailIngress();
      const [message] = await schema.db
        .select()
        .from(schema.athenaInboundMessage)
        .where(eq(schema.athenaInboundMessage.providerMessageId, key));
      expect(assertDefined(message).bodyText).toBe('Please review my launch.');
      expect(assertDefined(message).sessionId).not.toBeNull();
    } finally {
      read.mockRestore();
    }
  });
});
