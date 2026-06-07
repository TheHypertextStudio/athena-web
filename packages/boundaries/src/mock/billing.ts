/**
 * `@docket/boundaries/mock` — `InMemoryBillingGateway`.
 *
 * @remarks
 * A deterministic, offline {@link BillingGateway} that simulates the
 * `trialing → active → past_due → canceled` lifecycle and emits synthetic webhook
 * events from the {@link BILLING_LIFECYCLE} fixture. No wall-clock time and no
 * randomness: it anchors to an injectable `now` (defaulting to {@link FIXED_NOW}) and
 * derives all ids from inputs + a per-gateway counter, so tests are stable.
 */
import { BILLING_LIFECYCLE, FIXED_NOW } from '../fixtures';
import type {
  BillingEvent,
  BillingGateway,
  BillingPortalSessionResult,
  CheckoutSessionInput,
  CheckoutSessionResult,
  Subscription,
} from '../ports/billing';

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

  /** {@inheritDoc BillingGateway.createCheckoutSession} */
  async createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSessionResult> {
    const sessionId = this.nextId('cs');
    // Simulate the customer completing checkout: create a trialing subscription.
    const trialDays = input.trialDays ?? 14;
    const sub: Subscription = {
      id: this.nextId('sub'),
      referenceId: input.referenceId,
      status: 'trialing',
      currentPeriodEnd: addHours(this.now, trialDays * 24),
      trialEnd: addHours(this.now, trialDays * 24),
    };
    this.subscriptions.set(input.referenceId, sub);
    this.lifecycleStep.set(input.referenceId, 0);
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

  /** {@inheritDoc BillingGateway.createBillingPortalSession} */
  async createBillingPortalSession(referenceId: string): Promise<BillingPortalSessionResult> {
    return { url: `${this.baseUrl}/portal/${referenceId}` };
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
