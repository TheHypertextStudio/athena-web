import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type {
  db as DbType,
  organization as OrgTable,
  organizationProductEntitlement as ProductTable,
} from '@docket/db';
import {
  billingCredit,
  billingDiscountApplication,
  billingDiscountAward,
  notificationIntent,
  organizationBillingAccount,
  user,
} from '@docket/db';

import type { ActorCtx, AppEnv, AuthSession } from '../../src/context';
import { getContainer } from '../../src/container';
import { onError } from '../../src/error';
import type billingRouter from '../../src/routes/billing';
import type cronRouter from '../../src/routes/cron';
import type webhooksRouter from '../../src/routes/webhooks';
import '../support/auth-mock';
import { getMigratedDb } from '../support/db';
import { clearDocketPro, fakeSession } from '../support/routes-harness';
import { assertDefined } from '@docket/test-utils';

let db!: typeof DbType;
let organization!: typeof OrgTable;
let organizationProductEntitlement!: typeof ProductTable;
let webhooks!: typeof webhooksRouter;
let cron!: typeof cronRouter;
let billing!: typeof billingRouter;

/** Mount the billing router behind an injected actor context with the given capabilities. */
function billingApp(
  orgId: string,
  capabilities: readonly string[],
  session: AuthSession = fakeSession('billing-user', 'Billing User', 'billing@example.com'),
) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    const ctx: ActorCtx = { orgId, actorId: 'actor_test', roleId: 'role_test', capabilities };
    c.set('session', session);
    c.set('actorCtx', ctx);
    await next();
  });
  app.route('/', billing);
  app.onError(onError);
  return app;
}

beforeAll(async () => {
  const { env } = await import('../../src/env');
  Reflect.set(env, 'BILLING_ENABLED', true);
  const dbmod = await getMigratedDb();
  db = dbmod.db;
  organization = dbmod.organization;
  organizationProductEntitlement = dbmod.organizationProductEntitlement;
  webhooks = (await import('../../src/routes/webhooks')).default;
  cron = (await import('../../src/routes/cron')).default;
  billing = (await import('../../src/routes/billing')).default;
});

/** Insert an org and return its id. */
async function makeOrg(
  state: 'active' | 'export_window' | 'pending_deletion',
  deleteAfterAt?: Date,
): Promise<string> {
  const slug = `http-${Math.random().toString(36).slice(2, 10)}`;
  const rows = await db
    .insert(organization)
    .values({
      name: slug,
      slug,
      lifecycleState: state,
      ...(deleteAfterAt ? { deleteAfterAt } : {}),
    })
    .returning({ id: organization.id });
  const id = assertDefined(rows[0]).id;
  await clearDocketPro(db, await import('@docket/db'), id);
  return id;
}

/** Bind the organization to the same durable customer that the mock Stripe gateway owns. */
async function bindBillingAccount(organizationId: string): Promise<string> {
  const customer = await getContainer().billing.createCustomer(organizationId);
  await db.insert(organizationBillingAccount).values({
    organizationId,
    stripeCustomerId: customer.id,
  });
  return customer.id;
}

/** Read an org's lifecycle state. */
async function stateOf(id: string): Promise<string> {
  const rows = await db
    .select({ s: organization.lifecycleState })
    .from(organization)
    .where(eq(organization.id, id))
    .limit(1);
  return assertDefined(rows[0]).s;
}

describe('POST /billing/webhook', () => {
  it('400s on a malformed payload', async () => {
    const res = await webhooks.request('/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ not: 'an event' }),
    });
    expect(res.status).toBe(400);
  });

  it('records a canceled product without putting workspace data on a deletion path', async () => {
    const id = await makeOrg('active');
    const customerId = await bindBillingAccount(id);
    const res = await webhooks.request('/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'evt_1',
        type: 'subscription.canceled',
        referenceId: id,
        customerId,
        subscription: {
          id: 'sub_1',
          customerId,
          referenceId: id,
          status: 'canceled',
          currentPeriodEnd: '2026-01-01T00:00:00.000Z',
        },
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { received: boolean; effect: string };
    expect(body.received).toBe(true);
    expect(body.effect).toBe('canceled');
    expect(await stateOf(id)).toBe('active');
  });

  it('acknowledges a duplicate event without applying it twice', async () => {
    const id = await makeOrg('active');
    const customerId = await bindBillingAccount(id);
    const payload = JSON.stringify({
      id: `evt_duplicate_${id}`,
      type: 'subscription.updated',
      referenceId: id,
      customerId,
      subscription: {
        id: `sub_${id}`,
        customerId,
        referenceId: id,
        status: 'active',
        currentPeriodEnd: '2026-09-01T00:00:00.000Z',
      },
      createdAt: '2026-08-25T00:00:00.000Z',
    });
    const first = await webhooks.request('/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payload,
    });
    expect(first.status).toBe(200);

    const duplicate = await webhooks.request('/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payload,
    });
    await expect(duplicate.json()).resolves.toMatchObject({ received: true, effect: 'duplicate' });
  });

  it('reconciles a late trial-ending event before changing access or notifying the customer', async () => {
    const id = await makeOrg('active');
    const customerId = await bindBillingAccount(id);
    await db.insert(organizationProductEntitlement).values({
      organizationId: id,
      productKey: 'docket_pro',
      status: 'active',
      source: 'stripe',
      stripeSubscriptionId: `sub_${id}`,
      currentPeriodEnd: new Date('2026-10-01T00:00:00.000Z'),
    });
    const gateway = getContainer().billing;
    const verifyWebhook = vi.fn(async () => ({
      id: `evt_trial_will_end_${id}`,
      type: 'subscription.trial_will_end' as const,
      referenceId: id,
      customerId,
      subscription: {
        id: `sub_${id}`,
        customerId,
        referenceId: id,
        status: 'trialing' as const,
        currentPeriodEnd: '2026-09-01T00:00:00.000Z',
        trialEnd: '2026-09-01T00:00:00.000Z',
      },
      createdAt: '2026-08-29T00:00:00.000Z',
    }));
    const canonical = vi.spyOn(gateway, 'getSubscriptionById').mockResolvedValueOnce({
      id: `sub_${id}`,
      customerId,
      referenceId: id,
      status: 'active',
      currentPeriodEnd: '2026-10-01T00:00:00.000Z',
    });
    Reflect.set(gateway, 'verifyWebhook', verifyWebhook);

    try {
      const response = await webhooks.request('/webhook', {
        method: 'POST',
        headers: { 'stripe-signature': 'verified-by-test' },
        body: '{}',
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ received: true, effect: 'active' });
      expect(canonical).toHaveBeenCalledWith(`sub_${id}`, id);
      const [entitlement] = await db
        .select({ status: organizationProductEntitlement.status })
        .from(organizationProductEntitlement)
        .where(eq(organizationProductEntitlement.organizationId, id));
      expect(entitlement?.status).toBe('active');
      const trialNotices = await db
        .select({ id: notificationIntent.id })
        .from(notificationIntent)
        .where(eq(notificationIntent.subject, 'Your Docket Pro trial is ending'));
      expect(trialNotices).toHaveLength(0);
    } finally {
      Reflect.deleteProperty(gateway, 'verifyWebhook');
      canonical.mockRestore();
    }
  });

  it('records an active product without changing organization data retention', async () => {
    const id = await makeOrg('active');
    const customerId = await bindBillingAccount(id);
    const res = await webhooks.request('/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'evt_2',
        type: 'subscription.updated',
        referenceId: id,
        customerId,
        subscription: {
          id: 'sub_2',
          customerId,
          referenceId: id,
          status: 'active',
          currentPeriodEnd: '2030-01-01T00:00:00.000Z',
        },
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    });
    expect(res.status).toBe(200);
    expect(await stateOf(id)).toBe('active');
  });

  it('starts a scheduled award with the first paid period after trial', async () => {
    const id = await makeOrg('active');
    const customerId = await bindBillingAccount(id);
    const provisionalStart = new Date('2026-08-25T00:00:00.000Z');
    await db.insert(billingDiscountAward).values({
      organizationId: id,
      programKey: 'student',
      percentOff: 50,
      status: 'scheduled',
      startsAt: provisionalStart,
      endsAt: new Date('2027-08-25T00:00:00.000Z'),
      reviewAt: new Date('2027-08-25T00:00:00.000Z'),
      reason: 'Verified student',
      providerCouponId: `coupon_${id}`,
    });

    const paidAt = '2026-09-08T00:00:00.000Z';
    const response = await webhooks.request('/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: `evt_discount_paid_${id}`,
        type: 'subscription.paid',
        referenceId: id,
        customerId,
        subscription: {
          id: `sub_discount_paid_${id}`,
          customerId,
          referenceId: id,
          status: 'active',
          currentPeriodEnd: '2026-10-08T00:00:00.000Z',
        },
        createdAt: paidAt,
      }),
    });
    expect(response.status).toBe(200);
    const [award] = await db
      .select()
      .from(billingDiscountAward)
      .where(eq(billingDiscountAward.organizationId, id));
    expect(award).toMatchObject({ status: 'active' });
    expect(award?.startsAt.toISOString()).toBe(paidAt);
    expect(award?.endsAt.toISOString()).toBe('2027-09-08T00:00:00.000Z');
  });

  it('refuses to grant Pro when the Stripe customer is not bound to the organization', async () => {
    const id = await makeOrg('active');
    const response = await webhooks.request('/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: `evt_unbound_${id}`,
        type: 'subscription.updated',
        referenceId: id,
        customerId: `cus_unbound_${id}`,
        subscription: {
          id: `sub_unbound_${id}`,
          customerId: `cus_unbound_${id}`,
          referenceId: id,
          status: 'active',
          currentPeriodEnd: '2026-10-08T00:00:00.000Z',
        },
        createdAt: '2026-09-08T00:00:00.000Z',
      }),
    });

    expect(response.status).toBe(500);
    expect(
      await db
        .select()
        .from(organizationProductEntitlement)
        .where(eq(organizationProductEntitlement.organizationId, id)),
    ).toHaveLength(0);
  });

  it('activates a scheduled partner award without extending its finance-approved end date', async () => {
    const id = await makeOrg('active');
    const customerId = await bindBillingAccount(id);
    const approvedEnd = new Date('2026-10-01T00:00:00.000Z');
    await db.insert(billingDiscountAward).values({
      organizationId: id,
      percentOff: 25,
      status: 'scheduled',
      startsAt: new Date('2026-08-25T00:00:00.000Z'),
      endsAt: approvedEnd,
      reviewAt: approvedEnd,
      reason: 'One-month launch partner award',
      providerCouponId: `coupon_partner_${id}`,
    });

    const response = await webhooks.request('/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: `evt_partner_paid_${id}`,
        type: 'subscription.paid',
        referenceId: id,
        customerId,
        subscription: {
          id: `sub_partner_paid_${id}`,
          customerId,
          referenceId: id,
          status: 'active',
          currentPeriodEnd: '2026-10-08T00:00:00.000Z',
        },
        createdAt: '2026-09-08T00:00:00.000Z',
      }),
    });

    expect(response.status).toBe(200);
    const [award] = await db
      .select()
      .from(billingDiscountAward)
      .where(eq(billingDiscountAward.organizationId, id));
    expect(award).toMatchObject({ status: 'active', programKey: null });
    expect(award?.endsAt.toISOString()).toBe(approvedEnd.toISOString());
  });
});

describe('POST /cron/lifecycle-sweep', () => {
  it('401s without the cron secret', async () => {
    const res = await cron.request('/lifecycle-sweep', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('401s with a wrong secret', async () => {
    const res = await cron.request('/lifecycle-sweep', {
      method: 'POST',
      headers: { authorization: 'Bearer nope' },
    });
    expect(res.status).toBe(401);
  });

  it('does not advance billing-created organization deletion states', async () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const id = await makeOrg('export_window', past);
    const res = await cron.request('/lifecycle-sweep', {
      method: 'POST',
      headers: { authorization: 'Bearer test-cron-secret' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      swept: boolean;
      toPendingDeletion: number;
      toDeleted: number;
    };
    expect(body.swept).toBe(false);
    expect(body.toPendingDeletion).toBe(0);
    expect(body.toDeleted).toBe(0);
    expect(await stateOf(id)).toBe('export_window');
  });

  it('accepts the x-cron-secret header too', async () => {
    const res = await cron.request('/lifecycle-sweep', {
      method: 'POST',
      headers: { 'x-cron-secret': 'test-cron-secret' },
    });
    expect(res.status).toBe(200);
  });
});

describe('billing router (org-scoped, via the BillingGateway port)', () => {
  const ORG = 'org_billing_router';

  it('GET / returns baseline Docket before any paid product exists', async () => {
    const orgId = await makeOrg('active');
    const app = billingApp(orgId, ['view']);
    const res = await app.request('/', { method: 'GET' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      organizationId: orgId,
      checkoutEnabled: true,
      listPrice: { amount: 800, currency: 'usd', interval: 'month' },
      accessMode: 'read_only',
      products: [],
      canManageBilling: false,
      effectiveDiscount: null,
      applicationStatus: null,
      issuedCredit: null,
    });
  });

  it('does not describe a scheduled discount as effective before Stripe activates it', async () => {
    const orgId = await makeOrg('active');
    await db.insert(billingDiscountAward).values({
      organizationId: orgId,
      percentOff: 50,
      status: 'scheduled',
      startsAt: new Date('2026-09-01T00:00:00.000Z'),
      endsAt: new Date('2027-09-01T00:00:00.000Z'),
      reviewAt: new Date('2027-09-01T00:00:00.000Z'),
      reason: 'Approved student discount',
      providerCouponId: 'coupon_scheduled',
    });
    const app = billingApp(orgId, ['view']);

    const response = await app.request('/');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ effectiveDiscount: null });
  });

  it('does not attach an expired scheduled award to Checkout', async () => {
    const orgId = await makeOrg('active');
    await db.insert(billingDiscountAward).values({
      organizationId: orgId,
      percentOff: 25,
      status: 'scheduled',
      startsAt: new Date('2025-01-01T00:00:00.000Z'),
      endsAt: new Date('2025-12-31T00:00:00.000Z'),
      reviewAt: new Date('2025-12-31T00:00:00.000Z'),
      reason: 'Expired partner award',
      providerCouponId: 'coupon_expired',
    });
    const createCheckout = vi.spyOn(getContainer().billing, 'createCheckoutSession');
    const app = billingApp(orgId, ['manage']);

    const response = await app.request('/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(200);
    expect(createCheckout).toHaveBeenCalledWith(
      expect.not.objectContaining({ couponId: 'coupon_expired' }),
    );
    createCheckout.mockRestore();
  });

  it('POST /checkout requires manage (403 for a view-only member)', async () => {
    const app = billingApp(ORG, ['view']);
    const res = await app.request('/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(403);
  });

  it('POST /checkout returns a hosted URL without treating the redirect as activation', async () => {
    const orgId = await makeOrg('active');
    const app = billingApp(orgId, ['manage']);
    const checkout = await app.request('/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(checkout.status).toBe(200);
    const created = (await checkout.json()) as { url: string };
    expect(created.url).toMatch(/^https?:\/\//);

    const account = await db
      .select({ customerId: organizationBillingAccount.stripeCustomerId })
      .from(organizationBillingAccount)
      .where(eq(organizationBillingAccount.organizationId, orgId));
    expect(account[0]?.customerId).toBe(`cus_${orgId}`);

    const repeated = await app.request('/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(await repeated.json()).toEqual(created);

    // Product access is webhook-driven. A checkout redirect alone does not write an entitlement.
    const status = await app.request('/', { method: 'GET' });
    expect(await status.json()).toEqual({
      organizationId: orgId,
      checkoutEnabled: true,
      listPrice: { amount: 800, currency: 'usd', interval: 'month' },
      accessMode: 'read_only',
      products: [],
      canManageBilling: true,
      effectiveDiscount: null,
      applicationStatus: null,
      issuedCredit: null,
    });
  });

  it('keeps an ambiguous provider attempt reserved instead of creating a second Checkout', async () => {
    const orgId = await makeOrg('active');
    const app = billingApp(orgId, ['manage']);
    vi.spyOn(getContainer().billing, 'createCheckoutSession').mockRejectedValueOnce(
      new Error('Stripe timeout with an unknown result'),
    );

    const first = await app.request('/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(first.status).toBe(500);

    const repeated = await app.request('/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(repeated.status).toBe(409);
    await expect(repeated.json()).resolves.toMatchObject({ code: 'checkout_pending' });
  });

  it('releases the Checkout lease when subscription discovery fails before provider creation', async () => {
    const orgId = await makeOrg('active');
    const app = billingApp(orgId, ['manage']);
    const listSubscriptions = vi
      .spyOn(getContainer().billing, 'listSubscriptions')
      .mockRejectedValueOnce(new Error('Stripe search unavailable'));

    const first = await app.request('/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(first.status).toBe(500);

    const retry = await app.request('/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(retry.status).toBe(200);
    expect(listSubscriptions).toHaveBeenCalledTimes(3);
    listSubscriptions.mockRestore();
  });

  it('blocks new Checkout before it creates provider or database state when billing is disabled', async () => {
    const { env } = await import('../../src/env');
    const orgId = await makeOrg('active');
    const app = billingApp(orgId, ['manage']);
    Reflect.set(env, 'BILLING_ENABLED', false);
    try {
      const response = await app.request('/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({ code: 'billing_unavailable' });
      const accounts = await db
        .select()
        .from(organizationBillingAccount)
        .where(eq(organizationBillingAccount.organizationId, orgId));
      expect(accounts).toHaveLength(0);
    } finally {
      Reflect.set(env, 'BILLING_ENABLED', true);
    }
  });

  it('blocks new discount applications without hiding existing discount status', async () => {
    const { env } = await import('../../src/env');
    const orgId = await makeOrg('active');
    const app = billingApp(orgId, ['manage']);
    Reflect.set(env, 'BILLING_ENABLED', false);
    try {
      const status = await app.request('/discounts');
      expect(status.status).toBe(200);
      await expect(status.json()).resolves.toMatchObject({ applicationsEnabled: false });

      const response = await app.request('/discounts/applications', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          programKey: 'nonprofit',
          evidenceType: 'irs_registry',
          ein: '12-3456789',
        }),
      });
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({ code: 'billing_unavailable' });
      const applications = await db
        .select()
        .from(billingDiscountApplication)
        .where(eq(billingDiscountApplication.organizationId, orgId));
      expect(applications).toHaveLength(0);
    } finally {
      Reflect.set(env, 'BILLING_ENABLED', true);
    }
  });

  it('does not accept a discount application for Complimentary Docket Pro', async () => {
    const orgId = await makeOrg('active');
    await db.insert(organizationProductEntitlement).values({
      organizationId: orgId,
      productKey: 'docket_pro',
      status: 'active',
      source: 'complimentary',
    });
    const app = billingApp(orgId, ['manage']);

    const response = await app.request('/discounts/applications', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        programKey: 'nonprofit',
        evidenceType: 'irs_registry',
        ein: '12-3456789',
      }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'subscription_exists' });
    const applications = await db
      .select()
      .from(billingDiscountApplication)
      .where(eq(billingDiscountApplication.organizationId, orgId));
    expect(applications).toHaveLength(0);
  });

  it('does not accept caller-controlled checkout return URLs', async () => {
    const app = billingApp(`${ORG}_redirect`, ['manage']);
    const res = await app.request('/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ successUrl: 'https://attacker.example', cancelUrl: 'https://x.test' }),
    });
    expect(res.status).toBe(422);
  });

  it('does not grant a second trial after the organization has owned Docket Pro', async () => {
    const orgId = await makeOrg('active');
    await db.insert(organizationProductEntitlement).values({
      organizationId: orgId,
      productKey: 'docket_pro',
      status: 'canceled',
      source: 'stripe',
    });
    const app = billingApp(orgId, ['manage']);
    const res = await app.request('/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const subscription = await getContainer().billing.getSubscription(orgId);
    expect(subscription).toMatchObject({ status: 'active' });
    expect(subscription).not.toHaveProperty('trialEnd');
  });

  it('does not grant a public trial after complimentary Pro is revoked', async () => {
    const orgId = await makeOrg('active');
    const consumedAt = new Date('2026-08-01T00:00:00.000Z');
    await db.insert(organizationBillingAccount).values({
      organizationId: orgId,
      stripeCustomerId: null,
      trialConsumedAt: consumedAt,
    });
    await db.insert(organizationProductEntitlement).values({
      organizationId: orgId,
      productKey: 'docket_pro',
      status: 'canceled',
      source: 'complimentary',
      canceledAt: new Date('2026-08-15T00:00:00.000Z'),
    });
    const app = billingApp(orgId, ['manage']);

    const response = await app.request('/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(200);
    const subscription = await getContainer().billing.getSubscription(orgId);
    expect(subscription).toMatchObject({ status: 'active' });
    expect(subscription).not.toHaveProperty('trialEnd');
    const [account] = await db
      .select()
      .from(organizationBillingAccount)
      .where(eq(organizationBillingAccount.organizationId, orgId));
    expect(account).toMatchObject({
      stripeCustomerId: `cus_${orgId}`,
      trialConsumedAt: consumedAt,
    });
  });

  it('POST /portal returns a hosted portal url for a manager', async () => {
    const orgId = await makeOrg('active');
    const app = billingApp(orgId, ['manage']);
    await app.request('/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    const res = await app.request('/portal', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string };
    expect(body.url).toMatch(/^https?:\/\//);
    expect(body.url).toContain(`cus_${orgId}`);
  });

  it('POST /portal refuses to invent a replacement customer identity', async () => {
    const orgId = await makeOrg('active');
    const app = billingApp(orgId, ['manage']);
    const res = await app.request('/portal', { method: 'POST' });
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ code: 'billing_customer_missing' });
  });

  it('does not expose Stripe management for Complimentary Docket Pro', async () => {
    const orgId = await makeOrg('active');
    await bindBillingAccount(orgId);
    await db.insert(organizationProductEntitlement).values({
      organizationId: orgId,
      productKey: 'docket_pro',
      status: 'active',
      source: 'complimentary',
    });
    const createPortal = vi.spyOn(getContainer().billing, 'createBillingPortalSession');
    const app = billingApp(orgId, ['manage']);

    const response = await app.request('/portal', { method: 'POST' });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'subscription_exists' });
    expect(createPortal).not.toHaveBeenCalled();
    createPortal.mockRestore();
  });

  it('submits a student application from the Better Auth verified email for a personal workspace', async () => {
    const userId = `student-${Date.now()}`;
    await db.insert(user).values({
      id: userId,
      name: 'Verified Student',
      email: `${userId}@unlv.edu`,
      emailVerified: true,
    });
    const orgId = await makeOrg('active');
    await db.update(organization).set({ isPersonal: true }).where(eq(organization.id, orgId));
    const app = billingApp(
      orgId,
      ['manage'],
      fakeSession(userId, 'Verified Student', `${userId}@unlv.edu`),
    );

    const submitted = await app.request('/discounts/applications', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        programKey: 'student',
        evidenceType: 'institutional_email',
        institutionalEmail: `${userId}@unlv.edu`,
      }),
    });

    expect(submitted.status).toBe(201);
    await expect(submitted.json()).resolves.toMatchObject({
      programKey: 'student',
      status: 'submitted',
      institutionalEmail: `${userId}@unlv.edu`,
    });
    const summary = await app.request('/discounts');
    await expect(summary.json()).resolves.toMatchObject({
      programs: expect.arrayContaining([
        expect.objectContaining({ key: 'student', percentOff: 50, reviewMonths: 12 }),
      ]),
      application: expect.objectContaining({ status: 'submitted' }),
    });

    const duplicate = await app.request('/discounts/applications', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        programKey: 'student',
        evidenceType: 'institutional_email',
        institutionalEmail: `${userId}@unlv.edu`,
      }),
    });
    expect(duplicate.status).toBe(409);
    await expect(duplicate.json()).resolves.toMatchObject({ code: 'discount_application_pending' });
  });

  it('uses Better Auth verification instead of trusting a submitted institutional email', async () => {
    const userId = `unverified-${Date.now()}`;
    await db.insert(user).values({
      id: userId,
      name: 'Unverified Student',
      email: `${userId}@unlv.edu`,
      emailVerified: false,
    });
    const orgId = await makeOrg('active');
    await db.update(organization).set({ isPersonal: true }).where(eq(organization.id, orgId));
    const session = fakeSession(userId, 'Unverified Student', `${userId}@unlv.edu`);
    if (session) session.user.emailVerified = false;
    const app = billingApp(orgId, ['manage'], session);

    const response = await app.request('/discounts/applications', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        programKey: 'student',
        evidenceType: 'institutional_email',
        institutionalEmail: `${userId}@unlv.edu`,
      }),
    });
    expect(response.status).toBe(409);
  });

  it('uses Better Auth verification when a student supplements requested information', async () => {
    const userId = `supplement-${Date.now()}`;
    const verifiedEmail = `${userId}@unlv.edu`;
    await db.insert(user).values({
      id: userId,
      name: 'Verified Student',
      email: verifiedEmail,
      emailVerified: true,
    });
    const orgId = await makeOrg('active');
    await db.update(organization).set({ isPersonal: true }).where(eq(organization.id, orgId));
    const [application] = await db
      .insert(billingDiscountApplication)
      .values({
        organizationId: orgId,
        applicantUserId: userId,
        programKey: 'student',
        status: 'needs_information',
        evidenceType: 'institutional_email',
        institutionalEmail: verifiedEmail,
        informationRequest: 'Confirm the current institutional email.',
      })
      .returning();
    if (!application) throw new Error('application seed failed');
    const app = billingApp(
      orgId,
      ['manage'],
      fakeSession(userId, 'Verified Student', verifiedEmail),
    );

    const response = await app.request(`/discounts/applications/${application.id}/supplement`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        institutionalEmail: 'someone-else@unlv.edu',
        note: 'Use this address.',
      }),
    });

    expect(response.status).toBe(409);
  });

  it('submits nonprofit evidence only for a nonprofit workspace', async () => {
    const userId = `nonprofit-${Date.now()}`;
    await db.insert(user).values({
      id: userId,
      name: 'Nonprofit Applicant',
      email: `${userId}@example.org`,
      emailVerified: true,
    });
    const orgId = await makeOrg('active');
    const app = billingApp(
      orgId,
      ['manage'],
      fakeSession(userId, 'Nonprofit Applicant', `${userId}@example.org`),
    );

    const submitted = await app.request('/discounts/applications', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        programKey: 'nonprofit',
        evidenceType: 'irs_registry',
        ein: '12-3456789',
      }),
    });

    expect(submitted.status).toBe(201);
    await expect(submitted.json()).resolves.toMatchObject({
      programKey: 'nonprofit',
      ein: '12-3456789',
      institutionalEmail: null,
    });

    await db.update(organization).set({ isPersonal: true }).where(eq(organization.id, orgId));
    const personal = await app.request('/discounts/applications', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        programKey: 'nonprofit',
        evidenceType: 'irs_registry',
        ein: '12-3456789',
      }),
    });
    expect(personal.status).toBe(409);
  });

  it('returns a supplemented application to review and lets its owner withdraw it', async () => {
    const userId = `lifecycle-${Date.now()}`;
    const email = `${userId}@unlv.edu`;
    await db.insert(user).values({
      id: userId,
      name: 'Student Applicant',
      email,
      emailVerified: true,
    });
    const orgId = await makeOrg('active');
    await db.update(organization).set({ isPersonal: true }).where(eq(organization.id, orgId));
    const [application] = await db
      .insert(billingDiscountApplication)
      .values({
        organizationId: orgId,
        applicantUserId: userId,
        programKey: 'student',
        status: 'needs_information',
        evidenceType: 'institutional_email',
        institutionalEmail: email,
        informationRequest: 'Confirm the institutional address.',
      })
      .returning();
    const row = assertDefined(application);
    const app = billingApp(orgId, ['manage'], fakeSession(userId, 'Student Applicant', email));

    const supplemented = await app.request(`/discounts/applications/${row.id}/supplement`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ institutionalEmail: email, note: 'The address is current.' }),
    });
    expect(supplemented.status).toBe(200);
    await expect(supplemented.json()).resolves.toMatchObject({
      status: 'submitted',
      informationRequest: null,
      events: expect.arrayContaining([expect.objectContaining({ type: 'supplemented' })]),
    });

    const withdrawn = await app.request(`/discounts/applications/${row.id}/withdraw`, {
      method: 'POST',
    });
    expect(withdrawn.status).toBe(200);
    await expect(withdrawn.json()).resolves.toMatchObject({
      status: 'withdrawn',
      events: expect.arrayContaining([expect.objectContaining({ type: 'withdrawn' })]),
    });
  });

  it('stores supported private evidence and rejects evidence after withdrawal', async () => {
    const userId = `evidence-${Date.now()}`;
    const email = `${userId}@unlv.edu`;
    await db.insert(user).values({
      id: userId,
      name: 'Evidence Applicant',
      email,
      emailVerified: true,
    });
    const orgId = await makeOrg('active');
    await db.update(organization).set({ isPersonal: true }).where(eq(organization.id, orgId));
    const [application] = await db
      .insert(billingDiscountApplication)
      .values({
        organizationId: orgId,
        applicantUserId: userId,
        programKey: 'student',
        status: 'submitted',
        evidenceType: 'enrollment_document',
      })
      .returning();
    const row = assertDefined(application);
    const app = billingApp(orgId, ['manage'], fakeSession(userId, 'Evidence Applicant', email));
    const form = new FormData();
    form.set('file', new File(['proof'], 'enrollment.pdf', { type: 'application/pdf' }));

    const uploaded = await app.request(`/discounts/applications/${row.id}/evidence`, {
      method: 'POST',
      body: form,
    });
    expect(uploaded.status).toBe(201);
    await expect(uploaded.json()).resolves.toMatchObject({
      events: expect.arrayContaining([expect.objectContaining({ type: 'evidence_uploaded' })]),
    });

    await app.request(`/discounts/applications/${row.id}/withdraw`, { method: 'POST' });
    const rejected = await app.request(`/discounts/applications/${row.id}/evidence`, {
      method: 'POST',
      body: form,
    });
    expect(rejected.status).toBe(409);
  });

  it('returns the application, award, and issued credit from the discount summary', async () => {
    const userId = `summary-${Date.now()}`;
    await db.insert(user).values({
      id: userId,
      name: 'Summary Applicant',
      email: `${userId}@example.org`,
    });
    const orgId = await makeOrg('active');
    const [application] = await db
      .insert(billingDiscountApplication)
      .values({
        organizationId: orgId,
        applicantUserId: userId,
        programKey: 'nonprofit',
        status: 'approved',
        evidenceType: 'irs_registry',
        ein: '12-3456789',
        decisionReason: 'Verified.',
        decidedAt: new Date('2026-08-01T00:00:00.000Z'),
      })
      .returning();
    const [award] = await db
      .insert(billingDiscountAward)
      .values({
        organizationId: orgId,
        applicationId: assertDefined(application).id,
        programKey: 'nonprofit',
        percentOff: 50,
        status: 'active',
        startsAt: new Date('2026-08-01T00:00:00.000Z'),
        endsAt: new Date('2027-08-01T00:00:00.000Z'),
        reviewAt: new Date('2027-08-01T00:00:00.000Z'),
        reason: 'Verified.',
      })
      .returning();
    await db.insert(billingCredit).values({
      organizationId: orgId,
      awardId: assertDefined(award).id,
      status: 'issued',
      currency: 'usd',
      baseAmount: 400,
      taxAmount: 0,
      totalAmount: 400,
      servicePeriodStartsAt: new Date('2026-08-01T00:00:00.000Z'),
      servicePeriodEndsAt: new Date('2026-09-01T00:00:00.000Z'),
      providerInvoiceId: `in_${orgId}`,
      providerCreditNoteId: `cn_${orgId}`,
      issuedAt: new Date('2026-08-02T00:00:00.000Z'),
    });

    const response = await billingApp(orgId, ['view']).request('/discounts');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      application: { id: assertDefined(application).id, programKey: 'nonprofit' },
      award: { id: assertDefined(award).id, status: 'active' },
      credit: { status: 'issued', totalAmount: 400, issuedAt: '2026-08-02T00:00:00.000Z' },
    });
  });

  it('accepts a matching renewal application and refuses an unmatched renewal', async () => {
    const userId = `renewal-${Date.now()}`;
    const email = `${userId}@unlv.edu`;
    await db.insert(user).values({
      id: userId,
      name: 'Renewing Student',
      email,
      emailVerified: true,
    });
    const orgId = await makeOrg('active');
    await db.update(organization).set({ isPersonal: true }).where(eq(organization.id, orgId));
    await db.insert(billingDiscountAward).values({
      organizationId: orgId,
      programKey: 'student',
      percentOff: 50,
      status: 'active',
      startsAt: new Date('2026-08-01T00:00:00.000Z'),
      endsAt: new Date('2027-08-01T00:00:00.000Z'),
      reviewAt: new Date('2027-08-01T00:00:00.000Z'),
      reason: 'Existing student award.',
    });
    const app = billingApp(orgId, ['manage'], fakeSession(userId, 'Renewing Student', email));

    const renewed = await app.request('/discounts/renew', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        programKey: 'student',
        evidenceType: 'institutional_email',
        institutionalEmail: email,
      }),
    });
    expect(renewed.status).toBe(201);
    await expect(renewed.json()).resolves.toMatchObject({
      programKey: 'student',
      status: 'submitted',
    });

    const mismatch = await app.request('/discounts/renew', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        programKey: 'nonprofit',
        evidenceType: 'irs_registry',
        ein: '12-3456789',
      }),
    });
    expect(mismatch.status).toBe(409);
  });

  it('keeps discount applications private to the member who submitted them', async () => {
    const ownerId = `owner-${Date.now()}`;
    const otherId = `other-${Date.now()}`;
    await db.insert(user).values([
      { id: ownerId, name: 'Application Owner', email: `${ownerId}@example.com` },
      { id: otherId, name: 'Other Member', email: `${otherId}@example.com` },
    ]);
    const orgId = await makeOrg('active');
    const [application] = await db
      .insert(billingDiscountApplication)
      .values({
        organizationId: orgId,
        applicantUserId: ownerId,
        programKey: 'nonprofit',
        status: 'submitted',
        evidenceType: 'irs_registry',
        ein: '12-3456789',
      })
      .returning();
    const app = billingApp(
      orgId,
      ['manage'],
      fakeSession(otherId, 'Other Member', `${otherId}@example.com`),
    );

    const withdrawal = await app.request(
      `/discounts/applications/${assertDefined(application).id}/withdraw`,
      { method: 'POST' },
    );
    expect(withdrawal.status).toBe(404);
  });
});
