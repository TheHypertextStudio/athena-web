/** Shared Stripe subscription ownership checks for finance and administrative actions. */
import type { BillingGateway, Subscription } from '@docket/billing/contracts';

import { ConflictError } from '../error';

/** Stable customer-facing provider failure with its private diagnostic cause retained. */
export class ProviderSubscriptionReadError extends ConflictError {
  /** Original provider failure retained for the operator synchronization ledger. */
  readonly providerCause: unknown;

  constructor(cause: unknown) {
    super(
      'Stripe did not confirm the current subscription state. Retry after provider reconciliation.',
      'billing_provider_sync_failed',
    );
    this.providerCause = cause;
  }
}

/**
 * Load the only current provider subscription for one organization.
 *
 * @throws {ConflictError} When Stripe reports more than one current subscription.
 */
export async function loadSingleCurrentSubscription(
  gateway: BillingGateway,
  organizationId: string,
): Promise<Subscription | null> {
  let subscriptions: readonly Subscription[];
  try {
    subscriptions = await gateway.listSubscriptions(organizationId);
  } catch (cause) {
    throw new ProviderSubscriptionReadError(cause);
  }
  const current = subscriptions.filter((subscription) => subscription.status !== 'canceled');
  if (current.length > 1) {
    throw new ConflictError(
      'Multiple current Stripe subscriptions require finance review before this action.',
      'billing_provider_sync_failed',
    );
  }
  return current[0] ?? null;
}
