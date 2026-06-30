import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { getDb, one, seedBaseOrg } from './harness.test';
import { persistSuggestions, type CandidateThread } from '../../src/lib/email-to-task/synthesize';

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
  },
  {
    threadId: 't-promo',
    subject: '50% off sale — limited time!',
    snippet: 'unsubscribe here',
    sender: 'deals@shop.com',
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
  });

  it('is idempotent — re-running the same threads creates nothing new', async () => {
    const { orgId, humanActorId, integrationId } = await seedOrgWithGmail();
    await persistSuggestions({
      organizationId: orgId,
      integrationId,
      threads: THREADS,
      threshold: 50,
      actorId: humanActorId,
    });
    const second = await persistSuggestions({
      organizationId: orgId,
      integrationId,
      threads: THREADS,
      threshold: 50,
      actorId: humanActorId,
    });
    expect(second.created).toBe(0);
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
      synthesize: () => ({ title: 'Custom synthesized title', priority: 'urgent' }),
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
