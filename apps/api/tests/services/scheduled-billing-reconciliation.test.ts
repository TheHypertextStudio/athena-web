import { InMemoryBillingGateway } from '@docket/billing/adapters/in-memory';
import type { BlobStore } from '@docket/blob-store';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as DbModule from '@docket/db';

import { runScheduledBillingReconciliation } from '../../src/services/scheduled-billing-reconciliation';
import { getDb, seedBaseOrg } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
});

beforeEach(async () => {
  await db.delete(schema.organization);
});

function blobDouble(): BlobStore {
  return {
    put: vi.fn(),
    get: vi.fn(),
    url: vi.fn(),
    delete: vi.fn(),
  };
}

async function billingFixture(): Promise<{
  gateway: InMemoryBillingGateway;
  organizationId: string;
}> {
  const { orgId } = await seedBaseOrg(db, schema, false);
  await db.insert(schema.organizationBillingAccount).values({
    organizationId: orgId,
    stripeCustomerId: `cus_${orgId}`,
    countryVerificationRequired: false,
  });
  const gateway = new InMemoryBillingGateway({ now: '2026-08-25T00:00:00.000Z' });
  await gateway.createCustomer(orgId);
  await gateway.createCheckoutSession({
    referenceId: orgId,
    customerId: `cus_${orgId}`,
    priceKey: 'docket_pro_monthly',
    successUrl: 'https://app.test/success',
    cancelUrl: 'https://app.test/cancel',
  });
  return { gateway, organizationId: orgId };
}

describe('runScheduledBillingReconciliation', () => {
  it('makes no provider call while reconciliation is off', async () => {
    const gateway = new InMemoryBillingGateway();
    const listCustomers = vi.spyOn(gateway, 'listCustomers');
    const listSubscriptions = vi.spyOn(gateway, 'listSubscriptions');

    const result = await runScheduledBillingReconciliation(
      db,
      gateway,
      blobDouble(),
      new Date('2026-08-25T01:00:00.000Z'),
      { mode: 'off' },
    );

    expect(result).toEqual({ mode: 'off', swept: false });
    expect(listCustomers).not.toHaveBeenCalled();
    expect(listSubscriptions).not.toHaveBeenCalled();
  });

  it('reports drift without repairing it during shadow reconciliation', async () => {
    const { gateway, organizationId } = await billingFixture();

    const result = await runScheduledBillingReconciliation(
      db,
      gateway,
      blobDouble(),
      new Date('2026-08-25T01:00:00.000Z'),
      {
        mode: 'shadow',
        singleSubscriptionRedirectVerifiedAt: '2026-08-25T00:30:00.000Z',
      },
    );

    expect(result.mode).toBe('shadow');
    if (result.mode !== 'shadow') throw new Error('shadow result expected');
    expect(result.swept).toBe(false);
    expect(result.audit.organizations).toEqual([
      expect.objectContaining({
        organizationId,
        problems: expect.arrayContaining([
          expect.objectContaining({ code: 'entitlement_missing' }),
        ]),
      }),
    ]);
    expect(await db.select().from(schema.organizationProductEntitlement)).toHaveLength(0);
  });

  it('repairs safe mirror drift only in active mode', async () => {
    const { gateway, organizationId } = await billingFixture();

    const result = await runScheduledBillingReconciliation(
      db,
      gateway,
      blobDouble(),
      new Date('2026-08-25T01:00:00.000Z'),
      { mode: 'active' },
    );

    expect(result).toMatchObject({ mode: 'active', swept: true, repaired: 1, alerts: 0 });
    expect(await db.select().from(schema.organizationProductEntitlement)).toEqual([
      expect.objectContaining({ organizationId }),
    ]);
  });
});
