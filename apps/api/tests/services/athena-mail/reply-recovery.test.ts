import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '../../support/routes-harness';
import { enrolled, ownerOperation } from './fixtures';
import { prepareMailReplies } from '../../../src/services/athena-mail/replies';
let schema: Awaited<ReturnType<typeof getDb>>;
beforeAll(async () => {
  schema = await getDb();
});
async function operation() {
  const setup = await enrolled(schema);
  const session = await ownerOperation(schema, setup.mailbox);
  return { ...setup, session };
}
async function replies(owner: string) {
  return schema.db
    .select()
    .from(schema.athenaMailOutbox)
    .where(eq(schema.athenaMailOutbox.ownerUserId, owner));
}
describe('owner reply recovery after incomplete generation checkpoints', () => {
  it.each(['awaiting_input', 'awaiting_approval'] as const)(
    'sends a safe owner notice when a %s checkpoint has no saved question or proposal',
    async (status) => {
      const { owner, session, mailbox } = await operation();
      await schema.db
        .update(schema.agentSession)
        .set({ status })
        .where(eq(schema.agentSession.id, session.id));
      await prepareMailReplies();
      await prepareMailReplies();
      const rows = await replies(owner);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.toAddress).toBe(mailbox.ownerAddress);
      expect(rows[0]?.responseStage).toBe(
        status === 'awaiting_input' ? 'waiting-input' : 'waiting-approval',
      );
      expect(rows[0]?.bodyText).toContain(
        status === 'awaiting_input' ? 'I need more information' : 'signed-in Docket',
      );
    },
  );
  it('keeps an empty terminal response recoverable, then sends a completed answer once without inventing thread headers', async () => {
    const { owner, session } = await operation();
    await schema.db
      .update(schema.athenaInboundMessage)
      .set({
        rfc822MessageId: null,
        title: 'Re: Existing conversation',
      })
      .where(eq(schema.athenaInboundMessage.sessionId, session.id));
    await schema.db
      .update(schema.agentSession)
      .set({ status: 'completed' })
      .where(eq(schema.agentSession.id, session.id));
    await schema.db.insert(schema.sessionActivity).values({
      sessionId: session.id,
      organizationId: null,
      type: 'response',
      body: { author: 'athena' },
    });
    await prepareMailReplies();
    expect(await replies(owner)).toHaveLength(0);
    await schema.db.insert(schema.sessionActivity).values({
      sessionId: session.id,
      organizationId: null,
      type: 'response',
      body: { author: 'athena', text: 'The recovered answer.' },
    });
    await prepareMailReplies();
    await prepareMailReplies();
    const rows = await replies(owner);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.subject).toBe('Re: Existing conversation');
    expect(rows[0]?.bodyText).toContain('The recovered answer.');
    expect(rows[0]?.bodyText).not.toContain('Please help with this request.');
    expect(rows[0]?.headers).not.toHaveProperty('In-Reply-To');
    expect(rows[0]?.headers).not.toHaveProperty('References');
  });
  it('cancels a legacy operation without an enrollment receipt instead of replying under current consent', async () => {
    const { owner, session } = await operation();
    await schema.db
      .update(schema.athenaInboundMessage)
      .set({ channelRevision: null })
      .where(eq(schema.athenaInboundMessage.sessionId, session.id));
    await schema.db
      .update(schema.agentSession)
      .set({ status: 'completed' })
      .where(eq(schema.agentSession.id, session.id));
    await prepareMailReplies();
    expect(await replies(owner)).toHaveLength(0);
    const [message] = await schema.db
      .select()
      .from(schema.athenaInboundMessage)
      .where(eq(schema.athenaInboundMessage.sessionId, session.id));
    expect(message?.processingStatus).toBe('canceled');
  });
});
