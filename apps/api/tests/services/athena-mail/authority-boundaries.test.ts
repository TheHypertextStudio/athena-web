import { OrganizationId } from '@docket/identity-access/ids';
import { beforeAll, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { assertDefined } from '@docket/test-utils';
import { getDb } from '../../support/routes-harness';
import { enrolled } from './fixtures';
import { getContainer } from '../../../src/container';
import {
  configureMailChannel,
  mailChannelAuthority,
} from '../../../src/services/athena-mail/channel';
import { sweepMailOutbox } from '../../../src/services/athena-mail/outbox';
let schema: Awaited<ReturnType<typeof getDb>>;
beforeAll(async () => {
  schema = await getDb();
});

it.each([
  'email-changed',
  'unverified',
  'member-archived',
  'member-missing',
  'disabled',
  'owner-replies-disabled',
  'stale-revision',
] as const)('rechecks %s before sending an already-queued owner response', async (revocation) => {
  const { owner, mailbox, humanActorId } = await enrolled(schema);
  const [intent] = await schema.db
    .insert(schema.athenaMailOutbox)
    .values({
      ownerUserId: owner,
      mailboxId: mailbox.id,
      channelRevision: mailbox.revision,
      toAddress: assertDefined(mailbox.ownerAddress),
      subject: 'Private owner result',
      bodyText: 'Private workspace details.',
    })
    .returning();
  if (revocation === 'email-changed')
    await schema.db
      .update(schema.user)
      .set({ email: `${owner}@changed.example` })
      .where(eq(schema.user.id, owner));
  if (revocation === 'unverified')
    await schema.db
      .update(schema.user)
      .set({ emailVerified: false })
      .where(eq(schema.user.id, owner));
  if (revocation === 'member-archived')
    await schema.db
      .update(schema.actor)
      .set({ archivedAt: new Date() })
      .where(eq(schema.actor.id, humanActorId));
  if (revocation === 'member-missing')
    await schema.db
      .update(schema.actor)
      .set({ userId: null })
      .where(eq(schema.actor.id, humanActorId));
  if (revocation === 'disabled')
    await schema.db
      .update(schema.athenaMailbox)
      .set({ enabled: false })
      .where(eq(schema.athenaMailbox.id, mailbox.id));
  if (revocation === 'owner-replies-disabled')
    await schema.db
      .update(schema.athenaMailbox)
      .set({ ownerRepliesEnabled: false })
      .where(eq(schema.athenaMailbox.id, mailbox.id));
  if (revocation === 'stale-revision')
    await schema.db
      .update(schema.athenaMailbox)
      .set({ revision: mailbox.revision + 1 })
      .where(eq(schema.athenaMailbox.id, mailbox.id));
  expect(await mailChannelAuthority(mailbox.id, mailbox.revision)).toBeNull();
  const send = vi.spyOn(getContainer().mailer, 'send');
  try {
    await sweepMailOutbox();
    const [result] = await schema.db
      .select()
      .from(schema.athenaMailOutbox)
      .where(eq(schema.athenaMailOutbox.id, assertDefined(intent).id));
    expect(assertDefined(result).status).toBe('canceled');
    expect(assertDefined(result).errorCode).toBe('channel_revoked');
    expect(
      send.mock.calls.some(
        ([message]) => message.idempotencyKey === `athena-mail-${assertDefined(intent).id}`,
      ),
    ).toBe(false);
  } finally {
    send.mockRestore();
  }
});

it('rejects a queued automatic response redirected away from the enrolled owner', async () => {
  const { owner, mailbox } = await enrolled(schema);
  const [intent] = await schema.db
    .insert(schema.athenaMailOutbox)
    .values({
      ownerUserId: owner,
      mailboxId: mailbox.id,
      channelRevision: mailbox.revision,
      toAddress: 'stranger@example.com',
      subject: 'Private owner result',
      bodyText: 'Must not disclose this.',
      externalRecipient: false,
    })
    .returning();
  const send = vi.spyOn(getContainer().mailer, 'send');
  try {
    await sweepMailOutbox();
    const [result] = await schema.db
      .select()
      .from(schema.athenaMailOutbox)
      .where(eq(schema.athenaMailOutbox.id, assertDefined(intent).id));
    expect(assertDefined(result).status).toBe('canceled');
    expect(send.mock.calls.some(([message]) => message.to === 'stranger@example.com')).toBe(false);
  } finally {
    send.mockRestore();
  }
});

it.each(['queued', 'sending'] as const)(
  'does not blindly retry an ambiguous %s send after provider deduplication expires',
  async (status) => {
    const { owner, mailbox } = await enrolled(schema);
    const [intent] = await schema.db
      .insert(schema.athenaMailOutbox)
      .values({
        ownerUserId: owner,
        mailboxId: mailbox.id,
        channelRevision: mailbox.revision,
        toAddress: assertDefined(mailbox.ownerAddress),
        subject: 'Possibly already delivered',
        bodyText: 'Do not duplicate.',
        status,
        attempts: 2,
        firstAttemptAt: new Date(Date.now() - 25 * 3600_000),
        leaseToken: status === 'sending' ? 'expired-process' : null,
        leaseExpiresAt: new Date(0),
      })
      .returning();
    const send = vi.spyOn(getContainer().mailer, 'send');
    try {
      await sweepMailOutbox();
      await sweepMailOutbox(new Date(Date.now() + 3600_000));
      const [result] = await schema.db
        .select()
        .from(schema.athenaMailOutbox)
        .where(eq(schema.athenaMailOutbox.id, assertDefined(intent).id));
      expect(assertDefined(result).status).toBe('uncertain');
      expect(assertDefined(result).errorCode).toBe('idempotency_expired');
      expect(
        send.mock.calls.some(
          ([message]) => message.idempotencyKey === `athena-mail-${assertDefined(intent).id}`,
        ),
      ).toBe(false);
    } finally {
      send.mockRestore();
    }
  },
);

it.each(['missing-receipt', 'retry-exhausted'] as const)(
  'parks %s as uncertain and does not send it again',
  async (failure) => {
    const { owner, mailbox } = await enrolled(schema);
    const [intent] = await schema.db
      .insert(schema.athenaMailOutbox)
      .values({
        ownerUserId: owner,
        mailboxId: mailbox.id,
        channelRevision: mailbox.revision,
        toAddress: assertDefined(mailbox.ownerAddress),
        subject: 'Ambiguous delivery',
        bodyText: 'Stable send intent.',
        attempts: failure === 'retry-exhausted' ? 7 : 0,
      })
      .returning();
    const send = vi.spyOn(getContainer().mailer, 'send');
    if (failure === 'missing-receipt') send.mockResolvedValue(undefined);
    else send.mockRejectedValue(new Error('Provider response lost'));
    try {
      await sweepMailOutbox();
      await sweepMailOutbox(new Date(Date.now() + 3600_000));
      const [result] = await schema.db
        .select()
        .from(schema.athenaMailOutbox)
        .where(eq(schema.athenaMailOutbox.id, assertDefined(intent).id));
      expect(assertDefined(result).status).toBe('uncertain');
      expect(assertDefined(result).errorCode).toBe(
        failure === 'missing-receipt' ? 'receipt_missing' : 'send_failed',
      );
      expect(
        send.mock.calls.filter(
          ([message]) => message.idempotencyKey === `athena-mail-${assertDefined(intent).id}`,
        ),
      ).toHaveLength(1);
    } finally {
      send.mockRestore();
    }
  },
);

it.each(['missing-workspace', 'missing-member', 'no-owner-reply-consent'] as const)(
  'rejects %s enrollment without changing existing channel authority',
  async (boundary) => {
    const { owner, orgId, mailbox, humanActorId } = await enrolled(schema);
    if (boundary === 'missing-member')
      await schema.db
        .update(schema.actor)
        .set({ userId: null })
        .where(eq(schema.actor.id, humanActorId));
    await expect(
      configureMailChannel(owner, {
        enabled: true,
        ownerRepliesEnabled: boundary !== 'no-owner-reply-consent',
        organizationId: boundary === 'missing-workspace' ? null : OrganizationId.parse(orgId),
      }),
    ).rejects.toThrow();
    const [unchanged] = await schema.db
      .select()
      .from(schema.athenaMailbox)
      .where(eq(schema.athenaMailbox.id, mailbox.id));
    expect(assertDefined(unchanged).revision).toBe(mailbox.revision);
    expect(assertDefined(unchanged).ownerAddress).toBe(mailbox.ownerAddress);
    expect(assertDefined(unchanged).enabled).toBe(true);
  },
);

it.each([
  'missing-session',
  'missing-approval',
  'canceled-operation',
  'interrupted-operation',
] as const)('does not send external email with %s', async (boundary) => {
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
      status: boundary === 'canceled-operation' ? 'canceled' : 'pending',
      interruptedAt: boundary === 'interrupted-operation' ? new Date() : null,
    })
    .returning();
  const [intent] = await schema.db
    .insert(schema.athenaMailOutbox)
    .values({
      ownerUserId: owner,
      mailboxId: mailbox.id,
      channelRevision: mailbox.revision,
      sessionId: boundary === 'missing-session' ? null : assertDefined(session).id,
      toAddress: 'external-recipient@example.com',
      subject: 'Unapproved effect',
      bodyText: 'Do not send.',
      externalRecipient: true,
    })
    .returning();
  const send = vi.spyOn(getContainer().mailer, 'send');
  try {
    await sweepMailOutbox();
    const [result] = await schema.db
      .select()
      .from(schema.athenaMailOutbox)
      .where(eq(schema.athenaMailOutbox.id, assertDefined(intent).id));
    expect(assertDefined(result).status).toBe('canceled');
    expect(assertDefined(result).errorCode).toBe(
      boundary === 'missing-approval' ? 'approval_revoked' : 'operation_canceled',
    );
    expect(
      send.mock.calls.some(
        ([message]) => message.idempotencyKey === `athena-mail-${assertDefined(intent).id}`,
      ),
    ).toBe(false);
  } finally {
    send.mockRestore();
  }
});
