import { resolve } from 'node:path';

import type { BillingEvent } from '@docket/boundaries';
import { type Database, organization } from '@docket/db';
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, describe, expect, it } from 'vitest';

import { applyBillingEvent } from './lifecycle';

const NOW = '2026-01-01T00:00:00.000Z';
let db!: Database;

/** Insert an org in a state, returning its id. */
async function makeOrg(
  state: (typeof organization.$inferSelect)['lifecycleState'],
): Promise<string> {
  const slug = `lx-${Math.random().toString(36).slice(2, 10)}`;
  const rows = await db
    .insert(organization)
    .values({ name: slug, slug, lifecycleState: state })
    .returning({ id: organization.id });
  return rows[0]!.id;
}

/** Read an org's lifecycle state. */
async function stateOf(id: string): Promise<string> {
  const rows = await db
    .select({ s: organization.lifecycleState })
    .from(organization)
    .where(eq(organization.id, id))
    .limit(1);
  return rows[0]!.s;
}

/** Build a subscription-less billing event of the given type for an org. */
function evt(type: BillingEvent['type'], referenceId: string): BillingEvent {
  return { id: `evt-${Math.random()}`, type, referenceId, createdAt: NOW };
}

beforeAll(async () => {
  const client = new PGlite('memory://');
  const d = drizzle(client);
  await migrate(d, {
    migrationsFolder: resolve(import.meta.dirname, '../../../../packages/db/drizzle'),
  });
  db = d as unknown as Database;
});

describe('applyBillingEvent — effectFor type fallback (events with no subscription snapshot)', () => {
  it('checkout.completed → active', async () => {
    const id = await makeOrg('export_window');
    expect(await applyBillingEvent(db, evt('checkout.completed', id), NOW)).toBe('active');
    expect(await stateOf(id)).toBe('active');
  });

  it('subscription.created → active', async () => {
    const id = await makeOrg('export_window');
    expect(await applyBillingEvent(db, evt('subscription.created', id), NOW)).toBe('active');
  });

  it('subscription.updated → active', async () => {
    const id = await makeOrg('export_window');
    expect(await applyBillingEvent(db, evt('subscription.updated', id), NOW)).toBe('active');
  });

  it('subscription.trial_will_end → none (no state change)', async () => {
    const id = await makeOrg('active');
    expect(await applyBillingEvent(db, evt('subscription.trial_will_end', id), NOW)).toBe('none');
    expect(await stateOf(id)).toBe('active');
  });

  it('subscription.past_due → past_due', async () => {
    const id = await makeOrg('active');
    expect(await applyBillingEvent(db, evt('subscription.past_due', id), NOW)).toBe('past_due');
    expect(await stateOf(id)).toBe('past_due');
  });

  it('subscription.canceled → export_window', async () => {
    const id = await makeOrg('active');
    expect(await applyBillingEvent(db, evt('subscription.canceled', id), NOW)).toBe(
      'export_window',
    );
    expect(await stateOf(id)).toBe('export_window');
  });

  it('a subscription snapshot with status active short-circuits to active', async () => {
    const id = await makeOrg('export_window');
    const event: BillingEvent = {
      id: 'e-sub-active',
      type: 'subscription.updated',
      referenceId: id,
      createdAt: NOW,
      subscription: { id: 'sub', referenceId: id, status: 'active', currentPeriodEnd: NOW },
    };
    expect(await applyBillingEvent(db, event, NOW)).toBe('active');
  });
});
