/** Durable Stripe identity and webhook idempotency behavior. */
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import { eq } from 'drizzle-orm';

import {
  acquireCheckoutAttempt,
  claimProviderEvent,
  completeCheckoutAttempt,
  completeProviderEvent,
  ensureBillingCustomer,
  failCheckoutAttempt,
  getBillingCustomer,
} from '../../src/application/provider-state';
import type { BillingGateway } from '../../src/contracts';
import { getMigratedDb } from '../support/db';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getMigratedDb();
  db = schema.db;
});

async function seedOrg(): Promise<string> {
  const slug = `provider-${Math.random().toString(36).slice(2, 10)}`;
  const rows = await db
    .insert(schema.organization)
    .values({ name: slug, slug, lifecycleState: 'active' })
    .returning({ id: schema.organization.id });
  const row = rows[0];
  if (!row) throw new Error('failed to seed organization');
  return row.id;
}

describe('ensureBillingCustomer', () => {
  it('creates the provider customer once and reuses its durable id', async () => {
    const orgId = await seedOrg();
    let creates = 0;
    let createdEmail: string | undefined;
    const gateway = {
      listSubscriptions: async () => [],
      createCustomer: async (referenceId: string, email?: string) => {
        creates += 1;
        createdEmail = email;
        return { id: `cus_${referenceId}`, referenceId };
      },
    } as unknown as BillingGateway;

    const first = await ensureBillingCustomer(db, gateway, orgId, 'owner@example.com');
    const second = await ensureBillingCustomer(db, gateway, orgId, 'owner@example.com');

    expect(first).toEqual(second);
    expect(first.stripeCustomerId).toBe(`cus_${orgId}`);
    expect(first.countryVerificationRequired).toBe(true);
    expect(createdEmail).toBe('owner@example.com');
    expect(creates).toBe(1);
  });

  it('backfills the customer from one existing subscription without creating another', async () => {
    const orgId = await seedOrg();
    let creates = 0;
    const gateway = {
      listSubscriptions: async () => [
        {
          id: 'sub_legacy',
          customerId: 'cus_legacy',
          referenceId: orgId,
          status: 'active',
          currentPeriodEnd: '2026-09-25T00:00:00.000Z',
        },
      ],
      createCustomer: async () => {
        creates += 1;
        return { id: 'cus_wrong', referenceId: orgId };
      },
    } as unknown as BillingGateway;

    const account = await ensureBillingCustomer(db, gateway, orgId);

    expect(account.stripeCustomerId).toBe('cus_legacy');
    expect(account.countryVerificationRequired).toBe(false);
    expect(creates).toBe(0);
  });

  it('refuses to create a customer when existing subscriptions do not resolve one owner', async () => {
    const orgId = await seedOrg();
    let creates = 0;
    const gateway = {
      listSubscriptions: async () => [
        {
          id: 'sub_legacy',
          referenceId: orgId,
          status: 'active',
          currentPeriodEnd: '2026-09-25T00:00:00.000Z',
        },
      ],
      createCustomer: async () => {
        creates += 1;
        return { id: 'cus_wrong', referenceId: orgId };
      },
    } as unknown as BillingGateway;

    await expect(ensureBillingCustomer(db, gateway, orgId)).rejects.toThrow(
      'do not resolve to one billing customer',
    );
    expect(creates).toBe(0);
  });

  it('refuses ambiguous subscriptions that resolve to more than one provider customer', async () => {
    const orgId = await seedOrg();
    let creates = 0;
    const gateway = {
      listSubscriptions: async () => [
        {
          id: 'sub_first',
          customerId: 'cus_first',
          referenceId: orgId,
          status: 'active',
          currentPeriodEnd: '2026-09-25T00:00:00.000Z',
        },
        {
          id: 'sub_second',
          customerId: 'cus_second',
          referenceId: orgId,
          status: 'past_due',
          currentPeriodEnd: '2026-09-26T00:00:00.000Z',
        },
      ],
      createCustomer: async () => {
        creates += 1;
        return { id: 'cus_wrong', referenceId: orgId };
      },
    } as unknown as BillingGateway;

    await expect(ensureBillingCustomer(db, gateway, orgId)).rejects.toThrow(
      'do not resolve to one billing customer',
    );
    expect(creates).toBe(0);
    await expect(getBillingCustomer(db, orgId)).resolves.toBeNull();
  });

  it('converges concurrent customer creation on the durable organization identity', async () => {
    const orgId = await seedOrg();
    let creates = 0;
    let releaseCustomerCreation: (() => void) | undefined;
    const bothCustomersStarted = new Promise<void>((resolve) => {
      releaseCustomerCreation = resolve;
    });
    const gateway = {
      listSubscriptions: async () => [],
      createCustomer: async (referenceId: string) => {
        creates += 1;
        if (creates === 2) releaseCustomerCreation?.();
        await bothCustomersStarted;
        return { id: `cus_${referenceId}`, referenceId };
      },
    } as unknown as BillingGateway;

    const [first, second] = await Promise.all([
      ensureBillingCustomer(db, gateway, orgId),
      ensureBillingCustomer(db, gateway, orgId),
    ]);

    expect(first).toEqual(second);
    expect(first.stripeCustomerId).toBe(`cus_${orgId}`);
    expect(creates).toBe(2);
    await expect(getBillingCustomer(db, orgId)).resolves.toEqual(first);
  });
});

describe('Checkout attempt leases', () => {
  it('returns pending while a session is creating and reuses its hosted URL after completion', async () => {
    const orgId = await seedOrg();
    const now = new Date('2026-08-25T12:00:00.000Z');
    const expiresAt = new Date('2026-08-25T13:00:00.000Z');

    const acquired = await acquireCheckoutAttempt(db, orgId, 'docket_pro', now, expiresAt);
    expect(acquired).toMatchObject({ kind: 'acquired', id: expect.any(String) });
    if (acquired.kind !== 'acquired') throw new Error('expected an acquired Checkout lease');

    await expect(acquireCheckoutAttempt(db, orgId, 'docket_pro', now, expiresAt)).resolves.toEqual({
      kind: 'pending',
    });

    await completeCheckoutAttempt(
      db,
      acquired.id,
      'cs_checkout_attempt',
      'https://checkout.stripe.test/session',
      now,
    );
    await expect(acquireCheckoutAttempt(db, orgId, 'docket_pro', now, expiresAt)).resolves.toEqual({
      kind: 'reusable',
      url: 'https://checkout.stripe.test/session',
    });
  });

  it('expires stale sessions and releases failed creation attempts for a clean retry', async () => {
    const expiredOrgId = await seedOrg();
    const initialNow = new Date('2026-08-25T12:00:00.000Z');
    const expiredAt = new Date('2026-08-25T12:30:00.000Z');
    const retryNow = new Date('2026-08-25T13:00:00.000Z');
    const retryExpiresAt = new Date('2026-08-25T14:00:00.000Z');
    await acquireCheckoutAttempt(db, expiredOrgId, 'docket_pro', initialNow, expiredAt);

    await expect(
      acquireCheckoutAttempt(db, expiredOrgId, 'docket_pro', retryNow, retryExpiresAt),
    ).resolves.toMatchObject({ kind: 'acquired', id: expect.any(String) });

    const failedOrgId = await seedOrg();
    const failed = await acquireCheckoutAttempt(
      db,
      failedOrgId,
      'docket_pro',
      retryNow,
      retryExpiresAt,
    );
    if (failed.kind !== 'acquired') throw new Error('expected an acquired Checkout lease');
    await failCheckoutAttempt(db, failed.id, retryNow);
    await expect(
      acquireCheckoutAttempt(db, failedOrgId, 'docket_pro', retryNow, retryExpiresAt),
    ).resolves.toMatchObject({ kind: 'acquired', id: expect.any(String) });
  });
});

describe('claimProviderEvent', () => {
  it('claims a Stripe event once and rejects a duplicate delivery', async () => {
    const orgId = await seedOrg();
    const event = {
      id: `evt_${orgId}`,
      type: 'subscription.updated' as const,
      referenceId: orgId,
      createdAt: '2026-08-25T00:00:00.000Z',
    };

    await expect(claimProviderEvent(db, event)).resolves.toBe(true);
    await expect(claimProviderEvent(db, event)).resolves.toBe(false);
  });

  it('records successful processing on the claimed provider event', async () => {
    const orgId = await seedOrg();
    const event = {
      id: `evt_complete_${orgId}`,
      type: 'subscription.paid' as const,
      referenceId: orgId,
      createdAt: '2026-08-25T00:00:00.000Z',
    };
    const processedAt = new Date('2026-08-25T00:00:05.000Z');

    await expect(claimProviderEvent(db, event)).resolves.toBe(true);
    await completeProviderEvent(db, event.id, processedAt);
    await completeProviderEvent(db, event.id, processedAt);

    const rows = await db
      .select({
        processedAt: schema.billingProviderEvent.processedAt,
        processingError: schema.billingProviderEvent.processingError,
      })
      .from(schema.billingProviderEvent)
      .where(eq(schema.billingProviderEvent.providerEventId, event.id));
    expect(rows).toEqual([{ processedAt, processingError: null }]);
  });
});
