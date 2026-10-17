import { beforeAll, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { assertDefined } from '@docket/test-utils';
import type { SentMessage } from '@docket/mail';
import { getDb } from '../../support/routes-harness';
import { enrolled } from './fixtures';
import { getContainer } from '../../../src/container';
import { configureMailChannel } from '../../../src/services/athena-mail/channel';
import { recordMailProviderEvent, sweepMailOutbox } from '../../../src/services/athena-mail/outbox';
let schema: Awaited<ReturnType<typeof getDb>>;
beforeAll(async () => {
  schema = await getDb();
});

it.each(['fresh', 'expired'] as const)(
  'records an accepted in-flight send with a %s lease and delivery callback after disable',
  async (lease) => {
    const { owner, mailbox } = await enrolled(schema);
    const [intent] = await schema.db
      .insert(schema.athenaMailOutbox)
      .values({
        ownerUserId: owner,
        mailboxId: mailbox.id,
        channelRevision: mailbox.revision,
        toAddress: assertDefined(mailbox.ownerAddress),
        subject: 'Already in flight',
        bodyText: 'Owner result.',
      })
      .returning();
    const row = assertDefined(intent);
    let signalEntered: (() => void) | undefined;
    let releaseReceipt: ((receipt: SentMessage) => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      signalEntered = resolve;
    });
    const receipt = new Promise<SentMessage>((resolve) => {
      releaseReceipt = resolve;
    });
    const original = getContainer().mailer.send.bind(getContainer().mailer);
    const send = vi.spyOn(getContainer().mailer, 'send').mockImplementation(async (message) => {
      if (message.idempotencyKey !== `athena-mail-${row.id}`) return original(message);
      assertDefined(signalEntered)();
      return receipt;
    });
    const draining = sweepMailOutbox();
    try {
      await entered;
      if (lease === 'expired')
        await schema.db
          .update(schema.athenaMailOutbox)
          .set({ leaseExpiresAt: new Date(0) })
          .where(eq(schema.athenaMailOutbox.id, row.id));
      await configureMailChannel(owner, {
        enabled: false,
        ownerRepliesEnabled: false,
        organizationId: null,
      });
      assertDefined(releaseReceipt)({
        id: `accepted-${row.id}`,
        to: row.toAddress,
        subject: row.subject,
        text: row.bodyText,
        sentAt: new Date().toISOString(),
      });
      await draining;
      const [sent] = await schema.db
        .select()
        .from(schema.athenaMailOutbox)
        .where(eq(schema.athenaMailOutbox.id, row.id));
      expect(assertDefined(sent).status).toBe('sent');
      expect(assertDefined(sent).providerMessageId).toBe(`accepted-${row.id}`);
      await recordMailProviderEvent(`accepted-${row.id}`, 'delivered');
      const [delivered] = await schema.db
        .select()
        .from(schema.athenaMailOutbox)
        .where(eq(schema.athenaMailOutbox.id, row.id));
      expect(assertDefined(delivered).status).toBe('delivered');
      expect(
        send.mock.calls.filter(([message]) => message.idempotencyKey === `athena-mail-${row.id}`),
      ).toHaveLength(1);
    } finally {
      releaseReceipt?.({
        id: `accepted-${row.id}`,
        to: row.toAddress,
        subject: row.subject,
        sentAt: new Date().toISOString(),
      });
      await draining;
      send.mockRestore();
    }
  },
);

it.each(['queued', 'sending'] as const)(
  'exposes revoked %s work with a prior ambiguous attempt as uncertain without retrying',
  async (status) => {
    const { owner, mailbox } = await enrolled(schema);
    const [intent] = await schema.db
      .insert(schema.athenaMailOutbox)
      .values({
        ownerUserId: owner,
        mailboxId: mailbox.id,
        channelRevision: mailbox.revision,
        toAddress: assertDefined(mailbox.ownerAddress),
        subject: 'Possibly accepted',
        bodyText: 'Do not resend.',
        status,
        attempts: 1,
        firstAttemptAt: new Date(Date.now() - 120_000),
        leaseToken: 'dead-process',
        leaseExpiresAt: new Date(0),
      })
      .returning();
    await configureMailChannel(owner, {
      enabled: false,
      ownerRepliesEnabled: false,
      organizationId: null,
    });
    const send = vi.spyOn(getContainer().mailer, 'send');
    try {
      await sweepMailOutbox();
      const [result] = await schema.db
        .select()
        .from(schema.athenaMailOutbox)
        .where(eq(schema.athenaMailOutbox.id, assertDefined(intent).id));
      expect(assertDefined(result).status).toBe('uncertain');
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

it('cancels a revoked queued intent that has never attempted delivery', async () => {
  const { owner, mailbox } = await enrolled(schema);
  const [intent] = await schema.db
    .insert(schema.athenaMailOutbox)
    .values({
      ownerUserId: owner,
      mailboxId: mailbox.id,
      channelRevision: mailbox.revision,
      toAddress: assertDefined(mailbox.ownerAddress),
      subject: 'Unsent',
      bodyText: 'Can cancel safely.',
    })
    .returning();
  await configureMailChannel(owner, {
    enabled: false,
    ownerRepliesEnabled: false,
    organizationId: null,
  });
  const [result] = await schema.db
    .select()
    .from(schema.athenaMailOutbox)
    .where(eq(schema.athenaMailOutbox.id, assertDefined(intent).id));
  expect(assertDefined(result).status).toBe('canceled');
  expect(assertDefined(result).attempts).toBe(0);
});

it('never requeues an in-flight ambiguous response once channel authority is revoked', async () => {
  const { owner, mailbox } = await enrolled(schema);
  const [intent] = await schema.db
    .insert(schema.athenaMailOutbox)
    .values({
      ownerUserId: owner,
      mailboxId: mailbox.id,
      channelRevision: mailbox.revision,
      toAddress: assertDefined(mailbox.ownerAddress),
      subject: 'In flight',
      bodyText: 'Acceptance may be lost.',
    })
    .returning();
  const row = assertDefined(intent);
  const original = getContainer().mailer.send.bind(getContainer().mailer);
  const send = vi.spyOn(getContainer().mailer, 'send').mockImplementation(async (message) => {
    if (message.idempotencyKey !== `athena-mail-${row.id}`) return original(message);
    await configureMailChannel(owner, {
      enabled: false,
      ownerRepliesEnabled: false,
      organizationId: null,
    });
    throw new Error('Acceptance response lost after disable');
  });
  try {
    await sweepMailOutbox();
    await sweepMailOutbox(new Date(Date.now() + 3600_000));
    const [result] = await schema.db
      .select()
      .from(schema.athenaMailOutbox)
      .where(eq(schema.athenaMailOutbox.id, row.id));
    expect(assertDefined(result).status).toBe('uncertain');
    expect(
      send.mock.calls.filter(([message]) => message.idempotencyKey === `athena-mail-${row.id}`),
    ).toHaveLength(1);
  } finally {
    send.mockRestore();
  }
});

it('parks an expired prior send if workspace authority disappeared without a settings change', async () => {
  const { owner, mailbox, humanActorId } = await enrolled(schema);
  const [intent] = await schema.db
    .insert(schema.athenaMailOutbox)
    .values({
      ownerUserId: owner,
      mailboxId: mailbox.id,
      channelRevision: mailbox.revision,
      toAddress: assertDefined(mailbox.ownerAddress),
      subject: 'Unknown outcome',
      bodyText: 'No blind retry.',
      status: 'sending',
      attempts: 1,
      firstAttemptAt: new Date(Date.now() - 120_000),
      leaseToken: 'crashed-worker',
      leaseExpiresAt: new Date(0),
    })
    .returning();
  await schema.db
    .update(schema.actor)
    .set({ archivedAt: new Date() })
    .where(eq(schema.actor.id, humanActorId));
  const send = vi.spyOn(getContainer().mailer, 'send');
  try {
    await sweepMailOutbox();
    const [result] = await schema.db
      .select()
      .from(schema.athenaMailOutbox)
      .where(eq(schema.athenaMailOutbox.id, assertDefined(intent).id));
    expect(assertDefined(result).status).toBe('uncertain');
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
