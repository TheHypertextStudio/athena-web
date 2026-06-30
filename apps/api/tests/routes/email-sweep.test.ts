import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { getDb, one, seedBaseOrg } from './harness.test';
import { sweepEmailSuggestions } from '../../src/lib/email-to-task/sweep';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
});

async function seedGmail(orgId: string, actorId: string, config: Record<string, unknown>) {
  return one(
    await db
      .insert(schema.integration)
      .values({
        organizationId: orgId,
        provider: 'gmail',
        pattern: 'connector',
        roles: ['signal'],
        createdBy: actorId,
        config,
      })
      .returning({ id: schema.integration.id }),
  ).id;
}

describe('sweepEmailSuggestions', () => {
  it('processes opted-in Gmail integrations and creates suggestions from pulled threads', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const integrationId = await seedGmail(orgId, humanActorId, {
      emailToTask: { enabled: true, threshold: 0 }, // threshold 0: every pulled thread passes
    });

    const result = await sweepEmailSuggestions(new Date());
    expect(result.integrations).toBeGreaterThanOrEqual(1);
    expect(result.created).toBeGreaterThanOrEqual(1);

    const rows = await db
      .select()
      .from(schema.emailSuggestion)
      .where(eq(schema.emailSuggestion.integrationId, integrationId));
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]?.status).toBe('pending');

    // The opt-in sweep also seeds the org's default automation rules (idempotently).
    const seeded = await db
      .select()
      .from(schema.automationRule)
      .where(eq(schema.automationRule.organizationId, orgId));
    expect(seeded.length).toBeGreaterThan(0);
    expect(seeded.every((r) => r.isSeed)).toBe(true);
  });

  it('is idempotent — a second sweep creates no new suggestions', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    await seedGmail(orgId, humanActorId, { emailToTask: { enabled: true, threshold: 0 } });
    await sweepEmailSuggestions(new Date());
    const before = (
      await db
        .select()
        .from(schema.emailSuggestion)
        .where(eq(schema.emailSuggestion.organizationId, orgId))
    ).length;
    await sweepEmailSuggestions(new Date());
    const after = (
      await db
        .select()
        .from(schema.emailSuggestion)
        .where(eq(schema.emailSuggestion.organizationId, orgId))
    ).length;
    expect(after).toBe(before);
  });

  it('skips Gmail integrations that have not opted in (no hidden default)', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    await seedGmail(orgId, humanActorId, {}); // no emailToTask config
    await sweepEmailSuggestions(new Date());
    const rows = await db
      .select()
      .from(schema.emailSuggestion)
      .where(eq(schema.emailSuggestion.organizationId, orgId));
    expect(rows).toHaveLength(0);
  });
});
