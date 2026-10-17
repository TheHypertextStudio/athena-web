import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { assertDefined } from '@docket/test-utils';
import { OrganizationId } from '@docket/identity-access/ids';
import { getDb } from '../../support/routes-harness';
import { enrolled, ownerOperation } from './fixtures';
import { prepareMailReplies } from '../../../src/services/athena-mail/replies';
import { configureMailChannel } from '../../../src/services/athena-mail/channel';
let schema: Awaited<ReturnType<typeof getDb>>;
beforeAll(async () => {
  schema = await getDb();
});
async function operation() {
  const owner = await enrolled(schema);
  const session = await ownerOperation(schema, owner.mailbox);
  const [message] = await schema.db
    .select()
    .from(schema.athenaInboundMessage)
    .where(eq(schema.athenaInboundMessage.sessionId, session.id));
  return { ...owner, session, message: assertDefined(message) };
}
async function outgoing(sessionId: string) {
  return schema.db
    .select()
    .from(schema.athenaMailOutbox)
    .where(eq(schema.athenaMailOutbox.sessionId, sessionId));
}
describe('owner replies tied to the exact isolated request', () => {
  it('emails only that operation response and its own thread headers, never a canonical or other session response', async () => {
    const current = await operation();
    const other = await operation();
    await schema.db.insert(schema.sessionActivity).values([
      {
        sessionId: current.session.id,
        organizationId: null,
        type: 'response',
        body: { author: 'user', text: 'Private owner prompt: do not repeat' },
      },
      {
        sessionId: current.session.id,
        organizationId: null,
        type: 'response',
        body: { text: 'Only this operation answer.' },
      },
      {
        sessionId: other.session.id,
        organizationId: null,
        type: 'response',
        body: { text: 'OTHER OWNER SECRET' },
      },
      {
        sessionId: assertDefined(current.session.parentSessionId),
        organizationId: null,
        type: 'response',
        body: { text: 'CANONICAL CONVERSATION SECRET' },
      },
    ]);
    await schema.db
      .update(schema.agentSession)
      .set({ status: 'completed' })
      .where(eq(schema.agentSession.id, current.session.id));
    await prepareMailReplies();
    await prepareMailReplies();
    const rows = await outgoing(current.session.id);
    expect(rows).toHaveLength(1);
    const reply = assertDefined(rows[0]);
    expect(reply.toAddress).toBe(current.mailbox.ownerAddress);
    expect(reply.bodyText).toContain('Only this operation answer.');
    expect(reply.bodyText).not.toContain('SECRET');
    expect(reply.bodyText).not.toContain('Private owner prompt');
    expect(reply.headers['In-Reply-To']).toBe(current.message.rfc822MessageId);
    expect(reply.headers['References']).toContain(assertDefined(current.message.rfc822MessageId));
    expect(reply.subject).toBe(`Re: ${current.message.title}`);
  });
  it('sends one decision request per stage and a distinct final result after the decision', async () => {
    const current = await operation();
    const [question] = await schema.db
      .insert(schema.sessionActivity)
      .values({
        sessionId: current.session.id,
        organizationId: null,
        type: 'elicitation',
        body: { text: 'Which day should I use?' },
      })
      .returning();
    await schema.db
      .update(schema.agentSession)
      .set({ status: 'awaiting_input' })
      .where(eq(schema.agentSession.id, current.session.id));
    await prepareMailReplies();
    await prepareMailReplies();
    expect(await outgoing(current.session.id)).toHaveLength(1);
    expect(assertDefined((await outgoing(current.session.id))[0]).bodyText).toContain(
      'Which day should I use?',
    );
    const [proposal] = await schema.db
      .insert(schema.sessionActivity)
      .values({
        sessionId: current.session.id,
        organizationId: null,
        type: 'action',
        approvalStatus: 'proposed',
        body: { text: 'Private action arguments' },
      })
      .returning();
    await schema.db
      .update(schema.agentSession)
      .set({ status: 'awaiting_approval' })
      .where(eq(schema.agentSession.id, current.session.id));
    await prepareMailReplies();
    await prepareMailReplies();
    const waiting = await outgoing(current.session.id);
    expect(waiting).toHaveLength(2);
    expect(waiting.map((row) => row.responseStage)).toEqual(
      expect.arrayContaining([
        `waiting-${assertDefined(question).id}`,
        `waiting-${assertDefined(proposal).id}`,
      ]),
    );
    expect(
      waiting.find((row) => row.responseStage === `waiting-${assertDefined(proposal).id}`)
        ?.bodyText,
    ).toContain('signed-in Docket');
    expect(
      waiting.find((row) => row.responseStage === `waiting-${assertDefined(proposal).id}`)
        ?.bodyText,
    ).not.toContain('Private action arguments');
    await schema.db.insert(schema.sessionActivity).values({
      sessionId: current.session.id,
      organizationId: null,
      type: 'response',
      body: { text: 'Finished after your decision.' },
    });
    await schema.db
      .update(schema.agentSession)
      .set({ status: 'completed' })
      .where(eq(schema.agentSession.id, current.session.id));
    await prepareMailReplies();
    await prepareMailReplies();
    expect(await outgoing(current.session.id)).toHaveLength(3);
    expect(
      (await outgoing(current.session.id)).find((row) => row.responseStage === 'settled')?.bodyText,
    ).toContain('Finished after your decision.');
  });
  it.each(['failed', 'canceled'] as const)(
    'gives honest %s behavior without fabricating success',
    async (status) => {
      const current = await operation();
      await schema.db
        .update(schema.agentSession)
        .set({ status })
        .where(eq(schema.agentSession.id, current.session.id));
      await prepareMailReplies();
      const rows = await outgoing(current.session.id);
      if (status === 'failed')
        expect(assertDefined(rows[0]).bodyText).toContain('could not finish');
      else expect(rows).toHaveLength(0);
    },
  );
  it('does not send a completed response after owner consent is revoked', async () => {
    const current = await operation();
    await schema.db.insert(schema.sessionActivity).values({
      sessionId: current.session.id,
      organizationId: null,
      type: 'response',
      body: { text: 'Do not send after revocation' },
    });
    await schema.db
      .update(schema.agentSession)
      .set({ status: 'completed' })
      .where(eq(schema.agentSession.id, current.session.id));
    await configureMailChannel(current.owner, {
      enabled: false,
      ownerRepliesEnabled: false,
      organizationId: OrganizationId.parse(current.orgId),
    });
    await prepareMailReplies();
    expect(await outgoing(current.session.id)).toHaveLength(0);
  });
});
