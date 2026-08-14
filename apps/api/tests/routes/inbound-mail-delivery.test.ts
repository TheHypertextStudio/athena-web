/**
 * Direct unit coverage for `src/routes/inbound-mail-delivery.ts` branches the end-to-end
 * `inbound-mail.test.ts` suite does not reach: every fallback rung of
 * `resolveDeliveryOrganization` (mailbox org → open conversation → workspace membership → none
 * at all), `composeAthenaBriefing`'s per-field fallbacks, the blank-subject title, and the
 * invalid-`receivedAt` recovery. Calling `deliverInboundMail` directly (rather than through the
 * public webhook) makes it cheap to construct each fallback rung's exact precondition.
 */
import type * as DbModule from '@docket/db';
import type { InboundMessage } from '@docket/mail';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DeliveryModule from '../../src/routes/inbound-mail-delivery';
import { getDb, seedBaseOrg, seedUserWithHub } from '../support/routes-harness';
import { assertDefined } from '@docket/test-utils';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let deliverInboundMail!: typeof DeliveryModule.deliverInboundMail;
let composeAthenaBriefing!: typeof DeliveryModule.composeAthenaBriefing;

const HOST = 'inbox.athena.docket.localhost';

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  const mod = await import('../../src/routes/inbound-mail-delivery');
  ({ deliverInboundMail, composeAthenaBriefing } = mod);
});

let seq = 0;

/** A minimal, valid `InboundMessage`, overridable field by field. */
function message(overrides: Partial<InboundMessage> & { to: readonly string[] }): InboundMessage {
  seq += 1;
  return {
    providerMessageId: `pm_${String(seq)}_${Math.random().toString(36).slice(2, 8)}`,
    rfc822MessageId: null,
    fromAddress: 'sender@example.com',
    fromName: 'Sender Name',
    cc: [],
    subject: 'A subject line',
    text: 'Body text',
    html: null,
    bodyStatus: 'complete',
    receivedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
    attachments: [],
    ...overrides,
  };
}

/** Mint a bare mailbox row (no org, no ensureMailbox side-effects) for a fresh user. */
async function seedBareMailbox(userId: string): Promise<{ key: string }> {
  const key = `key${Math.random().toString(36).slice(2, 10)}`;
  await db.insert(schema.athenaMailbox).values({ ownerUserId: userId, key });
  return { key };
}

describe('composeAthenaBriefing (pure)', () => {
  it('includes the sender’s display name, the recipient, and the subject when all are present', () => {
    const text = composeAthenaBriefing(
      message({ to: [`x@${HOST}`], fromName: 'Jane Rivera', subject: 'Renew the plan' }),
      'ctx_1',
    );
    expect(text).toContain('From: Jane Rivera <sender@example.com>');
    expect(text).toContain(`To: x@${HOST}`);
    expect(text).toContain('Subject: Renew the plan');
    expect(text).toContain('ctx_1');
  });

  it('falls back to the bare address when the sender has no display name', () => {
    const text = composeAthenaBriefing(message({ to: [`x@${HOST}`], fromName: null }), 'ctx_2');
    expect(text).toContain('From: sender@example.com');
    expect(text).not.toContain('From: null');
  });

  it('falls back to an empty recipient line when `to` is empty', () => {
    const text = composeAthenaBriefing(message({ to: [] }), 'ctx_3');
    expect(text).toContain('To: \n');
  });

  it('states "(No subject)" for a blank subject', () => {
    const text = composeAthenaBriefing(message({ to: [`x@${HOST}`], subject: '   ' }), 'ctx_4');
    expect(text).toContain('Subject: (No subject)');
  });

  it('lists attachment filenames when the message carries any', () => {
    const text = composeAthenaBriefing(
      message({
        to: [`x@${HOST}`],
        attachments: [
          {
            id: 'a1',
            filename: 'contract.pdf',
            contentType: null,
            contentDisposition: null,
            contentId: null,
          },
          {
            id: 'a2',
            filename: 'invoice.pdf',
            contentType: null,
            contentDisposition: null,
            contentId: null,
          },
        ],
      }),
      'ctx_5',
    );
    expect(text).toContain('Attachments: contract.pdf, invoice.pdf');
  });

  it('states the body is unavailable when the text part was not retrieved', () => {
    const text = composeAthenaBriefing(
      message({ to: [`x@${HOST}`], text: null, bodyStatus: 'metadata-only' }),
      'ctx_6',
    );
    expect(text).toContain('(The message body has not been retrieved.)');
  });
});

describe('deliverInboundMail: resolving which workspace a message is filed into', () => {
  it('is unroutable when the mailbox has no org, no open conversation, and no workspace membership at all', async () => {
    const userId = await seedUserWithHub(db, schema, 'NoOrgAnywhere');
    const { key } = await seedBareMailbox(userId);
    const outcome = await deliverInboundMail(message({ to: [`${key}@${HOST}`] }), 'fixture');
    expect(outcome).toEqual({ status: 'unroutable' });
    const rows = await db
      .select()
      .from(schema.athenaInboundMessage)
      .where(eq(schema.athenaInboundMessage.ownerUserId, userId));
    expect(rows).toHaveLength(0);
  });

  it('falls back to the owner’s open Athena conversation’s workspace when the mailbox has none', async () => {
    const userId = await seedUserWithHub(db, schema, 'FromConversation');
    const { key } = await seedBareMailbox(userId);
    const { orgId } = await seedBaseOrg(db, schema);
    await db.insert(schema.agentSession).values({
      executorKind: 'athena',
      ownerUserId: userId,
      contextOrganizationId: orgId,
      kind: 'chat',
      trigger: 'delegation',
      status: 'pending',
    });

    const outcome = await deliverInboundMail(message({ to: [`${key}@${HOST}`] }), 'fixture');
    expect(outcome.status).toBe('delivered');
    const [row] = await db
      .select()
      .from(schema.athenaInboundMessage)
      .where(eq(schema.athenaInboundMessage.ownerUserId, userId));
    expect(row?.organizationId).toBe(orgId);
  });

  it('falls back to the owner’s workspace membership when there is no mailbox org and no open conversation', async () => {
    const userId = await seedUserWithHub(db, schema, 'FromMembership');
    const { key } = await seedBareMailbox(userId);
    const { orgId } = await seedBaseOrg(db, schema);
    await db.insert(schema.actor).values({
      organizationId: orgId,
      kind: 'human',
      displayName: 'Membership Owner',
      userId,
      status: 'active',
    });

    const outcome = await deliverInboundMail(message({ to: [`${key}@${HOST}`] }), 'fixture');
    expect(outcome.status).toBe('delivered');
    const [row] = await db
      .select()
      .from(schema.athenaInboundMessage)
      .where(eq(schema.athenaInboundMessage.ownerUserId, userId));
    expect(row?.organizationId).toBe(orgId);
  });
});

describe('deliverInboundMail: field-level fallbacks on the stored row', () => {
  it('stores "(No subject)" for a blank subject', async () => {
    const userId = await seedUserWithHub(db, schema, 'BlankSubjectOwner');
    const { key } = await seedBareMailbox(userId);
    await seedBaseOrgMembership(userId);

    await deliverInboundMail(message({ to: [`${key}@${HOST}`], subject: '   ' }), 'fixture');
    const [row] = await db
      .select()
      .from(schema.athenaInboundMessage)
      .where(eq(schema.athenaInboundMessage.ownerUserId, userId));
    expect(row?.title).toBe('(No subject)');
  });

  it('stores the message’s attachment metadata alongside it', async () => {
    const userId = await seedUserWithHub(db, schema, 'AttachmentsOwner');
    const { key } = await seedBareMailbox(userId);
    await seedBaseOrgMembership(userId);

    await deliverInboundMail(
      message({
        to: [`${key}@${HOST}`],
        attachments: [
          {
            id: 'att_1',
            filename: 'contract.pdf',
            contentType: 'application/pdf',
            contentDisposition: 'attachment',
            contentId: null,
          },
        ],
      }),
      'fixture',
    );
    const [row] = await db
      .select()
      .from(schema.athenaInboundMessage)
      .where(eq(schema.athenaInboundMessage.ownerUserId, userId));
    expect(row?.attachments).toEqual([
      { id: 'att_1', filename: 'contract.pdf', contentType: 'application/pdf' },
    ]);
  });

  it('falls back to the current time when receivedAt cannot be parsed', async () => {
    const userId = await seedUserWithHub(db, schema, 'BadReceivedAtOwner');
    const { key } = await seedBareMailbox(userId);
    await seedBaseOrgMembership(userId);

    const before = Date.now();
    await deliverInboundMail(
      message({ to: [`${key}@${HOST}`], receivedAt: 'not-a-real-timestamp' }),
      'fixture',
    );
    const [row] = await db
      .select()
      .from(schema.athenaInboundMessage)
      .where(eq(schema.athenaInboundMessage.ownerUserId, userId));
    expect(row?.receivedAt).toBeInstanceOf(Date);
    expect(Number.isNaN(row?.receivedAt.getTime())).toBe(false);
    expect(assertDefined(row).receivedAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('is a duplicate on a redelivered providerMessageId, and reports the earlier message id', async () => {
    const userId = await seedUserWithHub(db, schema, 'RedeliverOwner');
    const { key } = await seedBareMailbox(userId);
    await seedBaseOrgMembership(userId);
    const providerMessageId = `pm_fixed_${Math.random().toString(36).slice(2, 8)}`;

    const first = await deliverInboundMail(
      message({ to: [`${key}@${HOST}`], providerMessageId }),
      'fixture',
    );
    const second = await deliverInboundMail(
      message({ to: [`${key}@${HOST}`], providerMessageId }),
      'fixture',
    );
    expect(first.status).toBe('delivered');
    expect(second).toEqual({
      status: 'duplicate',
      messageId: (first as { messageId: string }).messageId,
    });
  });
});

/** Give a fresh user an active membership in a fresh org, for tests that only care about the field-level fallback. */
async function seedBaseOrgMembership(userId: string): Promise<string> {
  const { orgId } = await seedBaseOrg(db, schema);
  await db.insert(schema.actor).values({
    organizationId: orgId,
    kind: 'human',
    displayName: 'Field Fallback Owner',
    userId,
    status: 'active',
  });
  return orgId;
}
