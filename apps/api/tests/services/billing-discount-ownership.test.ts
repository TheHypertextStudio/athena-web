import { describe, expect, it } from 'vitest';

import type { Subscription } from '@docket/billing/contracts';

import { assertSubscriptionDiscountOwnership } from '../../src/services/billing-discount-ownership';

/** Build a current subscription with only the provider fields relevant to discount ownership. */
function subscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: 'sub_docket_pro',
    customerId: 'cus_docket',
    referenceId: 'org_docket',
    status: 'active',
    currentPeriodEnd: '2026-09-30T00:00:00.000Z',
    ...overrides,
  };
}

describe('subscription discount ownership', () => {
  it('accepts a missing subscription and a subscription with no provider discount', () => {
    expect(assertSubscriptionDiscountOwnership(null)).toBeNull();
    expect(assertSubscriptionDiscountOwnership(subscription())).toBeNull();
    expect(
      assertSubscriptionDiscountOwnership(subscription({ discountIds: [], couponIds: [] })),
    ).toBeNull();
  });

  it('accepts the award coupon before and after Stripe exposes its discount id', () => {
    const current = subscription({
      discountIds: ['di_docket'],
      couponIds: ['coupon_docket'],
    });

    expect(
      assertSubscriptionDiscountOwnership(current, {
        providerCouponId: 'coupon_docket',
        providerDiscountId: null,
      }),
    ).toBe('di_docket');
    expect(
      assertSubscriptionDiscountOwnership(current, {
        providerCouponId: 'coupon_docket',
        providerDiscountId: 'di_docket',
      }),
    ).toBe('di_docket');
  });

  it.each([
    { name: 'no Docket award', award: null },
    {
      name: 'no Docket coupon',
      award: { providerCouponId: null, providerDiscountId: null },
    },
    {
      name: 'a different coupon',
      award: { providerCouponId: 'coupon_other', providerDiscountId: null },
    },
    {
      name: 'a different discount',
      award: { providerCouponId: 'coupon_docket', providerDiscountId: 'di_other' },
    },
  ])('rejects provider discounts with $name', ({ award }) => {
    expect(() =>
      assertSubscriptionDiscountOwnership(
        subscription({ discountIds: ['di_docket'], couponIds: ['coupon_docket'] }),
        award,
      ),
    ).toThrow(expect.objectContaining({ code: 'discount_award_conflict' }));
  });

  it('rejects stacked discounts even when one coupon belongs to Docket', () => {
    expect(() =>
      assertSubscriptionDiscountOwnership(
        subscription({
          discountIds: ['di_docket', 'di_other'],
          couponIds: ['coupon_docket', 'coupon_other'],
        }),
        { providerCouponId: 'coupon_docket', providerDiscountId: 'di_docket' },
      ),
    ).toThrow(expect.objectContaining({ code: 'discount_award_conflict' }));
  });
});
