/**
 * `@docket/billing/contracts` - the billing provider contract.
 *
 * @remarks
 * The single typed edge to a billing provider (Stripe in prod). The real adapter
 * wraps the Stripe SDK + env keys; the mock simulates the
 * `trialing → active → past_due → canceled` lifecycle and emits synthetic webhook
 * events. The 14-day trial, the org data-lifecycle state machine, and the idempotent
 * cron sweep are real business logic exercised against this port; only the I/O edge
 * is swapped by the app container.
 */

/** The lifecycle state of a billing subscription. */
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled';

/** The paid products an organization can own. */
export const PRODUCT_KEYS = ['docket_pro'] as const;

/** A stable key for a paid organization product. */
export type ProductKey = (typeof PRODUCT_KEYS)[number];

/** Capabilities supplied by paid products rather than baseline Docket. */
export const PRODUCT_CAPABILITIES = [
  'shared_work',
  'integrations',
  'mcp',
  'athena',
  'voice',
] as const;

/** A capability that can be granted by an organization product. */
export type ProductCapability = (typeof PRODUCT_CAPABILITIES)[number];

/** Product ownership states used by billing and access checks. */
export const PRODUCT_ENTITLEMENT_STATUSES = ['trialing', 'active', 'past_due', 'canceled'] as const;

/** The billing state of one organization product. */
export type ProductEntitlementStatus = (typeof PRODUCT_ENTITLEMENT_STATUSES)[number];

/** How an organization received a product. */
export const PRODUCT_ENTITLEMENT_SOURCES = ['stripe', 'complimentary'] as const;

/** The source of one organization product grant. */
export type ProductEntitlementSource = (typeof PRODUCT_ENTITLEMENT_SOURCES)[number];

/** Product-to-capability catalog. Baseline Docket is intentionally absent. */
export const PRODUCT_CAPABILITY_GRANTS: Readonly<Record<ProductKey, readonly ProductCapability[]>> =
  {
    docket_pro: PRODUCT_CAPABILITIES,
  };

/** True when a string names a paid Docket product. */
export function isProductKey(value: string): value is ProductKey {
  return PRODUCT_KEYS.some((productKey) => productKey === value);
}

/** True when a product includes a capability. */
export function productGrantsCapability(
  productKey: ProductKey,
  capability: ProductCapability,
): boolean {
  return PRODUCT_CAPABILITY_GRANTS[productKey].includes(capability);
}

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
  /** Provider customer that owns this subscription, when the provider supplied it. */
  readonly customerId?: string;
  /** Docket scope this subscription belongs to (usually the organization id). */
  readonly referenceId: string;
  /** Current lifecycle state. */
  readonly status: SubscriptionStatus;
  /** ISO-8601 timestamp the current paid/trial period ends. */
  readonly currentPeriodEnd: string;
  /** ISO-8601 timestamp the free trial ends, when `status` is `trialing`. */
  readonly trialEnd?: string;
  /** Whether Stripe will cancel the subscription when the current paid period ends. */
  readonly cancelAtPeriodEnd?: boolean;
  /** Provider discount ids currently attached to this subscription. */
  readonly discountIds?: readonly string[];
  /** Provider coupon ids behind the current subscription discounts. */
  readonly couponIds?: readonly string[];
}

/** Input to open a hosted checkout session for a Docket scope. */
export interface CheckoutSessionInput {
  /** Docket scope to bill (usually the organization id). */
  readonly referenceId: string;
  /** Existing provider customer id owned by this Docket organization. */
  readonly customerId?: string;
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
  /** Provider coupon to apply when an approved award predates the subscription. */
  readonly couponId?: string;
  /** Stable provider idempotency key for this durable Checkout attempt. */
  readonly idempotencyKey?: string;
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

/** A provider customer durably associated with one Docket organization. */
export interface BillingCustomer {
  /** Provider customer id. */
  readonly id: string;
  /** Docket organization that owns the provider customer. */
  readonly referenceId: string;
}

/** Input for a hosted customer-portal session. */
export interface BillingPortalSessionInput {
  /** Existing provider customer id. */
  readonly customerId: string;
  /** Absolute Docket URL Stripe returns to after portal work. */
  readonly returnUrl: string;
}

/** Input for a product-scoped percentage coupon owned by one Docket award. */
export interface DiscountCouponInput {
  /** Durable Docket award id used in provider metadata. */
  readonly awardId: string;
  /** Human-readable provider name. */
  readonly name: string;
  /** Integer discount percentage from 1 through 90. */
  readonly percentOff: number;
  /** Docket Pro price id or lookup key used to resolve the scoped Stripe product. */
  readonly priceKey: string;
  /** Stable provider idempotency key. */
  readonly idempotencyKey: string;
}

/** Provider coupon created for one approved Docket award. */
export interface DiscountCoupon {
  /** Provider coupon id. */
  readonly id: string;
}

/** Input for applying one coupon to an existing organization subscription. */
export interface SubscriptionDiscountInput {
  /** Docket organization whose subscription receives the coupon. */
  readonly referenceId: string;
  /** Provider coupon id. */
  readonly couponId: string;
  /** Stable provider idempotency key. */
  readonly idempotencyKey: string;
}

/** Result of applying a coupon to an existing subscription. */
export interface AppliedSubscriptionDiscount {
  /** Provider discount id when Stripe exposes one on the updated subscription. */
  readonly discountId: string | null;
}

/** The latest Docket Pro invoice line eligible for a mid-period credit. */
export interface RecurringInvoiceLine {
  /** Provider invoice id. */
  readonly invoiceId: string;
  /** Provider invoice-line id. */
  readonly lineId: string;
  /** Invoice state used to choose open-invoice reduction or customer-balance credit. */
  readonly invoiceStatus: 'open' | 'paid';
  /** Lowercase ISO currency. */
  readonly currency: string;
  /** Recurring line amount before tax and the newly approved discount. */
  readonly recurringAmount: number;
  /** Inclusive service-period start. */
  readonly periodStartsAt: string;
  /** Exclusive service-period end. */
  readonly periodEndsAt: string;
}

/** Input for previewing a tax-aware credit against one recurring invoice line. */
export interface CreditNotePreviewInput {
  /** Provider invoice id. */
  readonly invoiceId: string;
  /** Provider invoice-line id. */
  readonly invoiceLineId: string;
  /** Base unused-service credit in currency minor units. */
  readonly baseAmount: number;
}

/** Tax-aware values returned by the provider credit-note preview. */
export interface CreditNotePreview {
  /** Base service credit requested by Docket. */
  readonly baseAmount: number;
  /** Tax adjustment calculated by Stripe. */
  readonly taxAmount: number;
  /** Total customer credit including tax adjustment. */
  readonly totalAmount: number;
  /** Portion that reduces the currently open invoice. */
  readonly prePaymentAmount: number;
  /** Portion that must become customer balance for a paid invoice. */
  readonly postPaymentAmount: number;
}

/** Input for issuing a previously previewed credit note. */
export interface CreditNoteIssueInput extends CreditNotePreviewInput {
  /** Customer-balance credit from the Stripe preview. */
  readonly creditAmount: number;
  /** Stable provider idempotency key. */
  readonly idempotencyKey: string;
  /** Audit memo shown on the Stripe credit note. */
  readonly memo: string;
}

/** Issued provider credit note. */
export interface IssuedCreditNote extends CreditNotePreview {
  /** Provider credit-note id. */
  readonly id: string;
}

/** The kinds of synthetic webhook events the gateway can emit. */
export type BillingEventType =
  | 'checkout.completed'
  | 'subscription.created'
  | 'subscription.updated'
  | 'subscription.trial_will_end'
  | 'subscription.paid'
  | 'subscription.payment_action_required'
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
  /** Provider customer id carried by Checkout or invoice events. */
  readonly customerId?: string;
  /** Provider subscription id carried by Checkout or invoice events. */
  readonly subscriptionId?: string;
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
  /** Create the provider customer owned by one Docket organization. */
  createCustomer(referenceId: string, email?: string): Promise<BillingCustomer>;

  /** Read the ISO billing country saved on a provider customer after hosted Checkout. */
  getCustomerBillingCountry(customerId: string): Promise<string | null>;

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

  /** List every provider subscription carrying this Docket organization reference. */
  listSubscriptions(referenceId: string): Promise<readonly Subscription[]>;

  /**
   * Cancel the subscription for a Docket scope.
   *
   * @param referenceId - The Docket scope key (usually the organization id).
   */
  cancelSubscription(referenceId: string): Promise<void>;

  /** Cancel one exact provider subscription without relying on eventually consistent search. */
  cancelSubscriptionById(subscriptionId: string, idempotencyKey: string): Promise<void>;

  /**
   * Extend an existing provider trial without changing local access directly.
   *
   * @param referenceId - The Docket organization that owns the trialing subscription.
   * @param days - Additional whole days to add to the current trial boundary.
   * @returns the provider's updated subscription snapshot.
   */
  extendTrial(referenceId: string, days: number, idempotencyKey: string): Promise<Subscription>;

  /**
   * Open a self-service billing portal session for a Docket scope.
   *
   * @param referenceId - The Docket scope key (usually the organization id).
   * @returns the hosted billing-portal URL.
   */
  createBillingPortalSession(input: BillingPortalSessionInput): Promise<BillingPortalSessionResult>;

  /** Create a product-scoped repeating percentage coupon for an approved award. */
  createDiscountCoupon(input: DiscountCouponInput): Promise<DiscountCoupon>;

  /** Apply a confirmed coupon to an existing subscription without proration. */
  applySubscriptionDiscount(input: SubscriptionDiscountInput): Promise<AppliedSubscriptionDiscount>;

  /** Remove the current subscription discount at an approved renewal boundary. */
  removeSubscriptionDiscount(referenceId: string, idempotencyKey: string): Promise<void>;

  /** Read the latest open or paid Docket Pro invoice line for mid-period credit calculation. */
  getLatestRecurringInvoice(referenceId: string): Promise<RecurringInvoiceLine | null>;

  /** Preview a tax-aware credit against one recurring invoice line. */
  previewCreditNote(input: CreditNotePreviewInput): Promise<CreditNotePreview>;

  /** Issue a credit note from values finance already previewed. */
  issueCreditNote(input: CreditNoteIssueInput): Promise<IssuedCreditNote>;
}
