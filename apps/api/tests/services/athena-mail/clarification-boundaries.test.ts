import { raiseElicitation } from '../../support/entry-point-writers';
import { beforeAll, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { assertDefined } from '@docket/test-utils';
import { getDb } from '../../support/routes-harness';
import { enrolled, ownerOperation } from './fixtures';
import { elicitationRequestFromToolInput } from '../../../src/services/elicitation-service';
import { continueMailQuestion } from '../../../src/services/athena-mail/continuation';
let schema: Awaited<ReturnType<typeof getDb>>;
beforeAll(async () => {
  schema = await getDb();
});

it.each([
  'email-changed',
  'unverified',
  'member-archived',
  'channel-revision',
  'automatic',
  'unauthenticated',
  'question-canceled',
  'question-parked',
  'destructive',
  'structured',
] as const)(
  'never answers or resumes an unauthorized or stale %s clarification',
  async (boundary) => {
    const { mailbox, owner, humanActorId } = await enrolled(schema);
    const session = await ownerOperation(schema, mailbox);
    const { elicitation } = await raiseElicitation({
      sessionId: session.id,
      request: elicitationRequestFromToolInput({
        question: 'Which venue?',
        actionSummary: 'Choose venue',
      }),
    });
    const [reply] = await schema.db
      .insert(schema.athenaInboundMessage)
      .values({
        ownerUserId: owner,
        mailboxId: mailbox.id,
        organizationId: assertDefined(mailbox.organizationId),
        provider: 'fixture',
        providerMessageId: `boundary-${session.id}`,
        fromAddress: assertDefined(mailbox.ownerAddress),
        toAddress: `${mailbox.key}@example.com`,
        title: 'Re: Which venue?',
        bodyText: 'Downtown',
        processingStatus: 'answering',
        sessionId: session.id,
        threadId: elicitation.id,
        channelRevision: mailbox.revision,
        authentication:
          boundary === 'unauthenticated' ? null : { spf: 'pass', dkim: 'pass', dmarc: 'pass' },
        headers: boundary === 'automatic' ? { 'auto-submitted': 'auto-replied' } : {},
      })
      .returning();
    if (boundary === 'email-changed')
      await schema.db
        .update(schema.user)
        .set({ email: `${owner}@changed.example` })
        .where(eq(schema.user.id, owner));
    if (boundary === 'unverified')
      await schema.db
        .update(schema.user)
        .set({ emailVerified: false })
        .where(eq(schema.user.id, owner));
    if (boundary === 'member-archived')
      await schema.db
        .update(schema.actor)
        .set({ archivedAt: new Date() })
        .where(eq(schema.actor.id, humanActorId));
    if (boundary === 'channel-revision')
      await schema.db
        .update(schema.athenaMailbox)
        .set({ revision: mailbox.revision + 1 })
        .where(eq(schema.athenaMailbox.id, mailbox.id));
    if (boundary === 'question-canceled' || boundary === 'question-parked')
      await schema.db
        .update(schema.agentElicitation)
        .set({
          status: boundary === 'question-canceled' ? 'canceled' : 'parked',
          resolver: 'timeout',
          settledAt: new Date(),
        })
        .where(eq(schema.agentElicitation.id, elicitation.id));
    if (boundary === 'destructive')
      await schema.db
        .update(schema.agentElicitation)
        .set({ timeoutPolicy: 'destructive' })
        .where(eq(schema.agentElicitation.id, elicitation.id));
    if (boundary === 'structured')
      await schema.db
        .update(schema.agentElicitation)
        .set({ spec: { kind: 'confirm', confirmLabel: 'Confirm', declineLabel: 'Decline' } })
        .where(eq(schema.agentElicitation.id, elicitation.id));
    const resume = vi.fn(async () => undefined);
    await continueMailQuestion(assertDefined(reply), resume);
    const [result] = await schema.db
      .select()
      .from(schema.agentElicitation)
      .where(eq(schema.agentElicitation.id, elicitation.id));
    expect(assertDefined(result).answer).toBeNull();
    expect(resume).not.toHaveBeenCalled();
    const [receipt] = await schema.db
      .select()
      .from(schema.athenaInboundMessage)
      .where(eq(schema.athenaInboundMessage.id, assertDefined(reply).id));
    expect(assertDefined(receipt).processingStatus).not.toBe('continued');
    const outputs = await schema.db
      .select()
      .from(schema.athenaMailOutbox)
      .where(eq(schema.athenaMailOutbox.inboundMessageId, assertDefined(reply).id));
    expect(outputs).toHaveLength(0);
  },
);
