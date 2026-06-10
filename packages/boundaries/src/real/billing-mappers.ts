import type Stripe from 'stripe';

import type {
  BillingEvent,
  BillingEventType,
  CheckoutSessionInput,
  Subscription,
  SubscriptionStatus,
} from '../ports/billing';

/**
 * Map a Stripe subscription status onto the port's {@link SubscriptionStatus}.
 *
 * @param stripeStatus - The raw Stripe `Subscription.status`.
 * @returns the port-level lifecycle status.
 */
export function toStatus(stripeStatus: string): SubscriptionStatus {
  switch (stripeStatus) {
    case 'trialing':
      return 'trialing';
    case 'active':
      return 'active';
    case 'past_due':
    case 'unpaid':
    case 'incomplete':
      return 'past_due';
    default:
      return 'canceled';
  }
}

/**
 * Map a Stripe webhook `event.type` onto the port's {@link BillingEventType}.
 *
 * @remarks
 * Returns `null` for event types Docket does not model. `customer.subscription.updated`
 * is disambiguated by the subscription's mapped status.
 *
 * @param stripeType - The Stripe `Event.type`.
 * @param mappedStatus - The port status of the event's subscription, when present.
 * @returns the port event type, or `null` when the event is not modeled.
 */
export function mapEventType(
  stripeType: string,
  mappedStatus?: SubscriptionStatus,
): BillingEventType | null {
  switch (stripeType) {
    case 'checkout.session.completed':
      return 'checkout.completed';
    case 'customer.subscription.created':
      return 'subscription.created';
    case 'customer.subscription.trial_will_end':
      return 'subscription.trial_will_end';
    case 'customer.subscription.deleted':
      return 'subscription.canceled';
    case 'invoice.payment_failed':
      return 'subscription.past_due';
    case 'customer.subscription.updated':
      return mappedStatus === 'past_due' ? 'subscription.past_due' : 'subscription.updated';
    default:
      return null;
  }
}

/**
 * Map a Stripe `Subscription` object onto the port's {@link Subscription}.
 *
 * @remarks
 * Pure. The `referenceId` is taken from the subscription `metadata`. In the dahlia API
 * `current_period_end` lives on the subscription **items**, read from the first item.
 *
 * @param sub - The Stripe subscription.
 * @param fallbackReferenceId - Reference id to use when the subscription has no metadata.
 */
export function toSubscription(
  sub: Stripe.Subscription,
  fallbackReferenceId?: string,
): Subscription {
  // Stripe's types mark these as always-present, but real payloads can be partial.
  const view = sub as {
    metadata?: Record<string, string> | null;
    items?: { data?: { current_period_end?: number }[] };
  };
  const referenceId = view.metadata?.['referenceId'] ?? fallbackReferenceId ?? '';
  const periodEndUnix = view.items?.data?.[0]?.current_period_end ?? 0;
  return {
    id: sub.id,
    referenceId,
    status: toStatus(sub.status),
    currentPeriodEnd: new Date(periodEndUnix * 1000).toISOString(),
    ...(sub.trial_end ? { trialEnd: new Date(sub.trial_end * 1000).toISOString() } : {}),
  };
}

/**
 * Parse an `apiBase` override (e.g. for `stripe-mock`) into the SDK's host/port/protocol.
 *
 * @remarks
 * Returns an empty object for an absent/blank base so the SDK keeps its live defaults.
 *
 * @param apiBase - An absolute URL such as `http://localhost:12111`.
 * @throws {Error} When `apiBase` is present but not a valid absolute URL.
 */
export function parseApiBase(apiBase: string | undefined): {
  protocol?: 'http' | 'https';
  host?: string;
  port?: number;
} {
  if (!apiBase || apiBase.trim().length === 0) return {};
  let url: URL;
  try {
    url = new URL(apiBase);
  } catch {
    throw new Error(`RealStripeGateway: invalid apiBase override (not an absolute URL).`);
  }
  const protocol = url.protocol === 'http:' ? 'http' : 'https';
  const result: { protocol?: 'http' | 'https'; host?: string; port?: number } = {
    protocol,
    host: url.hostname,
  };
  if (url.port) result.port = Number(url.port);
  return result;
}

/**
 * Build the shared `subscription`-mode session params for a checkout (pure).
 *
 * @param input - The checkout input.
 * @param price - The resolved Stripe price id.
 * @param trialDays - The free-trial length in days.
 */
export function buildBaseCheckoutParams(
  input: CheckoutSessionInput,
  price: string,
  trialDays: number,
): Stripe.Checkout.SessionCreateParams {
  return {
    mode: 'subscription',
    line_items: [{ price, quantity: 1 }],
    client_reference_id: input.referenceId,
    ...(input.customerEmail ? { customer_email: input.customerEmail } : {}),
    subscription_data: {
      trial_period_days: input.trialDays ?? trialDays,
      metadata: { referenceId: input.referenceId },
    },
    metadata: { referenceId: input.referenceId },
  };
}

/**
 * Normalize a verified Stripe {@link Stripe.Event} into a port {@link BillingEvent}.
 *
 * @remarks
 * Pure. Returns `null` for event types Docket does not consume.
 *
 * @param event - A verified Stripe event.
 */
export function mapStripeEvent(event: Stripe.Event): BillingEvent | null {
  const object = event.data.object as unknown as Record<string, unknown>;
  const isSubscription = object['object'] === 'subscription';
  const subscription = isSubscription
    ? toSubscription(object as unknown as Stripe.Subscription)
    : undefined;
  const metadata = object['metadata'] as Record<string, string> | null | undefined;
  const referenceId =
    subscription?.referenceId ??
    metadata?.['referenceId'] ??
    (object['client_reference_id'] as string | undefined) ??
    '';
  const type = mapEventType(event.type, subscription?.status);
  if (!type) return null;
  return {
    id: event.id,
    type,
    referenceId,
    ...(subscription ? { subscription } : {}),
    createdAt: new Date(event.created * 1000).toISOString(),
  };
}
