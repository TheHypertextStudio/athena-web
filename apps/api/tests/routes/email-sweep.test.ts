import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { getDb, one, seedBaseOrg } from '../support/routes-harness';
import { sweepEmailSuggestions } from '../../src/lib/email-to-task/sweep';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
});

async function seedGmail(
  orgId: string,
  actorId: string,
  config: Record<string, unknown>,
  over: Partial<{ syncState: Record<string, unknown> }> = {},
) {
  return one(
    await db
      .insert(schema.integration)
      .values({
        organizationId: orgId,
        provider: 'gmail',
        pattern: 'connector',
        roles: ['signal'],
        status: 'connected',
        createdBy: actorId,
        config,
        ...(over.syncState ? { syncState: over.syncState } : {}),
      })
      .returning({ id: schema.integration.id }),
  ).id;
}

describe('sweepEmailSuggestions (the email_ingest purpose on the leased spine)', () => {
  it('ingests opted-in mail integrations: suggestions, sync_run history, and an advanced cursor', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const integrationId = await seedGmail(orgId, humanActorId, {
      emailToTask: { enabled: true, threshold: 0 }, // threshold 0: every fixture thread passes
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
    // Real RFC 5322 identity flowed from the listing into the row.
    expect(rows.some((r) => r.rfc822MessageId !== null)).toBe(true);
    expect(
      rows.every((r) => (r.emailMeta as Record<string, unknown>)['externalUrl'] !== undefined),
    ).toBe(true);

    // The pull is a persisted, purposed run on the shared spine…
    const runs = await db
      .select()
      .from(schema.syncRun)
      .where(eq(schema.syncRun.integrationId, integrationId));
    expect(runs).toHaveLength(1);
    expect(runs[0]?.purpose).toBe('email_ingest');
    expect(runs[0]?.status).toBe('succeeded');

    // …and the incremental cursor advanced under the lease.
    const integ = one(
      await db
        .select({ syncState: schema.integration.syncState })
        .from(schema.integration)
        .where(eq(schema.integration.id, integrationId)),
    );
    expect(integ.syncState).toMatchObject({ mail: { cursor: 'mock-cursor-1' } });

    // The opt-in sweep also seeds the org's default automation rules (idempotently).
    const seeded = await db
      .select()
      .from(schema.automationRule)
      .where(eq(schema.automationRule.organizationId, orgId));
    expect(seeded.length).toBeGreaterThan(0);
    expect(seeded.every((r) => r.isSeed)).toBe(true);
  });

  it('feeds the funnel a real sender — the no-reply promo fixture is dropped at a sane threshold', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const integrationId = await seedGmail(orgId, humanActorId, {
      emailToTask: { enabled: true, threshold: 50 },
    });

    await sweepEmailSuggestions(new Date());

    const rows = await db
      .select()
      .from(schema.emailSuggestion)
      .where(eq(schema.emailSuggestion.integrationId, integrationId));
    // Of the two mock fixtures, only the actionable person-sent thread survives the funnel;
    // the promotional no-reply thread is floored below threshold.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.externalThreadId).toBe('gmail-thread-actionable');
  });

  it('recovers from an expired cursor with one full re-pull (idempotent)', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const integrationId = await seedGmail(
      orgId,
      humanActorId,
      { emailToTask: { enabled: true, threshold: 0 } },
      // The mock treats this sentinel cursor as expired (MockConnector.EXPIRED_CURSOR).
      { syncState: { mail: { cursor: 'expired', updatedAt: '2026-01-01T00:00:00.000Z' } } },
    );

    const result = await sweepEmailSuggestions(new Date());
    expect(result.created).toBeGreaterThanOrEqual(1); // the full re-pull still ingested

    const integ = one(
      await db
        .select({ syncState: schema.integration.syncState })
        .from(schema.integration)
        .where(eq(schema.integration.id, integrationId)),
    );
    // The stale cursor was replaced by the full pull's fresh one.
    expect(integ.syncState).toMatchObject({ mail: { cursor: 'mock-cursor-1' } });

    const runs = await db
      .select()
      .from(schema.syncRun)
      .where(
        and(
          eq(schema.syncRun.integrationId, integrationId),
          eq(schema.syncRun.status, 'succeeded'),
        ),
      );
    expect(runs).toHaveLength(1);
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

  it('skips mail integrations that have not opted in (no hidden default)', async () => {
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
