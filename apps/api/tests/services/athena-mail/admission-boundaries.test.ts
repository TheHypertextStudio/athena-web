import { beforeAll, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { assertDefined } from '@docket/test-utils';
import { getDb, seedBaseOrg } from '../../support/routes-harness';
import { enrolled } from './fixtures';
import { deliverInboundMail } from '../../../src/routes/inbound-mail-delivery';
import { mailboxAddress } from '../../../src/routes/athena-mail-store';
import { sweepMailIngress } from '../../../src/services/athena-mail/ingress';
import { mailSessionAuthorized } from '../../../src/services/athena-mail/session-auth';
import {
  OWNER_MAIL_BODY_LIMIT,
  OWNER_MAIL_HOURLY_LIMIT,
} from '../../../src/services/athena-mail/policy';

let schema: Awaited<ReturnType<typeof getDb>>;
beforeAll(async () => {
  schema = await getDb();
});
type Mailbox = Awaited<ReturnType<typeof enrolled>>['mailbox'];
type Incoming = Parameters<typeof deliverInboundMail>[0];

async function capture(mailbox: Mailbox, changes: Partial<Incoming> = {}) {
  const key = `admission-${crypto.randomUUID()}`;
  await deliverInboundMail(
    {
      providerMessageId: key,
      rfc822MessageId: `<${key}@example.com>`,
      fromAddress: assertDefined(mailbox.ownerAddress),
      fromName: null,
      to: [assertDefined(mailboxAddress(mailbox))],
      cc: [],
      subject: 'Owner request',
      text: 'Help me plan my launch.',
      html: null,
      bodyStatus: 'complete',
      receivedAt: new Date().toISOString(),
      attachments: [],
      authentication: { spf: 'pass', dkim: 'pass', dmarc: 'pass' },
      ...changes,
    },
    'fixture',
  );
  const [message] = await schema.db
    .select()
    .from(schema.athenaInboundMessage)
    .where(eq(schema.athenaInboundMessage.providerMessageId, key));
  return assertDefined(message);
}
async function readMessage(id: string) {
  const [message] = await schema.db
    .select()
    .from(schema.athenaInboundMessage)
    .where(eq(schema.athenaInboundMessage.id, id));
  return assertDefined(message);
}

it('admits the last hourly request, captures later requests and sends only one bounded limit notice', async () => {
  const { owner, mailbox } = await enrolled(schema);
  await schema.db.insert(schema.agentSession).values(
    Array.from({ length: OWNER_MAIL_HOURLY_LIMIT - 1 }, (_, index) => ({
      executorKind: 'athena' as const,
      ownerUserId: owner,
      contextOrganizationId: mailbox.organizationId,
      kind: 'job' as const,
      workLinkage: 'observation' as const,
      trigger: 'mention' as const,
      status: 'completed' as const,
      externalRunRef: `athena-mail:earlier-${mailbox.id}-${index}`,
    })),
  );
  const last = await capture(mailbox);
  const run = vi.fn();
  await sweepMailIngress({ run });
  const admittedSessionId = assertDefined((await readMessage(last.id)).sessionId);
  await schema.db
    .update(schema.agentSession)
    .set({ status: 'completed' })
    .where(eq(schema.agentSession.id, admittedSessionId));
  run.mockClear();
  const denied = await capture(mailbox);
  const deniedAgain = await capture(mailbox);
  await sweepMailIngress({ run });
  for (const message of [denied, deniedAgain]) {
    const saved = await readMessage(message.id);
    expect(saved.processingStatus).toBe('rate_limited');
    expect(saved.sessionId).toBeNull();
    expect(saved.bodyText).toBe('Help me plan my launch.');
  }
  const notices = await schema.db
    .select()
    .from(schema.athenaMailOutbox)
    .where(eq(schema.athenaMailOutbox.ownerUserId, owner));
  expect(notices).toHaveLength(1);
  expect(assertDefined(notices[0]).toAddress).toBe(mailbox.ownerAddress);
  expect(assertDefined(notices[0]).bodyText).toContain('retry later');
  expect(run.mock.calls.some(([, id]) => id === admittedSessionId)).toBe(false);
  const sessions = await schema.db
    .select()
    .from(schema.agentSession)
    .where(and(eq(schema.agentSession.ownerUserId, owner), eq(schema.agentSession.kind, 'job')));
  expect(sessions).toHaveLength(OWNER_MAIL_HOURLY_LIMIT);
});

it('retains oversized email as context without admitting paid work and explains the size limit to its owner', async () => {
  const { owner, mailbox } = await enrolled(schema);
  const message = await capture(mailbox, { text: 'x'.repeat(OWNER_MAIL_BODY_LIMIT + 1) });
  const run = vi.fn();
  await sweepMailIngress({ run });
  const saved = await readMessage(message.id);
  expect(saved.processingStatus).toBe('too_large');
  expect(saved.sessionId).toBeNull();
  expect(saved.bodyText).toHaveLength(OWNER_MAIL_BODY_LIMIT + 1);
  const [notice] = await schema.db
    .select()
    .from(schema.athenaMailOutbox)
    .where(eq(schema.athenaMailOutbox.inboundMessageId, message.id));
  expect(assertDefined(notice).toAddress).toBe(mailbox.ownerAddress);
  expect(assertDefined(notice).bodyText).toContain('50,000 characters');
  const sessions = await schema.db
    .select()
    .from(schema.agentSession)
    .where(and(eq(schema.agentSession.ownerUserId, owner), eq(schema.agentSession.kind, 'job')));
  expect(sessions).toHaveLength(0);
});

it.each([
  { headers: { 'auto-submitted': 'auto-replied' } },
  { headers: { 'list-id': '<list.example.com>' } },
  { headers: { 'content-type': 'multipart/report; report-type=delivery-status' } },
  { fromAddress: 'stranger@example.com' },
  { authentication: { spf: 'pass', dkim: 'pass', dmarc: 'fail' } },
] satisfies Partial<Incoming>[])(
  'captures robot or unauthenticated-owner mail without generating or replying: %j',
  async (changes) => {
    const { owner, mailbox } = await enrolled(schema);
    const message = await capture(mailbox, changes);
    await sweepMailIngress({ run: vi.fn() });
    const saved = await readMessage(message.id);
    expect(saved.processingStatus).toBe('captured');
    expect(saved.sessionId).toBeNull();
    expect(saved.bodyText).toBe('Help me plan my launch.');
    expect(
      await schema.db
        .select()
        .from(schema.athenaMailOutbox)
        .where(eq(schema.athenaMailOutbox.ownerUserId, owner)),
    ).toHaveLength(0);
  },
);

it('includes only exact referenced inbound context from the same workspace and enrollment revision', async () => {
  const { owner, orgId, mailbox } = await enrolled(schema);
  const { orgId: otherOrg } = await seedBaseOrg(schema.db, schema);
  const prior = await Promise.all([
    capture(mailbox, { text: 'AUTHORIZED EXACT THREAD CONTEXT' }),
    capture(mailbox, { text: 'UNRELATED SAME WORKSPACE SECRET' }),
    capture(mailbox, { text: 'OTHER WORKSPACE SECRET' }),
    capture(mailbox, { text: 'OLD ENROLLMENT SECRET' }),
  ]);
  for (const [index, message] of prior.entries()) {
    await schema.db
      .update(schema.athenaInboundMessage)
      .set({
        processingStatus: 'replied',
        organizationId: index === 2 ? otherOrg : orgId,
        channelRevision: index === 3 ? mailbox.revision - 1 : mailbox.revision,
      })
      .where(eq(schema.athenaInboundMessage.id, message.id));
  }
  const referenced = [prior[0], prior[2], prior[3]]
    .map((message) => assertDefined(message).rfc822MessageId)
    .join(' ');
  const next = await capture(mailbox, {
    text: 'Explain that decision.',
    headers: { references: referenced },
  });
  await sweepMailIngress({ run: vi.fn() });
  const sessionId = assertDefined((await readMessage(next.id)).sessionId);
  const inputs = await schema.db
    .select()
    .from(schema.sessionActivity)
    .where(eq(schema.sessionActivity.sessionId, sessionId));
  const text = JSON.stringify(inputs.map((activity) => activity.body));
  expect(text).toContain('AUTHORIZED EXACT THREAD CONTEXT');
  expect(text).not.toContain('UNRELATED SAME WORKSPACE SECRET');
  expect(text).not.toContain('OTHER WORKSPACE SECRET');
  expect(text).not.toContain('OLD ENROLLMENT SECRET');
  expect(
    await mailSessionAuthorized({ id: sessionId, externalRunRef: `athena-mail:${next.id}` }),
  ).toBe(true);
  expect(
    await mailSessionAuthorized({ id: sessionId, externalRunRef: 'athena-mail:missing-receipt' }),
  ).toBe(false);
  await schema.db
    .update(schema.athenaMailbox)
    .set({ revision: mailbox.revision + 1 })
    .where(eq(schema.athenaMailbox.id, mailbox.id));
  expect(
    await mailSessionAuthorized({ id: sessionId, externalRunRef: `athena-mail:${next.id}` }),
  ).toBe(false);
  expect(owner).toBe(next.ownerUserId);
});
