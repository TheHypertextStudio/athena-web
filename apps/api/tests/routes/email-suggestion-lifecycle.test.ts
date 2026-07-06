/**
 * Boundary tests for the suggestion lifecycle sweep: pending rows expire at exactly
 * EXPIRE_PENDING_AFTER_DAYS, resolved rows purge at exactly PURGE_RESOLVED_AFTER_DAYS, and
 * everything younger is untouched. `now` is injected — no wall clock.
 */
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { getDb, one, seedBaseOrg } from './harness.test';
import {
  EXPIRE_PENDING_AFTER_DAYS,
  PURGE_RESOLVED_AFTER_DAYS,
  sweepEmailSuggestionLifecycle,
} from '../../src/lib/email-to-task/lifecycle';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
});

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-07-01T00:00:00.000Z');

async function seedSuggestionAt(
  orgId: string,
  integrationId: string,
  threadId: string,
  status: 'pending' | 'accepted' | 'dismissed',
  ageDays: number,
): Promise<string> {
  const row = one(
    await db
      .insert(schema.emailSuggestion)
      .values({
        organizationId: orgId,
        integrationId,
        externalThreadId: threadId,
        title: `Suggestion ${threadId}`,
        status,
        createdAt: new Date(NOW.getTime() - ageDays * DAY_MS),
      })
      .returning({ id: schema.emailSuggestion.id }),
  );
  return row.id;
}

describe('sweepEmailSuggestionLifecycle', () => {
  it('expires stale pending rows and purges old resolved ones — exact boundaries', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const integ = one(
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

    const freshPending = await seedSuggestionAt(orgId, integ.id, 't-fresh', 'pending', 1);
    const edgePending = await seedSuggestionAt(
      orgId,
      integ.id,
      't-edge',
      'pending',
      EXPIRE_PENDING_AFTER_DAYS, // exactly at the boundary: NOT expired (strictly older only)
    );
    const stalePending = await seedSuggestionAt(
      orgId,
      integ.id,
      't-stale',
      'pending',
      EXPIRE_PENDING_AFTER_DAYS + 1,
    );
    const recentAccepted = await seedSuggestionAt(orgId, integ.id, 't-acc', 'accepted', 30);
    const edgeResolved = await seedSuggestionAt(
      orgId,
      integ.id,
      't-edge-resolved',
      'dismissed',
      PURGE_RESOLVED_AFTER_DAYS, // exactly at the boundary: NOT purged (strictly older only)
    );
    const ancientDismissed = await seedSuggestionAt(
      orgId,
      integ.id,
      't-old',
      'dismissed',
      PURGE_RESOLVED_AFTER_DAYS + 1,
    );

    const result = await sweepEmailSuggestionLifecycle(NOW);
    expect(result.expired).toBe(1);
    expect(result.purged).toBe(1);

    const byId = async (id: string) =>
      (await db.select().from(schema.emailSuggestion).where(eq(schema.emailSuggestion.id, id)))[0];
    expect((await byId(freshPending))?.status).toBe('pending');
    expect((await byId(edgePending))?.status).toBe('pending');
    expect((await byId(stalePending))?.status).toBe('expired');
    expect((await byId(recentAccepted))?.status).toBe('accepted');
    expect((await byId(edgeResolved))?.status).toBe('dismissed'); // still present, not purged
    expect(await byId(ancientDismissed)).toBeUndefined(); // hard-deleted

    // Idempotent: a second run finds nothing new.
    const again = await sweepEmailSuggestionLifecycle(NOW);
    expect(again).toEqual({ expired: 0, purged: 0 });
  });
});
