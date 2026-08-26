import { InMemoryBillingGateway } from '@docket/billing/adapters/in-memory';
import type { BillingCustomer, Subscription } from '@docket/billing/contracts';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { auditBillingLaunch } from '../../src/services/billing-launch-audit';
import { getDb, seedBaseOrg } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
});

class AuditGateway extends InMemoryBillingGateway {
  readonly auditCustomers = new Map<string, readonly BillingCustomer[]>();
  readonly auditSubscriptions = new Map<string, readonly Subscription[]>();

  override async listCustomers(referenceId: string): Promise<readonly BillingCustomer[]> {
    return this.auditCustomers.get(referenceId) ?? [];
  }

  override async listSubscriptions(referenceId: string): Promise<readonly Subscription[]> {
    return this.auditSubscriptions.get(referenceId) ?? [];
  }
}

describe('auditBillingLaunch', () => {
  it('passes a coherent mirror and blocks duplicate provider ownership', async () => {
    const gateway = new AuditGateway();
    const { orgId: healthyOrg } = await seedBaseOrg(db, schema, false);
    const healthyCustomer = `cus_${healthyOrg}`;
    const healthySubscription: Subscription = {
      id: `sub_${healthyOrg}`,
      customerId: healthyCustomer,
      referenceId: healthyOrg,
      status: 'active',
      currentPeriodEnd: '2026-09-25T00:00:00.000Z',
      cancelAtPeriodEnd: false,
    };
    await db.insert(schema.organizationBillingAccount).values({
      organizationId: healthyOrg,
      stripeCustomerId: healthyCustomer,
      countryVerificationRequired: false,
    });
    await db.insert(schema.organizationProductEntitlement).values({
      organizationId: healthyOrg,
      productKey: 'docket_pro',
      source: 'stripe',
      status: 'active',
      stripeSubscriptionId: healthySubscription.id,
      currentPeriodEnd: new Date(healthySubscription.currentPeriodEnd),
      cancelAtPeriodEnd: false,
    });
    gateway.auditCustomers.set(healthyOrg, [{ id: healthyCustomer, referenceId: healthyOrg }]);
    gateway.auditSubscriptions.set(healthyOrg, [healthySubscription]);
    await db.insert(schema.billingProviderSync).values({
      organizationId: healthyOrg,
      operation: 'preview_discount_approval',
      status: 'pending',
      idempotencyKey: `discount-preview:${healthyOrg}`,
      attempts: 0,
      payload: {},
    });

    const missingProviderControl = await auditBillingLaunch(
      db,
      gateway,
      new Date('2026-08-25T00:00:00.000Z'),
    );
    expect(missingProviderControl).toMatchObject({
      passed: false,
      providerControls: {
        singleSubscriptionRedirect: { verified: false, verifiedAt: null },
      },
    });

    const passing = await auditBillingLaunch(db, gateway, new Date('2026-08-25T00:00:00.000Z'), {
      singleSubscriptionRedirectVerifiedAt: '2026-08-24T23:00:00.000Z',
    });
    expect(passing).toMatchObject({ passed: true, organizationCount: 1, unresolvedCount: 0 });

    const { orgId: duplicateOrg } = await seedBaseOrg(db, schema, false);
    await db.insert(schema.organizationBillingAccount).values({
      organizationId: duplicateOrg,
      stripeCustomerId: `cus_${duplicateOrg}_one`,
      countryVerificationRequired: false,
    });
    gateway.auditCustomers.set(duplicateOrg, [
      { id: `cus_${duplicateOrg}_one`, referenceId: duplicateOrg },
      { id: `cus_${duplicateOrg}_two`, referenceId: duplicateOrg },
    ]);
    gateway.auditSubscriptions.set(duplicateOrg, [
      {
        id: `sub_${duplicateOrg}_one`,
        customerId: `cus_${duplicateOrg}_one`,
        referenceId: duplicateOrg,
        status: 'active',
        currentPeriodEnd: '2026-09-25T00:00:00.000Z',
      },
      {
        id: `sub_${duplicateOrg}_two`,
        customerId: `cus_${duplicateOrg}_two`,
        referenceId: duplicateOrg,
        status: 'trialing',
        currentPeriodEnd: '2026-09-08T00:00:00.000Z',
      },
    ]);
    await db.insert(schema.billingProviderSync).values({
      organizationId: duplicateOrg,
      operation: 'reconcile_billing',
      status: 'failed',
      idempotencyKey: `billing-reconcile:${duplicateOrg}`,
      attempts: 1,
      payload: {},
      lastError: 'Multiple current Stripe subscriptions require finance review.',
    });

    const blocked = await auditBillingLaunch(db, gateway, new Date('2026-08-25T00:05:00.000Z'), {
      singleSubscriptionRedirectVerifiedAt: '2026-08-24T23:00:00.000Z',
    });
    expect(blocked.passed).toBe(false);
    expect(blocked.unresolvedCount).toBeGreaterThanOrEqual(3);
    const duplicate = blocked.organizations.find((row) => row.organizationId === duplicateOrg);
    expect(duplicate?.problems.map((problem) => problem.code)).toEqual(
      expect.arrayContaining([
        'provider_customer_count',
        'current_subscription_count',
        'provider_sync_unresolved',
      ]),
    );

    await db
      .delete(schema.billingProviderSync)
      .where(eq(schema.billingProviderSync.organizationId, duplicateOrg));
  });
});
