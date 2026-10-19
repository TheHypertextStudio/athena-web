import type * as Environment from '../../../src/env';
import type { InboundMessage } from '@docket/mail';
import { OrganizationId } from '@docket/identity-access/ids';
import { assertDefined } from '@docket/test-utils';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '../../support/routes-harness';
import { enrolled } from './fixtures';
import { env } from '../../../src/env';
import { getContainer } from '../../../src/container';
import * as mailboxStore from '../../../src/routes/athena-mail-store';
import { deliverInboundMail } from '../../../src/routes/inbound-mail-delivery';
import {
  configureMailChannel,
  mailChannelConfigured,
} from '../../../src/services/athena-mail/channel';
import { mailSessionAuthorized } from '../../../src/services/athena-mail/session-auth';
import { sweepMailIngress } from '../../../src/services/athena-mail/ingress';
import * as inboxProjection from '../../../src/services/athena-mail/inbox';

vi.mock('../../../src/env', async (importOriginal) => {
  const actual = await importOriginal<typeof Environment>();
  return { ...actual, env: { ...actual.env } };
});
let schema: Awaited<ReturnType<typeof getDb>>;
beforeAll(async () => {
  schema = await getDb();
});
afterEach(() => vi.restoreAllMocks());

async function receive(
  mailbox: typeof schema.athenaMailbox.$inferSelect,
  overrides: Partial<InboundMessage> = {},
) {
  const key = `authority-recovery-${Math.random()}`;
  const outcome = await deliverInboundMail(
    {
      providerMessageId: key,
      rfc822MessageId: `<${key}@example.com>`,
      fromAddress: assertDefined(mailbox.ownerAddress),
      fromName: null,
      to: [assertDefined(mailboxStore.mailboxAddress(mailbox))],
      cc: [],
      subject: 'Private owner request',
      text: 'Please summarize this request.',
      html: null,
      bodyStatus: 'complete',
      receivedAt: new Date().toISOString(),
      authentication: { spf: 'pass', dkim: 'pass', dmarc: 'pass' },
      attachments: [],
      ...overrides,
    },
    'fixture',
  );
  expect(outcome.status).toBe('delivered');
  const [row] = await schema.db
    .select()
    .from(schema.athenaInboundMessage)
    .where(eq(schema.athenaInboundMessage.providerMessageId, key));
  return assertDefined(row);
}
async function reload(id: string) {
  const [row] = await schema.db
    .select()
    .from(schema.athenaInboundMessage)
    .where(eq(schema.athenaInboundMessage.id, id));
  return assertDefined(row);
}
async function sweep() {
  return sweepMailIngress({
    run: async (_organizationId, sessionId) => {
      const [session] = await schema.db
        .select()
        .from(schema.agentSession)
        .where(eq(schema.agentSession.id, sessionId));
      return assertDefined(session);
    },
  });
}

it.each(['revoked', 'authentication-lost', 'automatic'] as const)(
  'does not admit a captured owner request when %s changes before the scheduled sweep',
  async (change) => {
    const { mailbox } = await enrolled(schema);
    const message = await receive(mailbox);
    if (change === 'revoked')
      await schema.db
        .update(schema.athenaMailbox)
        .set({ enabled: false })
        .where(eq(schema.athenaMailbox.id, mailbox.id));
    else
      await schema.db
        .update(schema.athenaInboundMessage)
        .set(
          change === 'automatic'
            ? { headers: { 'auto-submitted': 'auto-replied' } }
            : { authentication: null },
        )
        .where(eq(schema.athenaInboundMessage.id, message.id));
    await sweep();
    const captured = await reload(message.id);
    expect(captured.processingStatus).toBe('captured');
    expect(captured.sessionId).toBeNull();
  },
);

it.each(['html', 'empty', 'untrusted'] as const)(
  'recovers %s provider content without requiring a connected client',
  async (kind) => {
    const { mailbox } = await enrolled(schema);
    const message = await receive(mailbox, { text: null, bodyStatus: 'metadata-only' });
    const receiver = getContainer().inboundMail;
    const original = receiver.retrieve?.bind(receiver);
    Object.assign(receiver, {
      retrieve: vi.fn(async () => ({
        text: null,
        html: kind === 'html' ? '<p>My private priorities</p>' : null,
        ...(kind === 'untrusted'
          ? {}
          : { authentication: { spf: 'pass', dkim: 'pass', dmarc: 'pass' } }),
      })),
    });
    try {
      await sweep();
      const hydrated = await reload(message.id);
      expect(hydrated.bodyStatus).toBe('complete');
      expect(hydrated.bodyText).toBe(kind === 'html' ? 'My private priorities' : null);
      await sweep();
      const admitted = await reload(message.id);
      expect(admitted.processingStatus).toBe(kind === 'untrusted' ? 'captured' : 'running');
      expect(admitted.sessionId === null).toBe(kind === 'untrusted');
    } finally {
      Object.assign(receiver, { retrieve: original });
    }
  },
);

it('retains metadata until the receiving adapter becomes available and retries the same receipt', async () => {
  const { mailbox } = await enrolled(schema);
  const message = await receive(mailbox, { text: null, bodyStatus: 'metadata-only' });
  const receiver = getContainer().inboundMail;
  const original = receiver.retrieve?.bind(receiver);
  try {
    Object.assign(receiver, { retrieve: undefined });
    await sweep();
    expect((await reload(message.id)).processingStatus).toBe('hydrating');
    Object.assign(receiver, {
      retrieve: vi.fn(async () => ({
        text: 'Recovered owner request',
        html: null,
        authentication: { spf: 'pass', dkim: 'pass', dmarc: 'pass' },
      })),
    });
    await sweep();
    await sweep();
    const recovered = await reload(message.id);
    expect(recovered.bodyText).toBe('Recovered owner request');
    expect(recovered.processingStatus).toBe('running');
    expect(recovered.sessionId).not.toBeNull();
  } finally {
    Object.assign(receiver, { retrieve: original });
  }
});

it.each(['too-large', 'hourly-limit'] as const)(
  'bounds paid work for %s requests and queues one owner explanation',
  async (boundary) => {
    const { owner, orgId, mailbox } = await enrolled(schema);
    if (boundary === 'hourly-limit')
      await schema.db.insert(schema.agentSession).values(
        Array.from({ length: 20 }, (_, index) => ({
          executorKind: 'athena' as const,
          ownerUserId: owner,
          contextOrganizationId: orgId,
          kind: 'job' as const,
          workLinkage: 'observation' as const,
          trigger: 'mention' as const,
          status: 'completed' as const,
          externalRunRef: `athena-mail:budget-${owner}-${index}`,
        })),
      );
    const message = await receive(mailbox, {
      text: boundary === 'too-large' ? 'x'.repeat(50_001) : 'Normal request',
    });
    await sweep();
    await sweep();
    const rejected = await reload(message.id);
    expect(rejected.sessionId).toBeNull();
    expect(rejected.processingStatus).toBe(boundary === 'too-large' ? 'too_large' : 'rate_limited');
    const notices = await schema.db
      .select()
      .from(schema.athenaMailOutbox)
      .where(eq(schema.athenaMailOutbox.ownerUserId, owner));
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ toAddress: mailbox.ownerAddress, responseStage: 'limit' });
    expect(assertDefined(notices[0]).bodyText).toContain(
      boundary === 'too-large' ? '50,000' : 'limit for this hour',
    );
  },
);

it('uses only current authorized thread content, even when references name another owner or old enrollment', async () => {
  const { owner, mailbox } = await enrolled(schema);
  const { mailbox: otherMailbox } = await enrolled(schema);
  const prior = await receive(mailbox, { text: 'Current owner context' });
  const other = await receive(otherMailbox, { text: 'OTHER OWNER SECRET' });
  const stale = await receive(mailbox, { text: 'REVOKED ENROLLMENT SECRET' });
  await schema.db
    .update(schema.athenaInboundMessage)
    .set({ processingStatus: 'replied' })
    .where(eq(schema.athenaInboundMessage.id, prior.id));
  await schema.db
    .update(schema.athenaInboundMessage)
    .set({ processingStatus: 'replied', channelRevision: mailbox.revision - 1 })
    .where(eq(schema.athenaInboundMessage.id, stale.id));
  const replyId = `<athena-context-${mailbox.id}@example.com>`;
  await schema.db.insert(schema.athenaMailOutbox).values({
    ownerUserId: owner,
    mailboxId: mailbox.id,
    channelRevision: mailbox.revision,
    toAddress: assertDefined(mailbox.ownerAddress),
    subject: 'Earlier answer',
    bodyText: 'Previously delivered Athena result',
    status: 'delivered',
    headers: { 'Message-ID': replyId },
  });
  const message = await receive(mailbox, {
    headers: {
      references: [
        prior.rfc822MessageId,
        other.rfc822MessageId,
        stale.rfc822MessageId,
        replyId,
      ].join(' '),
    },
  });
  await sweep();
  const admitted = await reload(message.id);
  const activities = await schema.db
    .select()
    .from(schema.sessionActivity)
    .where(eq(schema.sessionActivity.sessionId, assertDefined(admitted.sessionId)));
  const context = activities.map((row) => row.body.text ?? '').join('\n');
  expect(context).toContain('Current owner context');
  expect(context).toContain('Previously delivered Athena result');
  expect(context).not.toContain('OTHER OWNER SECRET');
  expect(context).not.toContain('REVOKED ENROLLMENT SECRET');
});

it('does not revive a source receipt lacking an enrollment revision after the owner enrolls', async () => {
  const { mailbox } = await enrolled(schema);
  const message = await receive(mailbox);
  await schema.db
    .update(schema.athenaInboundMessage)
    .set({ channelRevision: null, processingStatus: 'captured' })
    .where(eq(schema.athenaInboundMessage.id, message.id));
  expect(
    await mailSessionAuthorized({ id: 'detached', externalRunRef: `athena-mail:${message.id}` }),
  ).toBe(false);
  expect(await mailSessionAuthorized({ id: 'normal-chat', externalRunRef: null })).toBe(true);
  expect(
    await mailSessionAuthorized({ id: 'deleted-source', externalRunRef: 'athena-mail:absent' }),
  ).toBe(false);
});

it('allows an unverified owner to disable email and removes the enrolled address', async () => {
  const { owner } = await enrolled(schema);
  await schema.db
    .update(schema.user)
    .set({ emailVerified: false })
    .where(eq(schema.user.id, owner));
  const settings = await configureMailChannel(owner, {
    enabled: false,
    ownerRepliesEnabled: false,
    organizationId: null,
  });
  expect(settings).toMatchObject({ enabled: false, ownerAddress: null, organizationId: null });
});

it('requires complete deployed receiving and sending settings before enrollment without exposing credentials', async () => {
  const { owner, orgId } = await enrolled(schema);
  const original = { ...env };
  try {
    Object.assign(env, {
      APP_MODE: 'production',
      RESEND_RECEIVING_API_KEY: 'test-receiving',
      RESEND_API_KEY: 'test-sending',
      RESEND_INBOUND_WEBHOOK_SECRET: 'test-webhook',
      MAIL_FROM: 'Athena <athena@example.com>',
    });
    expect(mailChannelConfigured()).toBe(true);
    Object.assign(env, { RESEND_RECEIVING_API_KEY: undefined });
    expect(mailChannelConfigured()).toBe(true);
    for (const key of ['RESEND_API_KEY', 'RESEND_INBOUND_WEBHOOK_SECRET', 'MAIL_FROM'] as const) {
      const previous = env[key];
      Object.assign(env, { [key]: undefined });
      expect(mailChannelConfigured()).toBe(false);
      await expect(
        configureMailChannel(owner, {
          enabled: true,
          ownerRepliesEnabled: true,
          organizationId: OrganizationId.parse(orgId),
        }),
      ).rejects.toThrow('Email channel is not configured');
      Object.assign(env, { [key]: previous });
    }
    vi.spyOn(mailboxStore, 'athenaMailHost').mockReturnValue(null);
    expect(mailChannelConfigured()).toBe(false);
  } finally {
    Object.assign(env, original);
  }
});

it.each(['disabled', 'other-sender'] as const)(
  'retrieves captured %s email without granting execution after enrollment changes',
  async (kind) => {
    const { owner, orgId, mailbox } = await enrolled(schema);
    if (kind === 'disabled')
      await configureMailChannel(owner, {
        enabled: false,
        ownerRepliesEnabled: false,
        organizationId: OrganizationId.parse(orgId),
      });
    const message = await receive(mailbox, {
      text: null,
      bodyStatus: 'metadata-only',
      ...(kind === 'other-sender' ? { fromAddress: 'someone@example.com' } : {}),
    });
    expect(message.processingStatus).toBe('captured');
    const receiver = getContainer().inboundMail;
    const original = receiver.retrieve?.bind(receiver);
    Object.assign(receiver, {
      retrieve: vi.fn(async () => ({
        text: 'Readable captured context',
        html: null,
        authentication: { spf: 'pass', dkim: 'pass', dmarc: 'pass' },
      })),
    });
    try {
      await configureMailChannel(owner, {
        enabled: true,
        ownerRepliesEnabled: true,
        organizationId: OrganizationId.parse(orgId),
      });
      await sweep();
      await sweep();
      const saved = await reload(message.id);
      expect(saved.bodyStatus).toBe('complete');
      expect(saved.bodyText).toBe('Readable captured context');
      expect(saved.processingStatus).toBe('captured');
      expect(saved.sessionId).toBeNull();
    } finally {
      Object.assign(receiver, { retrieve: original });
    }
  },
);

it('retries message content and its Inbox preview together after a projection failure', async () => {
  const { mailbox } = await enrolled(schema);
  const message = await receive(mailbox, { text: null, bodyStatus: 'metadata-only' });
  const receiver = getContainer().inboundMail;
  const original = receiver.retrieve?.bind(receiver);
  Object.assign(receiver, {
    retrieve: vi.fn(async () => ({
      text: 'Recovered Inbox preview',
      html: null,
      authentication: { spf: 'pass', dkim: 'pass', dmarc: 'pass' },
    })),
  });
  vi.spyOn(inboxProjection, 'projectMailInboxItem').mockRejectedValueOnce(
    new Error('Temporary write failure'),
  );
  try {
    await sweep();
    expect((await reload(message.id)).bodyStatus).toBe('metadata-only');
    await sweep();
    expect((await reload(message.id)).bodyStatus).toBe('complete');
    const [item] = await schema.db
      .select()
      .from(schema.notification)
      .where(eq(schema.notification.id, message.id));
    expect(assertDefined(item).body.summary).toContain('Recovered Inbox preview');
  } finally {
    Object.assign(receiver, { retrieve: original });
  }
});
