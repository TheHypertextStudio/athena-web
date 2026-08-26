/** Billing events update product access without scheduling customer-data deletion. */
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { applyBillingEvent, PAYMENT_GRACE_DAYS } from '../../src/application/lifecycle';
import type { BillingEvent, SubscriptionStatus } from '../../src/contracts';
import { getMigratedDb } from '../support/db';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getMigratedDb();
  db = schema.db;
});

const NOW = '2026-08-25T00:00:00.000Z';
const DAY_MS = 24 * 60 * 60 * 1000;

async function seedOrg(): Promise<string> {
  const slug = `billing-${Math.random().toString(36).slice(2, 10)}`;
  const rows = await db
    .insert(schema.organization)
    .values({ name: slug, slug, lifecycleState: 'active' })
    .returning({ id: schema.organization.id });
  const row = rows[0];
  if (!row) throw new Error('failed to seed organization');
  return row.id;
}

function event(organizationId: string, status: SubscriptionStatus, createdAt = NOW): BillingEvent {
  return {
    id: `evt_${organizationId}_${status}_${createdAt}`,
    type:
      status === 'past_due'
        ? 'subscription.past_due'
        : status === 'canceled'
          ? 'subscription.canceled'
          : 'subscription.updated',
    referenceId: organizationId,
    subscription: {
      id: `sub_${organizationId}`,
      referenceId: organizationId,
      status,
      currentPeriodEnd: '2026-09-25T00:00:00.000Z',
      ...(status === 'trialing' ? { trialEnd: '2026-09-08T00:00:00.000Z' } : {}),
    },
    createdAt,
  };
}

async function readState(organizationId: string) {
  const orgRows = await db
    .select({
      lifecycleState: schema.organization.lifecycleState,
      exportReadyAt: schema.organization.exportReadyAt,
      deleteAfterAt: schema.organization.deleteAfterAt,
    })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId));
  const productRows = await db
    .select()
    .from(schema.organizationProductEntitlement)
    .where(eq(schema.organizationProductEntitlement.organizationId, organizationId));
  return { org: orgRows[0], product: productRows[0] };
}

describe('billing access lifecycle', () => {
  it.each(['trialing', 'active'] as const)(
    'records a healthy %s subscription without changing data retention',
    async (status) => {
      const organizationId = await seedOrg();
      await expect(applyBillingEvent(db, event(organizationId, status), NOW)).resolves.toBe(status);

      const state = await readState(organizationId);
      expect(state.org).toMatchObject({
        lifecycleState: 'active',
        exportReadyAt: null,
        deleteAfterAt: null,
      });
      expect(state.product).toMatchObject({ status, graceEndsAt: null });
    },
  );

  it('starts one seven-day grace period on the first failed payment', async () => {
    const organizationId = await seedOrg();
    await applyBillingEvent(db, event(organizationId, 'active'), NOW);
    await expect(applyBillingEvent(db, event(organizationId, 'past_due'), NOW)).resolves.toBe(
      'past_due',
    );

    const first = await readState(organizationId);
    expect(first.product?.graceEndsAt?.getTime()).toBe(
      new Date(NOW).getTime() + PAYMENT_GRACE_DAYS * DAY_MS,
    );

    await applyBillingEvent(
      db,
      event(organizationId, 'past_due', '2026-08-27T00:00:00.000Z'),
      '2026-08-27T00:00:00.000Z',
    );
    const replay = await readState(organizationId);
    expect(replay.product?.graceEndsAt?.getTime()).toBe(first.product?.graceEndsAt?.getTime());
  });

  it('anchors grace to the Stripe failure time when webhook delivery is delayed', async () => {
    const organizationId = await seedOrg();
    const failureAt = '2026-08-25T00:00:00.000Z';

    await applyBillingEvent(
      db,
      event(organizationId, 'past_due', failureAt),
      '2026-08-27T00:00:00.000Z',
    );

    expect((await readState(organizationId)).product?.graceEndsAt?.getTime()).toBe(
      new Date(failureAt).getTime() + PAYMENT_GRACE_DAYS * DAY_MS,
    );
  });

  it('clears payment grace after a successful payment', async () => {
    const organizationId = await seedOrg();
    await applyBillingEvent(db, event(organizationId, 'past_due'), NOW);
    await applyBillingEvent(
      db,
      event(organizationId, 'active', '2026-08-26T00:00:00.000Z'),
      '2026-08-26T00:00:00.000Z',
    );
    expect((await readState(organizationId)).product).toMatchObject({
      status: 'active',
      graceEndsAt: null,
    });
  });

  it('cancels product access without scheduling workspace deletion', async () => {
    const organizationId = await seedOrg();
    await expect(applyBillingEvent(db, event(organizationId, 'canceled'), NOW)).resolves.toBe(
      'canceled',
    );

    const state = await readState(organizationId);
    expect(state.org).toMatchObject({
      lifecycleState: 'active',
      exportReadyAt: null,
      deleteAfterAt: null,
    });
    expect(state.product).toMatchObject({ status: 'canceled', graceEndsAt: null });
  });

  it('ignores a stale active event after a newer cancellation', async () => {
    const organizationId = await seedOrg();
    await applyBillingEvent(
      db,
      event(organizationId, 'canceled', '2026-08-27T00:00:00.000Z'),
      '2026-08-27T00:00:00.000Z',
    );
    await expect(applyBillingEvent(db, event(organizationId, 'active'), NOW)).resolves.toBe(
      'stale',
    );
    expect((await readState(organizationId)).product?.status).toBe('canceled');
  });

  it('applies a newly observed current snapshot when the triggering event is older', async () => {
    const organizationId = await seedOrg();
    await applyBillingEvent(
      db,
      event(organizationId, 'active', '2026-08-27T00:00:00.000Z'),
      '2026-08-27T00:00:00.000Z',
    );

    await expect(
      applyBillingEvent(
        db,
        event(organizationId, 'past_due', '2026-08-26T00:00:00.000Z'),
        '2026-08-28T00:00:00.000Z',
      ),
    ).resolves.toBe('past_due');
    expect((await readState(organizationId)).product?.status).toBe('past_due');
  });

  it('does not let a Stripe snapshot replace active complimentary access', async () => {
    const organizationId = await seedOrg();
    await db
      .insert(schema.billingExemption)
      .values({ organizationId, reason: 'Founder production access' });
    await db.insert(schema.organizationProductEntitlement).values({
      organizationId,
      productKey: 'docket_pro',
      status: 'active',
      source: 'complimentary',
    });

    await expect(applyBillingEvent(db, event(organizationId, 'canceled'), NOW)).resolves.toBe(
      'none',
    );
    expect((await readState(organizationId)).product).toMatchObject({
      status: 'active',
      source: 'complimentary',
    });
  });

  it('preserves a legacy active complimentary entitlement without an exemption row', async () => {
    const organizationId = await seedOrg();
    await db.insert(schema.organizationProductEntitlement).values({
      organizationId,
      productKey: 'docket_pro',
      status: 'active',
      source: 'complimentary',
    });

    await expect(applyBillingEvent(db, event(organizationId, 'canceled'), NOW)).resolves.toBe(
      'none',
    );
    expect((await readState(organizationId)).product).toMatchObject({
      status: 'active',
      source: 'complimentary',
    });
  });

  it('does not grant access from Checkout completion without a subscription snapshot', async () => {
    const organizationId = await seedOrg();
    const checkout: BillingEvent = {
      id: `evt_checkout_${organizationId}`,
      type: 'checkout.completed',
      referenceId: organizationId,
      createdAt: NOW,
    };
    await expect(applyBillingEvent(db, checkout, NOW)).resolves.toBe('none');
    expect((await readState(organizationId)).product).toBeUndefined();
  });

  it('does not treat a Checkout payload as an authoritative subscription snapshot', async () => {
    const organizationId = await seedOrg();
    const checkout: BillingEvent = {
      ...event(organizationId, 'trialing'),
      type: 'checkout.completed',
    };
    await expect(applyBillingEvent(db, checkout, NOW)).resolves.toBe('none');
    expect((await readState(organizationId)).product).toBeUndefined();
  });
});
