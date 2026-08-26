import { InMemoryBillingGateway } from '@docket/billing/adapters/in-memory';
import type { Subscription } from '@docket/billing/contracts';
import type { BlobStore } from '@docket/blob-store';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type * as DbModule from '@docket/db';

import { reconcileBilling } from '../../src/services/billing-reconciliation';
import { getDb, seedBaseOrg } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
});

/** Build an inert blob port while exposing its delete spy. */
function blobDouble(): { blob: BlobStore; deleteBlob: ReturnType<typeof vi.fn> } {
  const deleteBlob = vi.fn().mockResolvedValue(undefined);
  return {
    deleteBlob,
    blob: {
      put: vi.fn(),
      get: vi.fn(),
      url: vi.fn(),
      delete: deleteBlob,
    },
  };
}

describe('reconcileBilling', () => {
  it('repairs the entitlement mirror from one current provider subscription', async () => {
    const { orgId } = await seedBaseOrg(db, schema, false);
    await db.insert(schema.organizationBillingAccount).values({
      organizationId: orgId,
      stripeCustomerId: `cus_${orgId}`,
      countryVerificationRequired: false,
    });
    const gateway = new InMemoryBillingGateway({ now: '2026-08-25T00:00:00.000Z' });
    await gateway.createCheckoutSession({
      referenceId: orgId,
      priceKey: 'docket_pro_monthly',
      successUrl: 'https://app.test/success',
      cancelUrl: 'https://app.test/cancel',
    });
    const { blob } = blobDouble();

    const result = await reconcileBilling(db, gateway, blob, new Date('2026-08-25T01:00:00.000Z'));

    expect(result).toMatchObject({ repaired: 1, alerts: 0 });
    const [entitlement] = await db
      .select()
      .from(schema.organizationProductEntitlement)
      .where(
        and(
          eq(schema.organizationProductEntitlement.organizationId, orgId),
          eq(schema.organizationProductEntitlement.productKey, 'docket_pro'),
        ),
      );
    expect(entitlement).toMatchObject({ source: 'stripe', status: 'trialing' });
  });

  it('cancels access when a previously verified customer changes to a non-US address', async () => {
    const { orgId } = await seedBaseOrg(db, schema, false);
    await db.insert(schema.organizationBillingAccount).values({
      organizationId: orgId,
      stripeCustomerId: `cus_${orgId}`,
      billingCountry: 'US',
      countryVerifiedAt: new Date('2026-08-24T00:00:00.000Z'),
      countryVerificationRequired: true,
    });
    const subscription: Subscription = {
      id: 'sub_country_changed',
      customerId: `cus_${orgId}`,
      referenceId: orgId,
      status: 'active',
      currentPeriodEnd: '2026-09-08T00:00:00.000Z',
    };
    class ChangedCountryGateway extends InMemoryBillingGateway {
      override async listSubscriptions(referenceId: string): Promise<readonly Subscription[]> {
        return referenceId === orgId ? [subscription] : [];
      }

      override async getCustomerBillingCountry(customerId: string): Promise<string | null> {
        return customerId === `cus_${orgId}` ? 'CA' : null;
      }
    }
    const gateway = new ChangedCountryGateway();
    const cancelSubscriptionById = vi.spyOn(gateway, 'cancelSubscriptionById');
    const { blob } = blobDouble();

    const result = await reconcileBilling(db, gateway, blob, new Date('2026-08-25T01:00:00.000Z'));

    expect(result.alerts).toBeGreaterThanOrEqual(1);
    expect(cancelSubscriptionById).toHaveBeenCalledWith(
      'sub_country_changed',
      `billing-country:reconcile:${orgId}:sub_country_changed:cancel`,
      true,
    );
  });

  it('activates a scheduled award when the observed Stripe coupon matches', async () => {
    const { orgId } = await seedBaseOrg(db, schema, false);
    await db.insert(schema.organizationBillingAccount).values({
      organizationId: orgId,
      stripeCustomerId: `cus_${orgId}`,
      countryVerificationRequired: false,
    });
    const [award] = await db
      .insert(schema.billingDiscountAward)
      .values({
        organizationId: orgId,
        percentOff: 50,
        status: 'scheduled',
        startsAt: new Date('2026-08-25T00:00:00.000Z'),
        endsAt: new Date('2027-08-25T00:00:00.000Z'),
        reviewAt: new Date('2027-08-25T00:00:00.000Z'),
        reason: 'Verified student',
        providerCouponId: 'coupon_student',
      })
      .returning();
    if (!award) throw new Error('award seed failed');
    const subscription: Subscription = {
      id: 'sub_student',
      customerId: `cus_${orgId}`,
      referenceId: orgId,
      status: 'active',
      currentPeriodEnd: '2026-09-25T00:00:00.000Z',
      discountIds: ['di_student'],
      couponIds: ['coupon_student'],
    };
    class DiscountGateway extends InMemoryBillingGateway {
      override async listSubscriptions(referenceId: string): Promise<readonly Subscription[]> {
        return referenceId === orgId ? [subscription] : [];
      }
    }
    const { blob } = blobDouble();

    const result = await reconcileBilling(
      db,
      new DiscountGateway(),
      blob,
      new Date('2026-08-25T01:00:00.000Z'),
    );

    expect(result.alerts).toBe(0);
    const [updated] = await db
      .select()
      .from(schema.billingDiscountAward)
      .where(eq(schema.billingDiscountAward.id, award.id));
    expect(updated).toMatchObject({ status: 'active', providerDiscountId: 'di_student' });
  });

  it.each(['scheduled', 'active'] as const)(
    'keeps or repairs a %s public award until its discounted trial produces a paid period',
    async (initialStatus) => {
      const { orgId } = await seedBaseOrg(db, schema, false);
      await db.insert(schema.organizationBillingAccount).values({
        organizationId: orgId,
        stripeCustomerId: `cus_${orgId}`,
        countryVerificationRequired: false,
      });
      const [award] = await db
        .insert(schema.billingDiscountAward)
        .values({
          organizationId: orgId,
          programKey: 'student',
          percentOff: 50,
          status: initialStatus,
          startsAt: new Date('2026-08-25T00:00:00.000Z'),
          endsAt: new Date('2027-08-25T00:00:00.000Z'),
          reviewAt: new Date('2027-08-25T00:00:00.000Z'),
          reason: 'Verified student',
          providerCouponId: 'coupon_trial_student',
          providerDiscountId: initialStatus === 'active' ? 'di_trial_student' : null,
        })
        .returning();
      if (!award) throw new Error('award seed failed');
      const subscription: Subscription = {
        id: 'sub_trial_student',
        customerId: `cus_${orgId}`,
        referenceId: orgId,
        status: 'trialing',
        currentPeriodEnd: '2026-09-08T00:00:00.000Z',
        trialEnd: '2026-09-08T00:00:00.000Z',
        discountIds: ['di_trial_student'],
        couponIds: ['coupon_trial_student'],
      };
      class TrialDiscountGateway extends InMemoryBillingGateway {
        override async listSubscriptions(referenceId: string): Promise<readonly Subscription[]> {
          return referenceId === orgId ? [subscription] : [];
        }
      }
      const { blob } = blobDouble();

      const result = await reconcileBilling(
        db,
        new TrialDiscountGateway(),
        blob,
        new Date('2026-08-25T01:00:00.000Z'),
      );

      expect(result.alerts).toBe(0);
      const [updated] = await db
        .select()
        .from(schema.billingDiscountAward)
        .where(eq(schema.billingDiscountAward.id, award.id));
      expect(updated).toMatchObject({
        status: 'scheduled',
        providerDiscountId: 'di_trial_student',
      });
    },
  );

  it('alerts when Stripe stacks a second discount onto the current Docket award', async () => {
    const { orgId } = await seedBaseOrg(db, schema, false);
    await db.insert(schema.organizationBillingAccount).values({
      organizationId: orgId,
      stripeCustomerId: `cus_${orgId}`,
      countryVerificationRequired: false,
    });
    await db.insert(schema.billingDiscountAward).values({
      organizationId: orgId,
      percentOff: 50,
      status: 'active',
      startsAt: new Date('2026-08-25T00:00:00.000Z'),
      endsAt: new Date('2027-08-25T00:00:00.000Z'),
      reviewAt: new Date('2027-08-25T00:00:00.000Z'),
      reason: 'Verified student',
      providerCouponId: 'coupon_expected',
      providerDiscountId: 'di_expected',
    });
    const subscription: Subscription = {
      id: 'sub_unknown_discount',
      customerId: `cus_${orgId}`,
      referenceId: orgId,
      status: 'active',
      currentPeriodEnd: '2026-09-25T00:00:00.000Z',
      discountIds: ['di_expected', 'di_extra'],
      couponIds: ['coupon_expected', 'coupon_extra'],
    };
    class DiscountGateway extends InMemoryBillingGateway {
      override async listSubscriptions(referenceId: string): Promise<readonly Subscription[]> {
        return referenceId === orgId ? [subscription] : [];
      }
    }
    const { blob } = blobDouble();

    const result = await reconcileBilling(
      db,
      new DiscountGateway(),
      blob,
      new Date('2026-08-25T01:00:00.000Z'),
    );

    expect(result.alerts).toBe(1);
    const [sync] = await db
      .select()
      .from(schema.billingProviderSync)
      .where(eq(schema.billingProviderSync.organizationId, orgId));
    expect(sync).toMatchObject({
      status: 'failed',
      lastError: 'Stripe subscription discounts do not exactly match the current Docket award.',
    });
  });

  it('alerts without canceling when Stripe has duplicate current subscriptions', async () => {
    const { orgId } = await seedBaseOrg(db, schema, false);
    await db.insert(schema.organizationBillingAccount).values({
      organizationId: orgId,
      stripeCustomerId: `cus_${orgId}`,
      countryVerificationRequired: false,
    });
    const subscriptions: readonly Subscription[] = [
      {
        id: 'sub_one',
        referenceId: orgId,
        status: 'active',
        currentPeriodEnd: '2026-09-25T00:00:00.000Z',
      },
      {
        id: 'sub_two',
        referenceId: orgId,
        status: 'trialing',
        currentPeriodEnd: '2026-09-08T00:00:00.000Z',
      },
    ];
    class DuplicateGateway extends InMemoryBillingGateway {
      override async listSubscriptions(referenceId: string): Promise<readonly Subscription[]> {
        return referenceId === orgId ? subscriptions : [];
      }
    }
    const gateway = new DuplicateGateway();
    const cancelSubscription = vi.spyOn(gateway, 'cancelSubscription');
    const { blob } = blobDouble();

    const result = await reconcileBilling(db, gateway, blob, new Date('2026-08-25T01:00:00.000Z'));

    expect(result.alerts).toBe(1);
    expect(cancelSubscription).not.toHaveBeenCalled();
    const [sync] = await db
      .select()
      .from(schema.billingProviderSync)
      .where(eq(schema.billingProviderSync.organizationId, orgId));
    expect(sync).toMatchObject({ status: 'failed', operation: 'reconcile_billing' });
  });

  it('removes due evidence and advances an unrenewed award without issuing money', async () => {
    const { orgId } = await seedBaseOrg(db, schema, false);
    const userId = `user_${orgId}`;
    await db.insert(schema.user).values({
      id: userId,
      name: 'Student',
      email: `${orgId}@unlv.edu`,
      emailVerified: true,
    });
    const [application] = await db
      .insert(schema.billingDiscountApplication)
      .values({
        organizationId: orgId,
        applicantUserId: userId,
        programKey: 'student',
        status: 'approved',
        evidenceType: 'enrollment_document',
      })
      .returning();
    if (!application) throw new Error('application seed failed');
    await db.insert(schema.billingDiscountEvidence).values({
      applicationId: application.id,
      evidenceType: 'enrollment_document',
      blobKey: `evidence/${application.id}`,
      mimeType: 'application/pdf',
      byteSize: 10,
      deleteAfter: new Date('2026-08-24T00:00:00.000Z'),
    });
    const [award] = await db
      .insert(schema.billingDiscountAward)
      .values({
        organizationId: orgId,
        applicationId: application.id,
        programKey: 'student',
        percentOff: 50,
        status: 'active',
        startsAt: new Date('2025-09-01T00:00:00.000Z'),
        endsAt: new Date('2026-09-01T00:00:00.000Z'),
        reviewAt: new Date('2026-09-01T00:00:00.000Z'),
        reason: 'Verified student',
      })
      .returning();
    if (!award) throw new Error('award seed failed');
    const gateway = new InMemoryBillingGateway();
    const removeDiscount = vi.spyOn(gateway, 'removeSubscriptionDiscount');
    const { blob, deleteBlob } = blobDouble();

    const result = await reconcileBilling(db, gateway, blob, new Date('2026-08-25T00:00:00.000Z'));

    expect(result).toMatchObject({ awardsAdvanced: 1, evidenceDeleted: 1 });
    expect(removeDiscount).not.toHaveBeenCalled();
    expect(deleteBlob).toHaveBeenCalledWith(`evidence/${application.id}`);
    const [updatedAward] = await db
      .select()
      .from(schema.billingDiscountAward)
      .where(eq(schema.billingDiscountAward.id, award.id));
    expect(updatedAward?.status).toBe('ending');

    await reconcileBilling(db, gateway, blob, new Date('2026-09-01T00:00:00.000Z'));
    expect(removeDiscount).toHaveBeenCalledWith(orgId, `discount-award:${award.id}:end`);
    const [expiredAward] = await db
      .select()
      .from(schema.billingDiscountAward)
      .where(eq(schema.billingDiscountAward.id, award.id));
    expect(expiredAward?.status).toBe('expired');
  });
});
