/** Shared Stripe subscription ownership checks for finance and administrative actions. */
import type { BillingGateway, Subscription } from '@docket/billing/contracts';

import { ConflictError } from '../error';

/**
 * Load the only current provider subscription for one organization.
 *
 * @throws {ConflictError} When Stripe reports more than one current subscription.
 */
export async function loadSingleCurrentSubscription(
  gateway: BillingGateway,
  organizationId: string,
): Promise<Subscription | null> {
  const subscriptions = await gateway.listSubscriptions(organizationId);
  const current = subscriptions.filter((subscription) => subscription.status !== 'canceled');
  if (current.length > 1) {
    throw new ConflictError(
      'Multiple current Stripe subscriptions require finance review before this action.',
      'billing_provider_sync_failed',
    );
  }
  return current[0] ?? null;
}
