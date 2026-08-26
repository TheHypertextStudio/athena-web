/** Provider discount ownership checks that prevent Docket from replacing unknown Stripe discounts. */
import type { Subscription } from '@docket/billing/contracts';

import { ConflictError } from '../error';

/** Provider identifiers stored on one Docket discount award. */
export interface DiscountProviderIdentity {
  /** Stripe coupon created for the award. */
  readonly providerCouponId: string | null;
  /** Stripe subscription discount observed after the coupon was attached. */
  readonly providerDiscountId: string | null;
}

/**
 * Confirm that every discount on a Stripe subscription belongs to the current Docket award.
 *
 * @param subscription - Current Stripe subscription snapshot, or null before Checkout.
 * @param award - Current Docket award when this operation renews or retries it.
 * @returns The one observed Stripe discount id, or null when the subscription has no discount.
 * @throws ConflictError when Stripe has an unknown or stacked discount.
 */
export function assertSubscriptionDiscountOwnership(
  subscription: Subscription | null,
  award?: DiscountProviderIdentity | null,
): string | null {
  if (!subscription) return null;
  const discountIds = subscription.discountIds ?? [];
  const couponIds = subscription.couponIds ?? [];
  if (discountIds.length === 0 && couponIds.length === 0) return null;
  const owned =
    award?.providerCouponId !== null &&
    award?.providerCouponId !== undefined &&
    discountIds.length === 1 &&
    couponIds.length === 1 &&
    couponIds[0] === award.providerCouponId &&
    (award.providerDiscountId === null || discountIds[0] === award.providerDiscountId);
  if (!owned) {
    throw new ConflictError(
      'Stripe already has a discount that Docket does not own. Finance must reconcile it before changing this award.',
      'discount_award_conflict',
    );
  }
  return discountIds[0] ?? null;
}
