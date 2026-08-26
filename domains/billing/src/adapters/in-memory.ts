/**
 * `@docket/billing/adapters/in-memory` - `InMemoryBillingGateway`.
 *
 * @remarks
 * A deterministic, offline {@link BillingGateway} that simulates the
 * `trialing → active → past_due → canceled` lifecycle and emits synthetic webhook
 * events from the {@link BILLING_LIFECYCLE} fixture. No wall-clock time and no
 * randomness: it anchors to an injectable `now` (defaulting to {@link FIXED_NOW}) and
 * derives all ids from inputs + a per-gateway counter, so tests are stable.
 */
import type {
  AppliedSubscriptionDiscount,
  BillingCustomer,
  BillingEventType,
  BillingEvent,
  BillingGateway,
  BillingPortalSessionInput,
  BillingPortalSessionResult,
  CheckoutSessionInput,
  CheckoutSessionResult,
  CreditNoteIssueInput,
  CreditNotePreview,
  CreditNotePreviewInput,
  DiscountCoupon,
  DiscountCouponInput,
  IssuedCreditNote,
  RecurringInvoiceLine,
  Subscription,
  SubscriptionDiscountInput,
  SubscriptionStatus,
} from '../contracts';

const FIXED_NOW = '2026-01-01T00:00:00.000Z';

interface BillingLifecycleStep {
  readonly event: BillingEventType;
  readonly status: SubscriptionStatus;
  readonly periodEndOffsetHours: number;
}

const BILLING_LIFECYCLE: readonly BillingLifecycleStep[] = [
  { event: 'subscription.created', status: 'trialing', periodEndOffsetHours: 24 * 14 },
  { event: 'subscription.updated', status: 'active', periodEndOffsetHours: 24 * 30 },
  { event: 'subscription.past_due', status: 'past_due', periodEndOffsetHours: 24 * 3 },
  { event: 'subscription.canceled', status: 'canceled', periodEndOffsetHours: 0 },
];

/** Construction options for {@link InMemoryBillingGateway}. */
export interface InMemoryBillingGatewayOptions {
  /** Fixed ISO-8601 "now" the gateway derives period ends from. */
  readonly now?: string;
  /** Base URL synthetic checkout/portal links are rooted at. */
  readonly baseUrl?: string;
}

/** Add `hours` to an ISO-8601 timestamp and return a new ISO-8601 string. */
function addHours(iso: string, hours: number): string {
  return new Date(new Date(iso).getTime() + hours * 3_600_000).toISOString();
}

/**
 * A deterministic, in-memory billing gateway for local/test runs.
 *
 * @remarks
 * `advance()` steps the subscription through the lifecycle and records the synthetic
 * webhook event; `events` exposes the emitted sequence for assertions. Checkout
 * "completing" creates the subscription in `trialing`.
 */
export class InMemoryBillingGateway implements BillingGateway {
  private readonly now: string;
  private readonly baseUrl: string;
  private readonly subscriptions = new Map<string, Subscription>();
  private readonly lifecycleStep = new Map<string, number>();
  private readonly coupons = new Map<string, DiscountCouponInput>();
  private readonly discounts = new Map<string, { discountId: string; couponId: string }>();
  private counter = 0;
  /** The synthetic webhook events emitted so far, in order. */
  readonly events: BillingEvent[] = [];

  /**
   * @param options - Optional fixed `now` and base URL for synthetic links.
   */
  constructor(options: InMemoryBillingGatewayOptions = {}) {
    this.now = options.now ?? FIXED_NOW;
    this.baseUrl = options.baseUrl ?? 'https://billing.mock.docket.local';
  }

  private nextId(prefix: string): string {
    this.counter += 1;
    return `${prefix}_${this.counter.toString().padStart(6, '0')}`;
  }

  /** {@inheritDoc BillingGateway.createCustomer} */
  async createCustomer(referenceId: string): Promise<BillingCustomer> {
    return { id: `cus_${referenceId}`, referenceId };
  }

  /** {@inheritDoc BillingGateway.getCustomerBillingCountry} */
  async getCustomerBillingCountry(_customerId: string): Promise<string | null> {
    return 'US';
  }

  /** {@inheritDoc BillingGateway.createCheckoutSession} */
  async createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSessionResult> {
    const sessionId = this.nextId('cs');
    // Simulate the customer completing checkout. A zero-day trial is an immediate paid start.
    const trialDays = input.trialDays ?? 14;
    const hasTrial = trialDays > 0;
    const checkoutDiscountId = input.couponId ? this.nextId('di') : null;
    const sub: Subscription = {
      id: this.nextId('sub'),
      ...(input.customerId ? { customerId: input.customerId } : {}),
      referenceId: input.referenceId,
      status: hasTrial ? 'trialing' : 'active',
      currentPeriodEnd: addHours(this.now, (hasTrial ? trialDays : 30) * 24),
      ...(hasTrial ? { trialEnd: addHours(this.now, trialDays * 24) } : {}),
      ...(checkoutDiscountId ? { discountIds: [checkoutDiscountId] } : {}),
      ...(input.couponId ? { couponIds: [input.couponId] } : {}),
    };
    if (checkoutDiscountId && input.couponId) {
      this.discounts.set(input.referenceId, {
        discountId: checkoutDiscountId,
        couponId: input.couponId,
      });
    }
    this.subscriptions.set(input.referenceId, sub);
    this.lifecycleStep.set(input.referenceId, hasTrial ? 0 : 1);
    this.events.push({
      id: this.nextId('evt'),
      type: 'checkout.completed',
      referenceId: input.referenceId,
      subscription: sub,
      createdAt: this.now,
    });
    return { url: `${this.baseUrl}/checkout/${sessionId}`, sessionId };
  }

  /** {@inheritDoc BillingGateway.getSubscription} */
  async getSubscription(referenceId: string): Promise<Subscription | null> {
    return this.subscriptions.get(referenceId) ?? null;
  }

  /** {@inheritDoc BillingGateway.listSubscriptions} */
  async listSubscriptions(referenceId: string): Promise<readonly Subscription[]> {
    const subscription = this.subscriptions.get(referenceId);
    return subscription ? [subscription] : [];
  }

  /** {@inheritDoc BillingGateway.cancelSubscription} */
  async cancelSubscription(referenceId: string): Promise<void> {
    const sub = this.subscriptions.get(referenceId);
    if (!sub) return;
    const canceled: Subscription = {
      id: sub.id,
      referenceId,
      status: 'canceled',
      currentPeriodEnd: this.now,
    };
    this.subscriptions.set(referenceId, canceled);
    this.events.push({
      id: this.nextId('evt'),
      type: 'subscription.canceled',
      referenceId,
      subscription: canceled,
      createdAt: this.now,
    });
  }

  /** {@inheritDoc BillingGateway.cancelSubscriptionById} */
  async cancelSubscriptionById(subscriptionId: string, _idempotencyKey: string): Promise<void> {
    const entry = [...this.subscriptions.entries()].find(
      ([, subscription]) => subscription.id === subscriptionId,
    );
    if (!entry) throw new Error('InMemoryBillingGateway: subscription not found.');
    await this.cancelSubscription(entry[0]);
  }

  /** {@inheritDoc BillingGateway.extendTrial} */
  async extendTrial(
    referenceId: string,
    days: number,
    _idempotencyKey: string,
  ): Promise<Subscription> {
    const sub = this.subscriptions.get(referenceId);
    if (sub?.status !== 'trialing' || !sub.trialEnd) {
      throw new Error('InMemoryBillingGateway: no eligible trialing subscription.');
    }
    const trialEnd = addHours(sub.trialEnd, days * 24);
    const extended: Subscription = { ...sub, currentPeriodEnd: trialEnd, trialEnd };
    this.subscriptions.set(referenceId, extended);
    this.events.push({
      id: this.nextId('evt'),
      type: 'subscription.updated',
      referenceId,
      subscription: extended,
      createdAt: this.now,
    });
    return extended;
  }

  /** {@inheritDoc BillingGateway.createBillingPortalSession} */
  async createBillingPortalSession(
    input: BillingPortalSessionInput,
  ): Promise<BillingPortalSessionResult> {
    return { url: `${this.baseUrl}/portal/${input.customerId}` };
  }

  /** {@inheritDoc BillingGateway.createDiscountCoupon} */
  async createDiscountCoupon(input: DiscountCouponInput): Promise<DiscountCoupon> {
    const id = `coupon_${input.awardId}`;
    this.coupons.set(id, input);
    return { id };
  }

  /** {@inheritDoc BillingGateway.applySubscriptionDiscount} */
  async applySubscriptionDiscount(
    input: SubscriptionDiscountInput,
  ): Promise<AppliedSubscriptionDiscount> {
    if (!this.subscriptions.has(input.referenceId)) {
      throw new Error('InMemoryBillingGateway: no subscription for discount.');
    }
    if (!this.coupons.has(input.couponId)) {
      throw new Error('InMemoryBillingGateway: unknown coupon.');
    }
    const discountId = this.nextId('di');
    this.discounts.set(input.referenceId, { discountId, couponId: input.couponId });
    const subscription = this.subscriptions.get(input.referenceId);
    if (subscription) {
      this.subscriptions.set(input.referenceId, {
        ...subscription,
        discountIds: [discountId],
        couponIds: [input.couponId],
      });
    }
    return { discountId };
  }

  /** {@inheritDoc BillingGateway.removeSubscriptionDiscount} */
  async removeSubscriptionDiscount(referenceId: string, _idempotencyKey: string): Promise<void> {
    this.discounts.delete(referenceId);
    const subscription = this.subscriptions.get(referenceId);
    if (subscription) {
      const { discountIds: _discountIds, couponIds: _couponIds, ...withoutDiscount } = subscription;
      this.subscriptions.set(referenceId, withoutDiscount);
    }
  }

  /** {@inheritDoc BillingGateway.getLatestRecurringInvoice} */
  async getLatestRecurringInvoice(referenceId: string): Promise<RecurringInvoiceLine | null> {
    const subscription = this.subscriptions.get(referenceId);
    if (!subscription || subscription.status === 'trialing') return null;
    const periodEnd = new Date(subscription.currentPeriodEnd);
    const periodStart = new Date(periodEnd.getTime() - 30 * 24 * 60 * 60 * 1000);
    return {
      invoiceId: `in_${referenceId}`,
      lineId: `il_${referenceId}`,
      invoiceStatus: 'paid',
      currency: 'usd',
      recurringAmount: 800,
      periodStartsAt: periodStart.toISOString(),
      periodEndsAt: periodEnd.toISOString(),
    };
  }

  /** {@inheritDoc BillingGateway.previewCreditNote} */
  async previewCreditNote(input: CreditNotePreviewInput): Promise<CreditNotePreview> {
    return {
      baseAmount: input.baseAmount,
      taxAmount: 0,
      totalAmount: input.baseAmount,
      prePaymentAmount: 0,
      postPaymentAmount: input.baseAmount,
    };
  }

  /** {@inheritDoc BillingGateway.issueCreditNote} */
  async issueCreditNote(input: CreditNoteIssueInput): Promise<IssuedCreditNote> {
    const preview = await this.previewCreditNote(input);
    return { id: this.nextId('cn'), ...preview };
  }

  /**
   * Advance a scope's subscription one step along the synthetic lifecycle, emitting
   * the corresponding webhook event.
   *
   * @param referenceId - The Docket scope to advance.
   * @returns the emitted event, or `null` when the lifecycle is exhausted.
   */
  advance(referenceId: string): BillingEvent | null {
    const idx = this.lifecycleStep.get(referenceId) ?? 0;
    if (idx >= BILLING_LIFECYCLE.length) return null;
    const step = BILLING_LIFECYCLE[idx];
    /* v8 ignore start -- unreachable: the bounds check above guarantees a defined step; this only narrows noUncheckedIndexedAccess. */
    if (!step) return null;
    /* v8 ignore stop */
    const existing = this.subscriptions.get(referenceId);
    const sub: Subscription = {
      id: existing?.id ?? this.nextId('sub'),
      referenceId,
      status: step.status,
      currentPeriodEnd: addHours(this.now, step.periodEndOffsetHours),
      ...(step.status === 'trialing'
        ? { trialEnd: addHours(this.now, step.periodEndOffsetHours) }
        : {}),
    };
    this.subscriptions.set(referenceId, sub);
    this.lifecycleStep.set(referenceId, idx + 1);
    const event: BillingEvent = {
      id: this.nextId('evt'),
      type: step.event,
      referenceId,
      subscription: sub,
      createdAt: this.now,
    };
    this.events.push(event);
    return event;
  }
}
