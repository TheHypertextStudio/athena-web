import { describe, expect, it } from 'vitest';

import { InMemoryBillingGateway } from '../../src/adapters/in-memory';

describe('InMemoryBillingGateway', () => {
  describe('customer identity', () => {
    it('creates one addressable customer identity for an organization', async () => {
      const gateway = new InMemoryBillingGateway();

      await expect(gateway.listCustomers('org_customer')).resolves.toEqual([]);
      await expect(gateway.createCustomer('org_customer')).resolves.toEqual({
        id: 'cus_org_customer',
        referenceId: 'org_customer',
      });
      await expect(gateway.listCustomers('org_customer')).resolves.toEqual([
        { id: 'cus_org_customer', referenceId: 'org_customer' },
      ]);
      await expect(gateway.getCustomerBillingCountry('cus_org_customer')).resolves.toBe('US');
    });
  });

  it('starts an existing customer without a second trial when trialDays is zero', async () => {
    const gateway = new InMemoryBillingGateway();
    await gateway.createCheckoutSession({
      referenceId: 'org_returning',
      priceKey: 'docket_pro_monthly',
      successUrl: 'https://app/ok',
      cancelUrl: 'https://app/no',
      trialDays: 0,
    });

    const subscription = await gateway.getSubscription('org_returning');
    expect(subscription).toMatchObject({ status: 'active' });
    expect(subscription).not.toHaveProperty('trialEnd');
  });

  describe('createCheckoutSession', () => {
    it('creates a trialing subscription and emits a checkout.completed event', async () => {
      const gw = new InMemoryBillingGateway();
      const result = await gw.createCheckoutSession({
        referenceId: 'org_1',
        priceKey: 'price_team',
        successUrl: 'https://app/ok',
        cancelUrl: 'https://app/no',
      });

      expect(result.sessionId).toMatch(/^cs_\d{6}$/);
      expect(result.url).toBe(`https://billing.mock.docket.local/checkout/${result.sessionId}`);

      const sub = await gw.getSubscription('org_1');
      expect(sub).toMatchObject({ referenceId: 'org_1', status: 'trialing' });
      expect(sub?.trialEnd).toBe(sub?.currentPeriodEnd);

      expect(gw.events).toHaveLength(1);
      expect(gw.events[0]).toMatchObject({ type: 'checkout.completed', referenceId: 'org_1' });
    });

    it('honors a custom trial length', async () => {
      const gw = new InMemoryBillingGateway({ now: '2026-01-01T00:00:00.000Z' });
      await gw.createCheckoutSession({
        referenceId: 'org_2',
        priceKey: 'price_team',
        successUrl: 's',
        cancelUrl: 'c',
        trialDays: 7,
      });
      const sub = await gw.getSubscription('org_2');
      expect(sub?.currentPeriodEnd).toBe('2026-01-08T00:00:00.000Z');
    });

    it('defaults the trial to 14 days when none is given', async () => {
      const gw = new InMemoryBillingGateway({ now: '2026-01-01T00:00:00.000Z' });
      await gw.createCheckoutSession({
        referenceId: 'org_3',
        priceKey: 'price_team',
        successUrl: 's',
        cancelUrl: 'c',
      });
      const sub = await gw.getSubscription('org_3');
      expect(sub?.currentPeriodEnd).toBe('2026-01-15T00:00:00.000Z');
    });

    it('honors a custom base URL for synthetic links', async () => {
      const gw = new InMemoryBillingGateway({ baseUrl: 'https://mock.example.com' });
      const result = await gw.createCheckoutSession({
        referenceId: 'org_4',
        priceKey: 'price_team',
        successUrl: 's',
        cancelUrl: 'c',
      });
      expect(result.url).toBe(`https://mock.example.com/checkout/${result.sessionId}`);
    });
  });

  describe('getSubscription', () => {
    it('returns null when no subscription exists for the scope', async () => {
      const gw = new InMemoryBillingGateway();
      expect(await gw.getSubscription('never_created')).toBeNull();
    });

    it('resolves subscriptions by organization and provider id without crossing tenants', async () => {
      const gw = new InMemoryBillingGateway();
      await gw.createCheckoutSession({
        referenceId: 'org_owned_subscription',
        customerId: 'cus_owned_subscription',
        priceKey: 'price_team',
        successUrl: 's',
        cancelUrl: 'c',
      });
      const subscription = await gw.getSubscription('org_owned_subscription');
      if (!subscription) throw new Error('expected a subscription');

      await expect(
        gw.getSubscriptionById(subscription.id, 'org_owned_subscription'),
      ).resolves.toEqual(subscription);
      await expect(gw.getSubscriptionById(subscription.id, 'org_other')).resolves.toBeNull();
      await expect(
        gw.getSubscriptionById('sub_missing', 'org_owned_subscription'),
      ).resolves.toBeNull();
      await expect(gw.listSubscriptions('org_owned_subscription')).resolves.toEqual([subscription]);
      await expect(gw.listSubscriptions('org_other')).resolves.toEqual([]);
      expect(subscription.customerId).toBe('cus_owned_subscription');
    });
  });

  describe('cancelSubscription', () => {
    it('cancels an existing subscription and emits a subscription.canceled event', async () => {
      const gw = new InMemoryBillingGateway({ now: '2026-01-01T00:00:00.000Z' });
      await gw.createCheckoutSession({
        referenceId: 'org_5',
        priceKey: 'price_team',
        successUrl: 's',
        cancelUrl: 'c',
      });
      await gw.cancelSubscription('org_5');

      const sub = await gw.getSubscription('org_5');
      expect(sub).toMatchObject({
        referenceId: 'org_5',
        status: 'canceled',
        currentPeriodEnd: '2026-01-01T00:00:00.000Z',
      });
      expect(sub).not.toHaveProperty('trialEnd');

      const last = gw.events.at(-1);
      expect(last).toMatchObject({ type: 'subscription.canceled', referenceId: 'org_5' });
    });

    it('is a no-op for a scope with no subscription', async () => {
      const gw = new InMemoryBillingGateway();
      await gw.cancelSubscription('never_created');
      expect(gw.events).toHaveLength(0);
      expect(await gw.getSubscription('never_created')).toBeNull();
    });

    it('schedules cancellation only for the organization that owns the provider subscription', async () => {
      const gw = new InMemoryBillingGateway();
      await gw.createCheckoutSession({
        referenceId: 'org_cancel_owner',
        priceKey: 'price_team',
        successUrl: 's',
        cancelUrl: 'c',
      });
      const subscription = await gw.getSubscription('org_cancel_owner');
      if (!subscription) throw new Error('expected a subscription');

      await expect(
        gw.cancelSubscriptionById(subscription.id, 'org_other', 'cancel-wrong-owner', true),
      ).rejects.toThrow('belongs to another organization');
      await expect(
        gw.cancelSubscriptionById('sub_missing', 'org_cancel_owner', 'cancel-missing', true),
      ).rejects.toThrow('subscription not found');
      await expect(
        gw.cancelSubscriptionById(
          subscription.id,
          'org_cancel_owner',
          'cancel-at-period-end',
          true,
        ),
      ).resolves.toMatchObject({
        id: subscription.id,
        status: 'trialing',
        cancelAtPeriodEnd: true,
      });
    });

    it('cancels an owned provider subscription immediately when period-end access is not requested', async () => {
      const gw = new InMemoryBillingGateway({ now: '2026-01-01T00:00:00.000Z' });
      await gw.createCheckoutSession({
        referenceId: 'org_cancel_now',
        priceKey: 'price_team',
        successUrl: 's',
        cancelUrl: 'c',
      });
      const subscription = await gw.getSubscription('org_cancel_now');
      if (!subscription) throw new Error('expected a subscription');

      await expect(
        gw.cancelSubscriptionById(subscription.id, 'org_cancel_now', 'cancel-now'),
      ).resolves.toMatchObject({
        id: subscription.id,
        status: 'canceled',
        currentPeriodEnd: '2026-01-01T00:00:00.000Z',
      });
    });
  });

  describe('extendTrial', () => {
    it('extends only an existing provider trial', async () => {
      const gw = new InMemoryBillingGateway({ now: '2026-01-01T00:00:00.000Z' });
      await gw.createCheckoutSession({
        referenceId: 'org_trial',
        priceKey: 'price_team',
        successUrl: 's',
        cancelUrl: 'c',
      });

      const extended = await gw.extendTrial('org_trial', 7, 'trial-extension-1');
      expect(extended.trialEnd).toBe('2026-01-22T00:00:00.000Z');
      expect(gw.events.at(-1)).toMatchObject({
        type: 'subscription.updated',
        subscription: { status: 'trialing' },
      });
    });

    it('rejects a missing or paid subscription', async () => {
      const gw = new InMemoryBillingGateway();
      await expect(gw.extendTrial('missing', 7, 'trial-extension-2')).rejects.toThrow(
        'no eligible trialing subscription',
      );
    });
  });

  describe('createBillingPortalSession', () => {
    it('returns a synthetic portal URL addressed by the provider customer id', async () => {
      const gw = new InMemoryBillingGateway({ baseUrl: 'https://mock.example.com' });
      const result = await gw.createBillingPortalSession({
        customerId: 'cus_6',
        returnUrl: 'https://app/return',
      });
      expect(result).toEqual({ url: 'https://mock.example.com/portal/cus_6' });
    });
  });

  describe('discounts and credits', () => {
    it('creates and applies a confirmed award without provider ambiguity', async () => {
      const gw = new InMemoryBillingGateway();
      const coupon = await gw.createDiscountCoupon({
        awardId: 'award_1',
        name: 'Student discount',
        percentOff: 50,
        priceKey: 'docket_pro_monthly',
        idempotencyKey: 'coupon-1',
      });
      await gw.createCheckoutSession({
        referenceId: 'org_discount',
        priceKey: 'docket_pro_monthly',
        successUrl: 's',
        cancelUrl: 'c',
      });
      await expect(
        gw.applySubscriptionDiscount({
          referenceId: 'org_discount',
          couponId: coupon.id,
          idempotencyKey: 'apply-1',
        }),
      ).resolves.toMatchObject({ discountId: expect.stringMatching(/^di_/) });
    });

    it('attaches a Checkout award to the provider subscription', async () => {
      const gw = new InMemoryBillingGateway();
      const coupon = await gw.createDiscountCoupon({
        awardId: 'award_checkout',
        name: 'Nonprofit discount',
        percentOff: 50,
        priceKey: 'docket_pro_monthly',
        idempotencyKey: 'coupon-checkout',
      });

      await gw.createCheckoutSession({
        referenceId: 'org_checkout_award',
        customerId: 'cus_checkout_award',
        couponId: coupon.id,
        priceKey: 'docket_pro_monthly',
        successUrl: 's',
        cancelUrl: 'c',
      });

      await expect(gw.getSubscription('org_checkout_award')).resolves.toMatchObject({
        customerId: 'cus_checkout_award',
        couponIds: [coupon.id],
        discountIds: [expect.stringMatching(/^di_/)],
      });
    });

    it('rejects a Checkout award that the provider has not created', async () => {
      const gw = new InMemoryBillingGateway();

      await expect(
        gw.createCheckoutSession({
          referenceId: 'org_unknown_checkout_award',
          customerId: 'cus_unknown_checkout_award',
          couponId: 'coupon_unknown',
          priceKey: 'docket_pro_monthly',
          successUrl: 's',
          cancelUrl: 'c',
        }),
      ).rejects.toThrow('unknown coupon');
      await expect(gw.getSubscription('org_unknown_checkout_award')).resolves.toBeNull();
    });

    it('rejects a Checkout award scoped to another product', async () => {
      const gw = new InMemoryBillingGateway();
      const coupon = await gw.createDiscountCoupon({
        awardId: 'award_other_product',
        name: 'Other product discount',
        percentOff: 50,
        priceKey: 'other_product_monthly',
        idempotencyKey: 'coupon-other-product',
      });

      await expect(
        gw.createCheckoutSession({
          referenceId: 'org_wrong_product_award',
          customerId: 'cus_wrong_product_award',
          couponId: coupon.id,
          priceKey: 'docket_pro_monthly',
          successUrl: 's',
          cancelUrl: 'c',
        }),
      ).rejects.toThrow('coupon is scoped to another product');
      await expect(gw.getSubscription('org_wrong_product_award')).resolves.toBeNull();
    });

    it('rejects unknown discount ownership and removes an applied award cleanly', async () => {
      const gw = new InMemoryBillingGateway();
      await expect(
        gw.applySubscriptionDiscount({
          referenceId: 'org_without_subscription',
          couponId: 'coupon_missing',
          idempotencyKey: 'apply-without-subscription',
        }),
      ).rejects.toThrow('no subscription for discount');

      await gw.createCheckoutSession({
        referenceId: 'org_remove_award',
        priceKey: 'docket_pro_monthly',
        successUrl: 's',
        cancelUrl: 'c',
      });
      await expect(
        gw.applySubscriptionDiscount({
          referenceId: 'org_remove_award',
          couponId: 'coupon_missing',
          idempotencyKey: 'apply-unknown-coupon',
        }),
      ).rejects.toThrow('unknown coupon');

      const coupon = await gw.createDiscountCoupon({
        awardId: 'award_remove',
        name: 'Student discount',
        percentOff: 50,
        priceKey: 'docket_pro_monthly',
        idempotencyKey: 'coupon-remove',
      });
      await gw.applySubscriptionDiscount({
        referenceId: 'org_remove_award',
        couponId: coupon.id,
        idempotencyKey: 'apply-remove',
      });
      await gw.removeSubscriptionDiscount('org_remove_award', 'remove-award');
      await expect(gw.getSubscription('org_remove_award')).resolves.not.toHaveProperty(
        'discountIds',
      );
      await expect(gw.getSubscription('org_remove_award')).resolves.not.toHaveProperty('couponIds');
      await expect(gw.removeSubscriptionDiscount('org_missing', 'remove-missing')).resolves.toBe(
        undefined,
      );
    });

    it('returns the latest paid recurring line only after a paid period starts', async () => {
      const gw = new InMemoryBillingGateway({ now: '2026-01-01T00:00:00.000Z' });
      await expect(gw.getLatestRecurringInvoice('org_missing')).resolves.toBeNull();
      await gw.createCheckoutSession({
        referenceId: 'org_trial_invoice',
        priceKey: 'docket_pro_monthly',
        successUrl: 's',
        cancelUrl: 'c',
      });
      await expect(gw.getLatestRecurringInvoice('org_trial_invoice')).resolves.toBeNull();

      await gw.createCheckoutSession({
        referenceId: 'org_paid_invoice',
        priceKey: 'docket_pro_monthly',
        successUrl: 's',
        cancelUrl: 'c',
        trialDays: 0,
      });
      await expect(gw.getLatestRecurringInvoice('org_paid_invoice')).resolves.toEqual({
        invoiceId: 'in_org_paid_invoice',
        lineId: 'il_org_paid_invoice',
        invoiceStatus: 'paid',
        currency: 'usd',
        recurringAmount: 800,
        periodStartsAt: '2026-01-01T00:00:00.000Z',
        periodEndsAt: '2026-01-31T00:00:00.000Z',
      });
    });

    it('replays an idempotent discount result without replacing a newer provider state', async () => {
      const gw = new InMemoryBillingGateway();
      const coupon = await gw.createDiscountCoupon({
        awardId: 'award_retry',
        name: 'Student discount',
        percentOff: 50,
        priceKey: 'docket_pro_monthly',
        idempotencyKey: 'coupon-retry',
      });
      await gw.createCheckoutSession({
        referenceId: 'org_discount_retry',
        priceKey: 'docket_pro_monthly',
        successUrl: 's',
        cancelUrl: 'c',
      });
      const firstInput = {
        referenceId: 'org_discount_retry',
        couponId: coupon.id,
        idempotencyKey: 'apply-first',
      };

      const first = await gw.applySubscriptionDiscount(firstInput);
      const second = await gw.applySubscriptionDiscount({
        ...firstInput,
        idempotencyKey: 'apply-second',
      });
      const replayedFirst = await gw.applySubscriptionDiscount(firstInput);
      const otherCoupon = await gw.createDiscountCoupon({
        awardId: 'award_retry_other',
        name: 'Nonprofit discount',
        percentOff: 50,
        priceKey: 'docket_pro_monthly',
        idempotencyKey: 'coupon-retry-other',
      });

      expect(second).not.toEqual(first);
      expect(replayedFirst).toEqual(first);
      await expect(
        gw.applySubscriptionDiscount({
          ...firstInput,
          referenceId: 'org_discount_retry_other',
        }),
      ).rejects.toThrow('idempotency key reused with another discount application');
      await expect(
        gw.applySubscriptionDiscount({
          ...firstInput,
          couponId: otherCoupon.id,
        }),
      ).rejects.toThrow('idempotency key reused with another discount application');
      await expect(gw.getSubscription('org_discount_retry')).resolves.toMatchObject({
        discountIds: [second.discountId],
        couponIds: [coupon.id],
      });
    });

    it('previews and issues a deterministic customer-balance credit', async () => {
      const gw = new InMemoryBillingGateway();
      await expect(
        gw.previewCreditNote({ invoiceId: 'in_1', invoiceLineId: 'il_1', baseAmount: 200 }),
      ).resolves.toEqual({
        baseAmount: 200,
        taxAmount: 0,
        totalAmount: 200,
        prePaymentAmount: 0,
        postPaymentAmount: 200,
      });
      await expect(
        gw.issueCreditNote({
          invoiceId: 'in_1',
          invoiceLineId: 'il_1',
          baseAmount: 200,
          creditAmount: 200,
          idempotencyKey: 'credit-1',
          memo: 'Approved discount',
        }),
      ).resolves.toMatchObject({ id: expect.stringMatching(/^cn_/), totalAmount: 200 });
    });
  });

  describe('advance', () => {
    it('steps a fresh scope through the full lifecycle in order, then returns null', () => {
      const gw = new InMemoryBillingGateway({ now: '2026-01-01T00:00:00.000Z' });

      const created = gw.advance('org_7');
      expect(created).toMatchObject({ type: 'subscription.created', referenceId: 'org_7' });
      expect(created?.subscription).toMatchObject({ status: 'trialing' });
      expect(created?.subscription?.trialEnd).toBe(created?.subscription?.currentPeriodEnd);

      const updated = gw.advance('org_7');
      expect(updated).toMatchObject({ type: 'subscription.updated' });
      expect(updated?.subscription).toMatchObject({ status: 'active' });
      expect(updated?.subscription?.id).toBe(created?.subscription?.id);
      expect(updated?.subscription).not.toHaveProperty('trialEnd');

      const pastDue = gw.advance('org_7');
      expect(pastDue).toMatchObject({ type: 'subscription.past_due' });
      expect(pastDue?.subscription).toMatchObject({ status: 'past_due' });

      const canceled = gw.advance('org_7');
      expect(canceled).toMatchObject({ type: 'subscription.canceled' });
      expect(canceled?.subscription).toMatchObject({ status: 'canceled' });

      expect(gw.advance('org_7')).toBeNull();
      expect(gw.events).toHaveLength(4);
    });

    it('creates a new subscription id when advancing a scope with no prior checkout', () => {
      const gw = new InMemoryBillingGateway();
      const event = gw.advance('org_8');
      expect(event?.subscription?.id).toMatch(/^sub_\d{6}$/);
    });

    it('preserves provider customer ownership through lifecycle and cancellation snapshots', async () => {
      const gw = new InMemoryBillingGateway();
      await gw.createCheckoutSession({
        referenceId: 'org_customer_transition',
        customerId: 'cus_customer_transition',
        priceKey: 'price_team',
        successUrl: 's',
        cancelUrl: 'c',
      });

      expect(gw.advance('org_customer_transition')?.subscription?.customerId).toBe(
        'cus_customer_transition',
      );
      const subscription = await gw.getSubscription('org_customer_transition');
      if (!subscription) throw new Error('expected a subscription');
      await expect(
        gw.cancelSubscriptionById(
          subscription.id,
          'org_customer_transition',
          'cancel-owned-subscription',
        ),
      ).resolves.toMatchObject({ customerId: 'cus_customer_transition', status: 'canceled' });
      expect(gw.events.at(-1)?.subscription?.customerId).toBe('cus_customer_transition');
    });
  });
});
