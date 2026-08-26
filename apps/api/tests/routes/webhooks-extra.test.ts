import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { BillingEvent, BillingGateway } from '@docket/billing/contracts';

import { getDb, seedBaseOrg } from '../support/routes-harness';
import * as container from '../../src/container';
import type webhooksRouter from '../../src/routes/webhooks';

import type * as DbModule from '@docket/db';

let webhooks!: typeof webhooksRouter;
let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  webhooks = (await import('../../src/routes/webhooks')).default;
});

afterEach(() => {
  vi.restoreAllMocks();
});

const J = { 'content-type': 'application/json' };

describe('webhooks asBillingEvent defensive parse (mock gateway / local-test path)', () => {
  it('400s a non-object body (null / array / primitive)', async () => {
    const nullBody = await webhooks.request('/webhook', {
      method: 'POST',
      headers: J,
      body: JSON.stringify(null),
    });
    expect(nullBody.status).toBe(400);
    const arr = await webhooks.request('/webhook', {
      method: 'POST',
      headers: J,
      body: JSON.stringify([1, 2]),
    });
    expect(arr.status).toBe(400);
  });

  it('400s an object missing referenceId/createdAt even with id+type', async () => {
    const res = await webhooks.request('/webhook', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ id: 'e1', type: 'subscription.updated' }),
    });
    expect(res.status).toBe(400);
  });

  it('400s a body that is not valid JSON (parse catch → null)', async () => {
    const res = await webhooks.request('/webhook', {
      method: 'POST',
      headers: J,
      body: 'not json{',
    });
    expect(res.status).toBe(400);
  });
});

/**
 * A fake real-gateway whose `verifyWebhook` checks the raw body against a fixed secret —
 * standing in for `RealStripeGateway` so the route's verification branch is exercised
 * without a live Stripe signature/Web-Crypto.
 */
function fakeVerifyingGateway(
  verify: (rawBody: string, signature: string) => BillingEvent | null,
): BillingGateway & {
  verifyWebhook(rawBody: string | Buffer, signature: string): Promise<BillingEvent | null>;
} {
  return {
    createCustomer: vi.fn(),
    listCustomers: vi.fn(),
    getCustomerBillingCountry: vi.fn(),
    createCheckoutSession: vi.fn(),
    getSubscription: vi.fn(),
    getSubscriptionById: vi.fn(),
    listSubscriptions: vi.fn(),
    cancelSubscription: vi.fn(),
    cancelSubscriptionById: vi.fn(),
    extendTrial: vi.fn(),
    createBillingPortalSession: vi.fn(),
    createDiscountCoupon: vi.fn(),
    applySubscriptionDiscount: vi.fn(),
    removeSubscriptionDiscount: vi.fn(),
    getLatestRecurringInvoice: vi.fn(),
    previewCreditNote: vi.fn(),
    issueCreditNote: vi.fn(),
    verifyWebhook: (rawBody: string | Buffer, signature: string) =>
      Promise.resolve(
        verify(typeof rawBody === 'string' ? rawBody : rawBody.toString(), signature),
      ),
  };
}

/** Spy `getContainer` so `.billing` is the supplied verifying gateway. */
function useGateway(gateway: BillingGateway): void {
  const original = container.getContainer();
  vi.spyOn(container, 'getContainer').mockReturnValue({ ...original, billing: gateway });
}

describe('webhooks signature verification (real Stripe gateway path)', () => {
  it('rejects a forged/tampered body whose signature does not verify (400)', async () => {
    // The real adapter throws on a bad signature; the route must convert that to a 400
    // and NEVER fold the forged event into the lifecycle.
    useGateway(
      fakeVerifyingGateway(() => {
        throw new Error('RealStripeGateway: webhook signature verification failed.');
      }),
    );
    const res = await webhooks.request('/webhook', {
      method: 'POST',
      headers: { ...J, 'stripe-signature': 't=1,v1=forged' },
      body: JSON.stringify({
        id: 'evt_forged',
        type: 'subscription.canceled',
        referenceId: 'org_victim',
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: 'webhook signature verification failed',
    });
  });

  it('rejects a request with no stripe-signature header (400)', async () => {
    const verify = vi.fn(() => null);
    useGateway(fakeVerifyingGateway(verify));
    const res = await webhooks.request('/webhook', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ id: 'evt', type: 'subscription.canceled' }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: 'missing stripe-signature header',
    });
    // The verifier must never be consulted when the signature header is absent.
    expect(verify).not.toHaveBeenCalled();
  });

  it('acknowledges a verified-but-unmodeled event with no effect', async () => {
    useGateway(fakeVerifyingGateway(() => null));
    const res = await webhooks.request('/webhook', {
      method: 'POST',
      headers: { ...J, 'stripe-signature': 't=1,v1=ok' },
      body: 'raw stripe payload bytes',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, effect: null });
  });

  it('folds a verified event into billing access without changing retention', async () => {
    const { orgId } = await seedBaseOrg(db, schema, false);
    const rawPayload = 'opaque-stripe-bytes-{not-the-normalized-event}';
    const normalized: BillingEvent = {
      id: 'evt_real',
      type: 'subscription.canceled',
      referenceId: orgId,
      subscription: {
        id: 'sub_real',
        referenceId: orgId,
        status: 'canceled',
        currentPeriodEnd: '2026-01-01T00:00:00.000Z',
      },
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    // The verifier asserts it received the EXACT raw bytes (HMAC requires this), then
    // returns the normalized event the route should fold in.
    const getSubscriptionById = vi.fn().mockResolvedValue(normalized.subscription);
    useGateway({
      ...fakeVerifyingGateway((rawBody) => {
        expect(rawBody).toBe(rawPayload);
        return normalized;
      }),
      getSubscriptionById,
    });
    const res = await webhooks.request('/webhook', {
      method: 'POST',
      headers: { ...J, 'stripe-signature': 't=1,v1=ok' },
      body: rawPayload,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, effect: 'canceled' });
    expect(getSubscriptionById).toHaveBeenCalledWith('sub_real', orgId);
    const [org] = await db
      .select({ lifecycleState: schema.organization.lifecycleState })
      .from(schema.organization)
      .where(eq(schema.organization.id, orgId));
    expect(org?.lifecycleState).toBe('active');
  });

  it('retries a mutable event when Stripe cannot return its current subscription', async () => {
    const { orgId } = await seedBaseOrg(db, schema, false);
    const gateway = {
      ...fakeVerifyingGateway(() => ({
        id: `evt_unobservable_${orgId}`,
        type: 'subscription.updated',
        referenceId: orgId,
        subscriptionId: `sub_unobservable_${orgId}`,
        createdAt: '2026-08-25T00:00:00.000Z',
      })),
      getSubscriptionById: vi.fn().mockResolvedValue(null),
    };
    useGateway(gateway);

    const response = await webhooks.request('/webhook', {
      method: 'POST',
      headers: { ...J, 'stripe-signature': 't=1,v1=ok' },
      body: 'verified-but-not-observable',
    });

    expect(response.status).toBe(500);
    expect(gateway.getSubscriptionById).toHaveBeenCalledWith(`sub_unobservable_${orgId}`, orgId);
    const claimed = await db
      .select()
      .from(schema.billingProviderEvent)
      .where(eq(schema.billingProviderEvent.providerEventId, `evt_unobservable_${orgId}`));
    expect(claimed).toHaveLength(0);
  });

  it('verifies a US Checkout customer before reconciling the retrieved subscription', async () => {
    const { orgId } = await seedBaseOrg(db, schema, false);
    await db.insert(schema.organizationBillingAccount).values({
      organizationId: orgId,
      stripeCustomerId: 'cus_us',
    });
    const getCustomerBillingCountry = vi.fn().mockResolvedValue('US');
    const getSubscription = vi.fn().mockResolvedValue({
      id: 'sub_us',
      referenceId: orgId,
      status: 'trialing',
      currentPeriodEnd: '2026-09-08T00:00:00.000Z',
      trialEnd: '2026-09-08T00:00:00.000Z',
    });
    const gateway = {
      ...fakeVerifyingGateway(() => ({
        id: 'evt_checkout_us',
        type: 'checkout.completed',
        referenceId: orgId,
        customerId: 'cus_us',
        createdAt: '2026-08-25T00:00:00.000Z',
      })),
      getCustomerBillingCountry,
      getSubscription,
    };
    useGateway(gateway);

    const response = await webhooks.request('/webhook', {
      method: 'POST',
      headers: { ...J, 'stripe-signature': 't=1,v1=ok' },
      body: 'verified-checkout',
    });

    expect(await response.json()).toEqual({ received: true, effect: 'trialing' });
    const [account] = await db
      .select()
      .from(schema.organizationBillingAccount)
      .where(eq(schema.organizationBillingAccount.organizationId, orgId));
    expect(account).toMatchObject({ billingCountry: 'US' });
    expect(account?.countryVerifiedAt).not.toBeNull();
    const [entitlement] = await db
      .select()
      .from(schema.organizationProductEntitlement)
      .where(eq(schema.organizationProductEntitlement.organizationId, orgId));
    expect(entitlement).toMatchObject({ status: 'trialing', stripeSubscriptionId: 'sub_us' });
  });

  it('keeps a scheduled award trialing when the zero-dollar invoice arrives first', async () => {
    const { orgId } = await seedBaseOrg(db, schema, false);
    await db.insert(schema.organizationBillingAccount).values({
      organizationId: orgId,
      stripeCustomerId: 'cus_student_trial',
      billingCountry: 'US',
      countryVerifiedAt: new Date('2026-08-25T00:00:00.000Z'),
    });
    const [award] = await db
      .insert(schema.billingDiscountAward)
      .values({
        organizationId: orgId,
        programKey: 'student',
        percentOff: 50,
        status: 'scheduled',
        startsAt: new Date('2026-08-25T00:00:00.000Z'),
        endsAt: new Date('2027-08-25T00:00:00.000Z'),
        reviewAt: new Date('2027-08-25T00:00:00.000Z'),
        reason: 'Verified student',
        providerCouponId: 'coupon_student_trial',
      })
      .returning();
    if (!award) throw new Error('award seed failed');
    const getSubscriptionById = vi.fn().mockResolvedValue({
      id: 'sub_student_trial',
      customerId: 'cus_student_trial',
      referenceId: orgId,
      status: 'trialing',
      currentPeriodEnd: '2026-09-08T00:00:00.000Z',
      trialEnd: '2026-09-08T00:00:00.000Z',
      discountIds: ['di_student_trial'],
      couponIds: ['coupon_student_trial'],
    });
    const gateway = {
      ...fakeVerifyingGateway(() => ({
        id: 'evt_trial_invoice_paid_first',
        type: 'subscription.paid',
        referenceId: orgId,
        customerId: 'cus_student_trial',
        subscriptionId: 'sub_student_trial',
        createdAt: '2026-08-25T00:00:00.000Z',
      })),
      getCustomerBillingCountry: vi.fn().mockResolvedValue('US'),
      getSubscription: vi.fn().mockResolvedValue(null),
      getSubscriptionById,
    };
    useGateway(gateway);

    const response = await webhooks.request('/webhook', {
      method: 'POST',
      headers: { ...J, 'stripe-signature': 't=1,v1=ok' },
      body: 'verified-zero-dollar-invoice',
    });

    expect(await response.json()).toEqual({ received: true, effect: 'trialing' });
    expect(getSubscriptionById).toHaveBeenCalledWith('sub_student_trial', orgId);
    const [entitlement] = await db
      .select()
      .from(schema.organizationProductEntitlement)
      .where(eq(schema.organizationProductEntitlement.organizationId, orgId));
    expect(entitlement).toMatchObject({ status: 'trialing' });
    const [unchangedAward] = await db
      .select()
      .from(schema.billingDiscountAward)
      .where(eq(schema.billingDiscountAward.id, award.id));
    expect(unchangedAward).toMatchObject({ status: 'scheduled' });
  });

  it('rejects a subscription update after a verified customer changes to a non-US address', async () => {
    const { orgId } = await seedBaseOrg(db, schema, false);
    await db.insert(schema.organizationBillingAccount).values({
      organizationId: orgId,
      stripeCustomerId: 'cus_changed_country',
      billingCountry: 'US',
      countryVerifiedAt: new Date('2026-08-24T00:00:00.000Z'),
    });
    const cancelSubscriptionById = vi.fn();
    const gateway = {
      ...fakeVerifyingGateway(() => ({
        id: 'evt_country_changed',
        type: 'subscription.updated',
        referenceId: orgId,
        customerId: 'cus_changed_country',
        createdAt: '2026-08-25T00:00:00.000Z',
      })),
      getCustomerBillingCountry: vi.fn().mockResolvedValue('GB'),
      getSubscription: vi.fn().mockResolvedValue({
        id: 'sub_country_changed',
        customerId: 'cus_changed_country',
        referenceId: orgId,
        status: 'active',
        currentPeriodEnd: '2026-09-08T00:00:00.000Z',
      }),
      cancelSubscriptionById,
    };
    useGateway(gateway);

    const response = await webhooks.request('/webhook', {
      method: 'POST',
      headers: { ...J, 'stripe-signature': 't=1,v1=ok' },
      body: 'verified-country-change',
    });

    expect(await response.json()).toEqual({ received: true, effect: 'unsupported_country' });
    expect(cancelSubscriptionById).toHaveBeenCalledWith(
      'sub_country_changed',
      'billing-country:evt_country_changed:cancel',
      true,
    );
  });

  it('cancels a non-US trial before Docket grants product access', async () => {
    const { orgId } = await seedBaseOrg(db, schema, false);
    await db.insert(schema.organizationBillingAccount).values({
      organizationId: orgId,
      stripeCustomerId: 'cus_gb',
    });
    const getCustomerBillingCountry = vi.fn().mockResolvedValue('GB');
    const getSubscription = vi.fn().mockResolvedValue({
      id: 'sub_gb',
      referenceId: orgId,
      status: 'trialing',
      currentPeriodEnd: '2026-09-08T00:00:00.000Z',
      trialEnd: '2026-09-08T00:00:00.000Z',
    });
    const cancelSubscriptionById = vi.fn();
    const gateway = {
      ...fakeVerifyingGateway(() => ({
        id: 'evt_subscription_gb',
        type: 'subscription.created',
        referenceId: orgId,
        customerId: 'cus_gb',
        createdAt: '2026-08-25T00:00:00.000Z',
      })),
      getCustomerBillingCountry,
      getSubscription,
      cancelSubscriptionById,
    };
    useGateway(gateway);

    const response = await webhooks.request('/webhook', {
      method: 'POST',
      headers: { ...J, 'stripe-signature': 't=1,v1=ok' },
      body: 'verified-subscription',
    });

    expect(await response.json()).toEqual({ received: true, effect: 'unsupported_country' });
    expect(cancelSubscriptionById).toHaveBeenCalledWith(
      'sub_gb',
      'billing-country:evt_subscription_gb:cancel',
      false,
    );
    const entitlements = await db
      .select()
      .from(schema.organizationProductEntitlement)
      .where(eq(schema.organizationProductEntitlement.organizationId, orgId));
    expect(entitlements).toHaveLength(0);
  });

  it('rejects an event whose Stripe customer does not own the organization account', async () => {
    const { orgId } = await seedBaseOrg(db, schema, false);
    await db.insert(schema.organizationBillingAccount).values({
      organizationId: orgId,
      stripeCustomerId: 'cus_owner',
      countryVerificationRequired: false,
    });
    const getSubscription = vi.fn().mockResolvedValue({
      id: 'sub_attacker',
      customerId: 'cus_attacker',
      referenceId: orgId,
      status: 'active',
      currentPeriodEnd: '2026-09-25T00:00:00.000Z',
    });
    const gateway = {
      ...fakeVerifyingGateway(() => ({
        id: 'evt_customer_mismatch',
        type: 'subscription.updated',
        referenceId: orgId,
        customerId: 'cus_attacker',
        createdAt: '2026-08-25T00:00:00.000Z',
      })),
      getSubscription,
    };
    useGateway(gateway);

    const response = await webhooks.request('/webhook', {
      method: 'POST',
      headers: { ...J, 'stripe-signature': 't=1,v1=ok' },
      body: 'verified-mismatch',
    });

    expect(await response.json()).toEqual({
      received: true,
      effect: 'billing_customer_mismatch',
    });
    const entitlements = await db
      .select()
      .from(schema.organizationProductEntitlement)
      .where(eq(schema.organizationProductEntitlement.organizationId, orgId));
    expect(entitlements).toHaveLength(0);
  });
});
