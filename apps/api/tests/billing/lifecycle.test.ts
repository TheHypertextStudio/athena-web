import { applyBillingEvent, PAYMENT_GRACE_DAYS } from '@docket/billing/application/lifecycle';
import type { BillingEvent } from '@docket/billing/contracts';
import { type Database, organization, organizationProductEntitlement } from '@docket/db';
import type { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { assertDefined } from '@docket/test-utils';
import { createBillingLifecycleDb } from './test-db';

const NOW = '2026-01-01T00:00:00.000Z';

let db!: Database;
let client: PGlite | undefined;

/** Insert an organization without any billing retention side effects. */
async function makeOrg(isPersonal = false): Promise<string> {
  const slug = `org-${Math.random().toString(36).slice(2, 10)}`;
  const rows = await db
    .insert(organization)
    .values({ name: slug, slug, lifecycleState: 'active', isPersonal })
    .returning({ id: organization.id });
  return assertDefined(rows[0]).id;
}

/** Read the billing access fields that the provider snapshot owns. */
async function readAccess(id: string) {
  const rows = await db
    .select()
    .from(organizationProductEntitlement)
    .where(eq(organizationProductEntitlement.organizationId, id))
    .limit(1);
  return assertDefined(rows[0]);
}

/** Read the independent account lifecycle fields. */
async function readRetention(id: string) {
  const rows = await db
    .select({
      lifecycleState: organization.lifecycleState,
      exportReadyAt: organization.exportReadyAt,
      deleteAfterAt: organization.deleteAfterAt,
    })
    .from(organization)
    .where(eq(organization.id, id))
    .limit(1);
  return assertDefined(rows[0]);
}

/** Build an authoritative subscription event for the organization. */
function subscriptionEvent(
  referenceId: string,
  status: 'trialing' | 'active' | 'past_due' | 'canceled',
  createdAt = NOW,
): BillingEvent {
  return {
    id: `evt-${referenceId}-${status}-${createdAt}`,
    type: 'subscription.updated',
    referenceId,
    createdAt,
    subscription: {
      id: `sub-${referenceId}`,
      referenceId,
      status,
      currentPeriodEnd: '2026-02-01T00:00:00.000Z',
    },
  };
}

beforeAll(async () => {
  const fixture = await createBillingLifecycleDb();
  db = fixture.db;
  client = fixture.client;
});

afterAll(async () => {
  await client?.close();
});

describe('applyBillingEvent', () => {
  it('does not grant access from Checkout completion without an authoritative subscription', async () => {
    const id = await makeOrg();
    const event: BillingEvent = {
      id: 'evt-checkout-only',
      type: 'checkout.completed',
      referenceId: id,
      createdAt: NOW,
    };

    expect(await applyBillingEvent(db, event, NOW)).toBe('none');
    expect(
      await db
        .select()
        .from(organizationProductEntitlement)
        .where(eq(organizationProductEntitlement.organizationId, id)),
    ).toHaveLength(0);
  });

  it('starts one seven-day grace period on the first failed payment', async () => {
    const id = await makeOrg();
    expect(await applyBillingEvent(db, subscriptionEvent(id, 'past_due'), NOW)).toBe('past_due');

    const first = await readAccess(id);
    expect(first.graceEndsAt?.getTime()).toBe(
      new Date(NOW).getTime() + PAYMENT_GRACE_DAYS * 24 * 60 * 60 * 1000,
    );

    const later = '2026-01-03T00:00:00.000Z';
    await applyBillingEvent(db, subscriptionEvent(id, 'past_due', later), later);
    expect((await readAccess(id)).graceEndsAt?.getTime()).toBe(first.graceEndsAt?.getTime());
  });

  it.each([false, true])(
    'cancels Pro without scheduling deletion for personal=%s',
    async (isPersonal) => {
      const id = await makeOrg(isPersonal);
      expect(await applyBillingEvent(db, subscriptionEvent(id, 'canceled'), NOW)).toBe('canceled');

      expect(await readAccess(id)).toMatchObject({ status: 'canceled', source: 'stripe' });
      expect(await readRetention(id)).toEqual({
        lifecycleState: 'active',
        exportReadyAt: null,
        deleteAfterAt: null,
      });
    },
  );

  it('ignores a stale provider snapshot that would restore canceled access', async () => {
    const id = await makeOrg();
    await applyBillingEvent(
      db,
      subscriptionEvent(id, 'canceled', '2026-01-02T00:00:00.000Z'),
      '2026-01-02T00:00:00.000Z',
    );

    expect(await applyBillingEvent(db, subscriptionEvent(id, 'active'), NOW)).toBe('stale');
    expect((await readAccess(id)).status).toBe('canceled');
  });
});
