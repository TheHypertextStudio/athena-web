import { beforeAll, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { assertDefined } from '@docket/test-utils';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { getDb } from '../../support/routes-harness';
import { enrolled } from './fixtures';
import type { McpContext } from '../../../src/mcp/auth';
import { internalAgentContext, internalUserContext } from '../../../src/mcp/internal-session';
import { registerAthenaMailTools } from '../../../src/mcp/athena-mail-tools';
import { getContainer } from '../../../src/container';
import {
  prepareMailAttachments,
  snapshotMailAttachment,
} from '../../../src/services/athena-mail/attachments';
import { mailboxAddress } from '../../../src/routes/athena-mail-store';

let schema: Awaited<ReturnType<typeof getDb>>;
beforeAll(async () => {
  schema = await getDb();
});
async function operation(owner: string, orgId: string) {
  const [session] = await schema.db
    .insert(schema.agentSession)
    .values({
      executorKind: 'athena',
      ownerUserId: owner,
      contextOrganizationId: orgId,
      kind: 'job',
      workLinkage: 'observation',
      trigger: 'mention',
      status: 'running',
    })
    .returning();
  return assertDefined(session);
}
function message(orgId: string) {
  return {
    orgId,
    to: 'reviewed-recipient@example.com',
    subject: 'Reviewed subject',
    body: 'Reviewed complete body',
  };
}
async function call(ctx: McpContext, sessionId: string | null, input: ReturnType<typeof message>) {
  const server = new McpServer(
    { name: 'mail-authority', version: '1' },
    { capabilities: { tools: {} } },
  );
  registerAthenaMailTools(server, ctx, sessionId);
  const client = new Client({ name: 'mail-authority', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);
  try {
    return await client.callTool({ name: 'send_email', arguments: input });
  } finally {
    await client.close();
    await server.close();
  }
}
async function review(sessionId: string, input: unknown, tool = 'send_email') {
  await schema.db.insert(schema.sessionActivity).values({
    sessionId,
    organizationId: null,
    type: 'action',
    approvalStatus: 'executing',
    body: {
      action: {
        kind: 'custom',
        summary: 'Execute reviewed effect',
        toolCall: { connection: 'docket', tool, toolUseId: 'reviewed-tool', input },
      },
    },
  });
}
async function expectNoQueue(owner: string) {
  expect(
    await schema.db
      .select()
      .from(schema.athenaMailOutbox)
      .where(eq(schema.athenaMailOutbox.ownerUserId, owner)),
  ).toHaveLength(0);
}

it('denies an organization-registered agent even when it names a reviewed owner session', async () => {
  const { owner, orgId } = await enrolled(schema);
  const session = await operation(owner, orgId);
  const input = message(orgId);
  await review(session.id, input);
  const [actor] = await schema.db
    .insert(schema.actor)
    .values({
      organizationId: orgId,
      kind: 'agent',
      displayName: 'Mail delegate',
      status: 'active',
    })
    .returning();
  const [agent] = await schema.db
    .insert(schema.agent)
    .values({ organizationId: orgId, actorId: assertDefined(actor).id })
    .returning();
  const ctx = await internalAgentContext(orgId, assertDefined(agent).id);
  expect((await call(ctx, session.id, input)).isError).toBe(true);
  await expectNoQueue(owner);
});

it('denies a user call without a first-party execution session', async () => {
  const { owner, orgId } = await enrolled(schema);
  expect((await call(await internalUserContext(owner), null, message(orgId))).isError).toBe(true);
  await expectNoQueue(owner);
});

it.each(['missing', 'other-owner'] as const)(
  'denies a %s session without disclosing its reviewed message',
  async (kind) => {
    const { owner, orgId } = await enrolled(schema);
    const other = await enrolled(schema);
    const session = await operation(other.owner, other.orgId);
    const input = message(orgId);
    await review(session.id, input);
    expect(
      (
        await call(
          await internalUserContext(owner),
          kind === 'missing' ? 'absent-session' : session.id,
          input,
        )
      ).isError,
    ).toBe(true);
    await expectNoQueue(owner);
  },
);

it.each(['missing-mailbox', 'disabled', 'different-workspace'] as const)(
  'rechecks %s before queuing an exact executing review',
  async (kind) => {
    const { owner, orgId, mailbox } = await enrolled(schema);
    const session = await operation(owner, orgId);
    const input = message(orgId);
    await review(session.id, input);
    if (kind === 'missing-mailbox')
      await schema.db.delete(schema.athenaMailbox).where(eq(schema.athenaMailbox.id, mailbox.id));
    else if (kind === 'disabled')
      await schema.db
        .update(schema.athenaMailbox)
        .set({ enabled: false })
        .where(eq(schema.athenaMailbox.id, mailbox.id));
    else {
      const other = await enrolled(schema);
      await schema.db.insert(schema.actor).values({
        organizationId: other.orgId,
        userId: owner,
        kind: 'human',
        displayName: 'Owner in second workspace',
        status: 'active',
      });
      await schema.db
        .update(schema.athenaMailbox)
        .set({ organizationId: other.orgId })
        .where(eq(schema.athenaMailbox.id, mailbox.id));
    }
    expect((await call(await internalUserContext(owner), session.id, input)).isError).toBe(true);
    await expectNoQueue(owner);
  },
);

it.each(['other-tool', 'legacy-narration', 'missing-input', 'string-input'] as const)(
  'does not treat %s as an executable email approval',
  async (kind) => {
    const { owner, orgId } = await enrolled(schema);
    const session = await operation(owner, orgId);
    const input = message(orgId);
    if (kind === 'legacy-narration')
      await schema.db.insert(schema.sessionActivity).values({
        sessionId: session.id,
        organizationId: null,
        type: 'action',
        approvalStatus: 'executing',
        body: { action: { kind: 'custom', summary: 'Email recipient' } },
      });
    else
      await review(
        session.id,
        kind === 'missing-input' ? null : kind === 'string-input' ? 'Email recipient' : input,
        kind === 'other-tool' ? 'capture' : 'send_email',
      );
    expect((await call(await internalUserContext(owner), session.id, input)).isError).toBe(true);
    await expectNoQueue(owner);
  },
);

it.each(['exact', 'renamed'] as const)(
  'binds the %s reviewed attachment manifest to the private received file',
  async (kind) => {
    const { owner, orgId, mailbox } = await enrolled(schema);
    const session = await operation(owner, orgId);
    const [messageRow] = await schema.db
      .insert(schema.athenaInboundMessage)
      .values({
        ownerUserId: owner,
        organizationId: orgId,
        mailboxId: mailbox.id,
        channelRevision: mailbox.revision,
        provider: 'fixture',
        providerMessageId: `reviewed-file-${Math.random()}`,
        fromAddress: assertDefined(mailbox.ownerAddress),
        toAddress: assertDefined(mailboxAddress(mailbox)),
        title: 'Private attachment',
        attachments: [{ id: 'private-file', filename: 'notes.txt', contentType: 'text/plain' }],
      })
      .returning();
    const receiver = getContainer().inboundMail;
    const original = receiver.retrieveAttachment?.bind(receiver);
    try {
      Object.assign(receiver, {
        retrieveAttachment: async () => new TextEncoder().encode('Reviewed private file bytes'),
      });
      const prepared = await prepareMailAttachments(assertDefined(messageRow));
      const snapshot = await snapshotMailAttachment(owner, mailbox.id, mailbox.revision, {
        messageId: prepared.id,
        id: 'private-file',
        digest: assertDefined(prepared.attachments[0]?.digest),
      });
      const input = {
        ...message(orgId),
        attachments: [
          { ...snapshot, filename: kind === 'renamed' ? 'different.txt' : snapshot.filename },
        ],
      };
      await review(session.id, input);
      const result = await call(await internalUserContext(owner), session.id, input);
      if (kind === 'renamed') {
        expect(result.isError).toBe(true);
        await expectNoQueue(owner);
      } else {
        expect(result.isError).not.toBe(true);
        const queued = await schema.db
          .select()
          .from(schema.athenaMailOutbox)
          .where(eq(schema.athenaMailOutbox.ownerUserId, owner));
        expect(queued).toHaveLength(1);
        expect(assertDefined(queued[0]).attachments).toEqual([snapshot]);
        expect(assertDefined(queued[0]).toAddress).toBe(input.to);
      }
    } finally {
      Object.assign(receiver, { retrieveAttachment: original });
    }
  },
);
