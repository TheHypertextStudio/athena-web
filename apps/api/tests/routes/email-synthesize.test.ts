import { MockTaskSynthesizer } from '@docket/boundaries';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { getDb, one, seedBaseOrg } from './harness.test';
import { persistSuggestions, type CandidateThread } from '../../src/lib/email-to-task/synthesize';

const synthesizer = new MockTaskSynthesizer();

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
});

async function seedOrgWithGmail() {
  const { orgId, humanActorId } = await seedBaseOrg(db, schema);
  const integration = one(
    await db
      .insert(schema.integration)
      .values({
        organizationId: orgId,
        provider: 'gmail',
        pattern: 'connector',
        roles: ['signal'],
        createdBy: humanActorId,
      })
      .returning({ id: schema.integration.id }),
  );
  return { orgId, humanActorId, integrationId: integration.id };
}

const THREADS: CandidateThread[] = [
  {
    threadId: 't-action',
    subject: 'Can you confirm the interview slot?',
    snippet: 'Please reply by Friday',
    sender: 'recruiter@google.com',
    receivedAt: '2026-01-01T00:00:00.000Z',
    rfc822MessageId: '<t-action-1@google.com>',
    externalUrl: 'https://mail.mock.docket.local/#all/t-action',
  },
  {
    threadId: 't-promo',
    subject: '50% off sale — limited time!',
    snippet: 'unsubscribe here',
    sender: 'deals@shop.com',
    externalUrl: 'https://mail.mock.docket.local/#all/t-promo',
  },
];

describe('persistSuggestions', () => {
  it('creates suggestions for worthy threads and drops promotions', async () => {
    const { orgId, humanActorId, integrationId } = await seedOrgWithGmail();
    const result = await persistSuggestions({
      organizationId: orgId,
      integrationId,
      threads: THREADS,
      threshold: 50,
      actorId: humanActorId,
      synthesizer,
    });

    expect(result.created).toBe(1); // the actionable one; the promo is funneled out
    const rows = await db
      .select()
      .from(schema.emailSuggestion)
      .where(eq(schema.emailSuggestion.organizationId, orgId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.externalThreadId).toBe('t-action');
    expect(rows[0]?.title).toContain('interview');
    expect(rows[0]?.confidence).toBeGreaterThanOrEqual(50);
    expect(rows[0]?.status).toBe('pending');
    // The RFC 5322 identity + provider URL are persisted for dedup and rendering.
    expect(rows[0]?.rfc822MessageId).toBe('<t-action-1@google.com>');
    expect(rows[0]?.emailMeta).toMatchObject({
      externalUrl: 'https://mail.mock.docket.local/#all/t-action',
      rfc822MessageId: '<t-action-1@google.com>',
      receivedAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('dedups cross-provider by Message-ID — a different threadId with a known Message-ID is skipped', async () => {
    const { orgId, humanActorId, integrationId } = await seedOrgWithGmail();
    await persistSuggestions({
      organizationId: orgId,
      integrationId,
      threads: [THREADS[0]!],
      threshold: 50,
      actorId: humanActorId,
      synthesizer,
    });
    // The same email arriving via another provider: different thread id, same Message-ID.
    const second = await persistSuggestions({
      organizationId: orgId,
      integrationId,
      threads: [
        {
          ...THREADS[0]!,
          threadId: 'outlook-conversation-9',
          externalUrl: 'https://outlook.mock.docket.local/mail/9',
        },
      ],
      threshold: 50,
      actorId: humanActorId,
      synthesizer,
    });
    expect(second.created).toBe(0);
    const rows = await db
      .select()
      .from(schema.emailSuggestion)
      .where(eq(schema.emailSuggestion.organizationId, orgId));
    expect(rows).toHaveLength(1);
  });

  it('persists the synthesizer dueDate when the email states one (mock ISO-date rule)', async () => {
    const { orgId, humanActorId, integrationId } = await seedOrgWithGmail();
    const result = await persistSuggestions({
      organizationId: orgId,
      integrationId,
      threads: [
        {
          threadId: 't-dated',
          subject: 'Can you file the report?',
          snippet: 'Please file the quarterly report by 2026-07-15 at the latest.',
          sender: 'cfo@example.com',
          externalUrl: 'https://mail.mock.docket.local/#all/t-dated',
        },
      ],
      threshold: 50,
      actorId: humanActorId,
      synthesizer,
    });
    expect(result.created).toBe(1);
    expect(result.synthCalls).toBe(1);
    const row = one(
      await db
        .select()
        .from(schema.emailSuggestion)
        .where(
          and(
            eq(schema.emailSuggestion.organizationId, orgId),
            eq(schema.emailSuggestion.externalThreadId, 't-dated'),
          ),
        ),
    );
    expect(row.dueDate?.toISOString()).toBe('2026-07-15T00:00:00.000Z');
  });

  it('is idempotent — re-running the same threads creates nothing new', async () => {
    const { orgId, humanActorId, integrationId } = await seedOrgWithGmail();
    await persistSuggestions({
      organizationId: orgId,
      integrationId,
      threads: THREADS,
      threshold: 50,
      actorId: humanActorId,
      synthesizer,
    });
    const second = await persistSuggestions({
      organizationId: orgId,
      integrationId,
      threads: THREADS,
      threshold: 50,
      actorId: humanActorId,
      synthesizer,
    });
    expect(second.created).toBe(0);
    // The counters make the skip visible: funnel passed, but nothing reached the paid model.
    expect(second.skippedExisting).toBe(1);
    expect(second.synthCalls).toBe(0);
    const rows = await db
      .select()
      .from(schema.emailSuggestion)
      .where(eq(schema.emailSuggestion.organizationId, orgId));
    expect(rows).toHaveLength(1);
  });

  it('honors an injected synthesizer', async () => {
    const { orgId, humanActorId, integrationId } = await seedOrgWithGmail();
    await persistSuggestions({
      organizationId: orgId,
      integrationId,
      threads: [THREADS[0]!],
      threshold: 50,
      actorId: humanActorId,
      synthesizer: {
        synthesize: async () => ({ title: 'Custom synthesized title', priority: 'urgent' }),
      },
    });
    const row = one(
      await db
        .select()
        .from(schema.emailSuggestion)
        .where(
          and(
            eq(schema.emailSuggestion.organizationId, orgId),
            eq(schema.emailSuggestion.externalThreadId, 't-action'),
          ),
        ),
    );
    expect(row.title).toBe('Custom synthesized title');
    expect(row.priority).toBe('urgent');
  });
});
