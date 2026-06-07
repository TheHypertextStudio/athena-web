/**
 * `@docket/boundaries/ports` — the `BillingGateway` port.
 *
 * @remarks
 * The single typed edge to a billing provider (Stripe in prod). The real adapter
 * wraps the Stripe SDK + env keys; the mock simulates the
 * `trialing → active → past_due → canceled` lifecycle and emits synthetic webhook
 * events. The 14-day trial, the org data-lifecycle state machine, and the idempotent
 * cron sweep are real business logic exercised against this port — only the I/O edge
 * is swapped (see `boundaries.md` §3).
 */

/** The lifecycle state of a billing subscription. */
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled';

/**
 * A billing subscription as Docket models it — provider-agnostic.
 *
 * @remarks
 * `referenceId` is Docket's own scope key (typically the organization id); the
 * provider's native subscription id is `id`.
 */
export interface Subscription {
  /** Provider subscription id (e.g. a Stripe `sub_...`). */
  readonly id: string;
  /** Docket scope this subscription belongs to (usually the organization id). */
  readonly referenceId: string;
  /** Current lifecycle state. */
  readonly status: SubscriptionStatus;
  /** ISO-8601 timestamp the current paid/trial period ends. */
  readonly currentPeriodEnd: string;
  /** ISO-8601 timestamp the free trial ends, when `status` is `trialing`. */
  readonly trialEnd?: string;
}

/** Input to open a hosted checkout session for a Docket scope. */
export interface CheckoutSessionInput {
  /** Docket scope to bill (usually the organization id). */
  readonly referenceId: string;
  /** Stripe price lookup key or price id to subscribe to. */
  readonly priceKey: string;
  /** URL the provider redirects to on success. */
  readonly successUrl: string;
  /** URL the provider redirects to on cancellation. */
  readonly cancelUrl: string;
  /** Optional email to prefill / attach to the customer. */
  readonly customerEmail?: string;
  /** Optional number of trial days to grant (defaults to the gateway's policy). */
  readonly trialDays?: number;
}

/** Result of opening a checkout session. */
export interface CheckoutSessionResult {
  /** Provider-hosted checkout URL to redirect the browser to. */
  readonly url: string;
  /** Provider checkout session id (echoed back by webhooks). */
  readonly sessionId: string;
}

/** Result of opening a billing self-service portal session. */
export interface BillingPortalSessionResult {
  /** Provider-hosted billing portal URL to redirect the browser to. */
  readonly url: string;
}

/** The kinds of synthetic webhook events the gateway can emit. */
export type BillingEventType =
  | 'checkout.completed'
  | 'subscription.created'
  | 'subscription.updated'
  | 'subscription.trial_will_end'
  | 'subscription.past_due'
  | 'subscription.canceled';

/**
 * A normalized billing webhook event.
 *
 * @remarks
 * The mock gateway emits these deterministically to drive the lifecycle state
 * machine; the real adapter maps verified Stripe webhook payloads into this shape so
 * the consuming cron/handlers never see provider-specific structures.
 */
export interface BillingEvent {
  /** Stable event id (idempotency key for the consumer). */
  readonly id: string;
  /** The event kind. */
  readonly type: BillingEventType;
  /** Docket scope the event concerns (usually the organization id). */
  readonly referenceId: string;
  /** The subscription snapshot at the time of the event, when applicable. */
  readonly subscription?: Subscription;
  /** ISO-8601 timestamp the event was created. */
  readonly createdAt: string;
}

/**
 * The billing provider port: one typed edge for checkout, subscription reads, and
 * cancellation. Implemented by `RealStripeGateway` and `InMemoryBillingGateway`.
 */
export interface BillingGateway {
  /**
   * Open a hosted checkout session to start (or change) a subscription.
   *
   * @param input - The scope, price, and redirect URLs.
   * @returns the hosted checkout URL and the provider session id.
   */
  createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSessionResult>;

  /**
   * Read the current subscription for a Docket scope.
   *
   * @param referenceId - The Docket scope key (usually the organization id).
   * @returns the subscription, or `null` when none exists.
   */
  getSubscription(referenceId: string): Promise<Subscription | null>;

  /**
   * Cancel the subscription for a Docket scope.
   *
   * @param referenceId - The Docket scope key (usually the organization id).
   */
  cancelSubscription(referenceId: string): Promise<void>;

  /**
   * Open a self-service billing portal session for a Docket scope.
   *
   * @param referenceId - The Docket scope key (usually the organization id).
   * @returns the hosted billing-portal URL.
   */
  createBillingPortalSession(referenceId: string): Promise<BillingPortalSessionResult>;
}
