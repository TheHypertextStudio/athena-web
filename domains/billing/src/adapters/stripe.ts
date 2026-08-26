/**
 * `@docket/billing/adapters/stripe` - `RealStripeGateway`.
 *
 * @remarks
 * The env-driven {@link BillingGateway} that talks to Stripe through the official
 * `stripe` SDK. Selected only when `STRIPE_SECRET_KEY` is present and real-shaped by
 * the API container and never in `APP_MODE ∈ {local,test}`. All values come from
 * validated env; the network edge runs through the SDK's `fetch` HTTP client, which is
 * fed the injectable {@link HttpClient} so the only non-deterministic part — live
 * Stripe I/O — is swappable at the composition root.
 *
 * Pure logic (config parsing, price-key resolution, Stripe→port mapping, and webhook
 * event mapping) lives in `billing-mappers.ts` and is unit-tested. The lines that can
 * only run against live Stripe (the SDK calls and signature verification) are marked
 * with v8-ignore.
 */
import Stripe from 'stripe';

import type {
  AppliedSubscriptionDiscount,
  BillingEvent,
  BillingCustomer,
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
} from '../contracts';
import { defaultHttpClient, type HttpClient } from './http';
import {
  buildBaseCheckoutParams,
  mapStripeEvent,
  parseApiBase,
  type StripeEventView,
  toSubscription,
} from './stripe-mappers';

export {
  mapEventType,
  mapStripeEvent,
  parseApiBase,
  toStatus,
  toSubscription,
} from './stripe-mappers';

/**
 * The default free-trial length, in days.
 *
 * @remarks
 * Docket's policy trial (`plan.freeTrial.days: 14` in the engineering plan). Applied to
 * checkout via Stripe's supported `subscription_data.trial_period_days`.
 */
export const DEFAULT_TRIAL_DAYS = 14;

/**
 * The Stripe API version Docket pins.
 *
 * @remarks
 * Matches the engineering plan (`stripe@^22`, API version `2026-03-25.dahlia`).
 */
export const STRIPE_API_VERSION = '2026-03-25.dahlia';

/** Validated configuration for {@link RealStripeGateway} (sourced from env). */
export interface RealStripeGatewayConfig {
  /** Stripe secret key (`sk_...`). Never logged. */
  readonly secretKey: string;
  /** Stripe webhook signing secret (`whsec_...`). */
  readonly webhookSecret?: string | undefined;
  /** Default price the checkout subscribes to when the caller supplies none. */
  readonly priceKey?: string | undefined;
  /** Stripe billing-portal configuration id (`bpc_...`). */
  readonly portalConfigId?: string | undefined;
  /** Free-trial length in days; defaults to {@link DEFAULT_TRIAL_DAYS}. */
  readonly trialDays?: number | undefined;
  /** API host override for testing against `stripe-mock` (e.g. `http://localhost:12111`). */
  readonly apiBase?: string | undefined;
  /** API version override; defaults to {@link STRIPE_API_VERSION}. */
  readonly apiVersion?: string | undefined;
}

/** The result of opening an embedded Checkout session (for the embedded Stripe.js UI). */
export interface EmbeddedCheckoutSessionResult {
  /** The session `client_secret` the embedded Checkout component mounts with. */
  readonly clientSecret: string;
  /** Provider checkout session id (echoed back by webhooks). */
  readonly sessionId: string;
}

/**
 * A real, env-driven Stripe billing gateway built on the official `stripe` SDK.
 *
 * @remarks
 * Implements the {@link BillingGateway} port (embedded checkout, subscription read,
 * cancellation, billing portal) and adds two non-port surfaces the integrator wires in
 * `apps/api`: {@link RealStripeGateway.createEmbeddedCheckoutSession} and
 * {@link RealStripeGateway.verifyWebhook}.
 */
export class RealStripeGateway implements BillingGateway {
  private readonly config: RealStripeGatewayConfig;
  private readonly stripe: Stripe;

  constructor(config: RealStripeGatewayConfig, http: HttpClient = defaultHttpClient) {
    this.config = config;
    const base = parseApiBase(config.apiBase);
    // Stripe's fetch-backed HTTP client only ever invokes `toUrl` with a string URL; the
    // URL/Request shapes only satisfy the wider `Parameters<typeof fetch>[0]` type and are
    // unreachable through the SDK, so the whole shape dispatch is an SDK-boundary default
    // verified by really calling Stripe, not a mock-wiring test (same rationale as the
    // `/* v8 ignore start */` block below).
    /* v8 ignore start */
    const toUrl = (input: Parameters<typeof fetch>[0]): string => {
      if (typeof input === 'string') return input;
      if (input instanceof URL) return input.href;
      return input.url;
    };
    /* v8 ignore stop */
    const fetchFn: typeof fetch = (input, init) => http(toUrl(input), init ?? undefined);
    /* v8 ignore start */
    type StripeOptions = NonNullable<ConstructorParameters<typeof Stripe>[1]>;
    const apiVersion = (config.apiVersion ?? STRIPE_API_VERSION) as NonNullable<
      StripeOptions['apiVersion']
    >;
    const options: StripeOptions = {
      apiVersion,
      httpClient: Stripe.createFetchHttpClient(fetchFn),
      ...base,
    };
    this.stripe = new Stripe(config.secretKey, options);
    /* v8 ignore stop */
  }

  private get trialDays(): number {
    return this.config.trialDays ?? DEFAULT_TRIAL_DAYS;
  }

  /** {@inheritDoc BillingGateway.createCustomer} */
  async createCustomer(referenceId: string, email?: string): Promise<BillingCustomer> {
    /* v8 ignore start */
    let customer: Stripe.Customer;
    try {
      customer = await this.stripe.customers.create(
        {
          ...(email ? { email } : {}),
          metadata: { referenceId },
        },
        { idempotencyKey: `docket:customer:${referenceId}` },
      );
    } catch (cause) {
      throw new Error('RealStripeGateway: failed to create customer.', { cause });
    }
    return { id: customer.id, referenceId };
    /* v8 ignore stop */
  }

  /** {@inheritDoc BillingGateway.listCustomers} */
  async listCustomers(referenceId: string): Promise<readonly BillingCustomer[]> {
    /* v8 ignore start */
    let result: Stripe.ApiSearchResult<Stripe.Customer>;
    try {
      result = await this.stripe.customers.search({
        query: `metadata['referenceId']:'${referenceId}'`,
        limit: 100,
      });
    } catch (cause) {
      throw new Error('RealStripeGateway: failed to list organization customers.', { cause });
    }
    return result.data.map((customer) => ({ id: customer.id, referenceId }));
    /* v8 ignore stop */
  }

  /** {@inheritDoc BillingGateway.getCustomerBillingCountry} */
  async getCustomerBillingCountry(customerId: string): Promise<string | null> {
    /* v8 ignore start */
    let customer: Stripe.Customer | Stripe.DeletedCustomer;
    try {
      customer = await this.stripe.customers.retrieve(customerId);
    } catch (cause) {
      throw new Error('RealStripeGateway: failed to read customer billing country.', { cause });
    }
    return 'deleted' in customer ? null : (customer.address?.country ?? null);
    /* v8 ignore stop */
  }

  private async resolvePrice(priceRef: string): Promise<string> {
    if (priceRef.startsWith('price_')) return priceRef;
    /* v8 ignore start */
    let list: Stripe.ApiList<Stripe.Price>;
    try {
      list = await this.stripe.prices.list({ lookup_keys: [priceRef], active: true, limit: 1 });
    } catch (cause) {
      throw new Error(`RealStripeGateway: failed to resolve price lookup key.`, { cause });
    }
    const price = list.data[0];
    if (!price) {
      throw new Error('RealStripeGateway: no active price for the configured lookup key.');
    }
    return price.id;
    /* v8 ignore stop */
  }

  /** {@inheritDoc BillingGateway.createCheckoutSession} */
  async createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSessionResult> {
    const priceRef = input.priceKey || this.config.priceKey;
    if (!priceRef) throw new Error('RealStripeGateway: no price key configured for checkout.');
    const price = await this.resolvePrice(priceRef);
    const params: Stripe.Checkout.SessionCreateParams = {
      ...buildBaseCheckoutParams(input, price, this.trialDays),
      ui_mode: 'hosted_page',
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
    };
    /* v8 ignore start */
    let session: Stripe.Checkout.Session;
    try {
      session = await this.stripe.checkout.sessions.create(
        params,
        input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : undefined,
      );
    } catch (cause) {
      throw new Error('RealStripeGateway: failed to create checkout session.', { cause });
    }
    if (!session.url) {
      throw new Error('RealStripeGateway: Stripe returned a checkout session without a URL.');
    }
    return { url: session.url, sessionId: session.id };
    /* v8 ignore stop */
  }

  /** Open an **embedded** Checkout session for the embedded Stripe.js UI. */
  async createEmbeddedCheckoutSession(
    input: CheckoutSessionInput,
  ): Promise<EmbeddedCheckoutSessionResult> {
    const priceRef = input.priceKey || this.config.priceKey;
    if (!priceRef) throw new Error('RealStripeGateway: no price key configured for checkout.');
    const price = await this.resolvePrice(priceRef);
    const params: Stripe.Checkout.SessionCreateParams = {
      ...buildBaseCheckoutParams(input, price, this.trialDays),
      ui_mode: 'embedded_page',
      return_url: input.successUrl,
    };
    /* v8 ignore start */
    let session: Stripe.Checkout.Session;
    try {
      session = await this.stripe.checkout.sessions.create(
        params,
        input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : undefined,
      );
    } catch (cause) {
      throw new Error('RealStripeGateway: failed to create embedded checkout session.', { cause });
    }
    if (!session.client_secret) {
      throw new Error('RealStripeGateway: embedded checkout session has no client secret.');
    }
    return { clientSecret: session.client_secret, sessionId: session.id };
    /* v8 ignore stop */
  }

  private async findSubscription(referenceId: string): Promise<Stripe.Subscription | null> {
    /* v8 ignore start */
    let result: Stripe.ApiSearchResult<Stripe.Subscription>;
    try {
      result = await this.stripe.subscriptions.search({
        query: `metadata['referenceId']:'${referenceId}'`,
        limit: 1,
        expand: ['data.items', 'data.discounts'],
      });
    } catch (cause) {
      throw new Error('RealStripeGateway: failed to look up subscription.', { cause });
    }
    return result.data[0] ?? null;
    /* v8 ignore stop */
  }

  /** {@inheritDoc BillingGateway.getSubscription} */
  async getSubscription(referenceId: string): Promise<Subscription | null> {
    const sub = await this.findSubscription(referenceId);
    if (!sub) return null;
    return toSubscription(sub, referenceId);
  }

  /** {@inheritDoc BillingGateway.getSubscriptionById} */
  async getSubscriptionById(
    subscriptionId: string,
    referenceId: string,
  ): Promise<Subscription | null> {
    /* v8 ignore start */
    let subscription: Stripe.Subscription;
    try {
      subscription = await this.stripe.subscriptions.retrieve(subscriptionId, {
        expand: ['items', 'discounts'],
      });
    } catch (cause) {
      const status =
        typeof cause === 'object' && cause !== null && 'statusCode' in cause
          ? (cause as { statusCode?: unknown }).statusCode
          : null;
      if (status === 404) return null;
      throw new Error('RealStripeGateway: failed to retrieve the exact subscription.', { cause });
    }
    const mapped = toSubscription(subscription, referenceId);
    if (mapped.referenceId !== referenceId) {
      throw new Error('RealStripeGateway: exact subscription belongs to another organization.');
    }
    return mapped;
    /* v8 ignore stop */
  }

  /** {@inheritDoc BillingGateway.listSubscriptions} */
  async listSubscriptions(referenceId: string): Promise<readonly Subscription[]> {
    /* v8 ignore start */
    let result: Stripe.ApiSearchResult<Stripe.Subscription>;
    try {
      result = await this.stripe.subscriptions.search({
        query: `metadata['referenceId']:'${referenceId}'`,
        limit: 10,
        expand: ['data.items', 'data.discounts'],
      });
    } catch (cause) {
      throw new Error('RealStripeGateway: failed to list organization subscriptions.', { cause });
    }
    return result.data.map((subscription) => toSubscription(subscription, referenceId));
    /* v8 ignore stop */
  }

  /** {@inheritDoc BillingGateway.cancelSubscription} */
  async cancelSubscription(referenceId: string): Promise<void> {
    const sub = await this.findSubscription(referenceId);
    if (!sub) return;
    /* v8 ignore start */
    try {
      await this.stripe.subscriptions.cancel(sub.id);
    } catch (cause) {
      throw new Error('RealStripeGateway: failed to cancel subscription.', { cause });
    }
    /* v8 ignore stop */
  }

  /** {@inheritDoc BillingGateway.cancelSubscriptionById} */
  async cancelSubscriptionById(
    subscriptionId: string,
    referenceId: string,
    idempotencyKey: string,
    atPeriodEnd = false,
  ): Promise<Subscription> {
    /* v8 ignore start */
    let updated: Stripe.Subscription;
    try {
      if (atPeriodEnd) {
        updated = await this.stripe.subscriptions.update(
          subscriptionId,
          { cancel_at_period_end: true },
          { idempotencyKey },
        );
      } else {
        updated = await this.stripe.subscriptions.cancel(subscriptionId, {}, { idempotencyKey });
      }
    } catch (cause) {
      throw new Error('RealStripeGateway: failed to cancel the exact subscription.', { cause });
    }
    const mapped = toSubscription(updated, referenceId);
    if (mapped.referenceId !== referenceId) {
      throw new Error('RealStripeGateway: exact subscription belongs to another organization.');
    }
    return mapped;
    /* v8 ignore stop */
  }

  /** {@inheritDoc BillingGateway.extendTrial} */
  async extendTrial(
    referenceId: string,
    days: number,
    idempotencyKey: string,
  ): Promise<Subscription> {
    const sub = await this.findSubscription(referenceId);
    if (sub?.status !== 'trialing' || sub.trial_end === null) {
      throw new Error('RealStripeGateway: no eligible trialing subscription.');
    }
    const nextTrialEnd = sub.trial_end + days * 24 * 60 * 60;
    /* v8 ignore start */
    let updated: Stripe.Subscription;
    try {
      updated = await this.stripe.subscriptions.update(
        sub.id,
        { trial_end: nextTrialEnd, proration_behavior: 'none' },
        { idempotencyKey },
      );
    } catch (cause) {
      throw new Error('RealStripeGateway: failed to extend trial.', { cause });
    }
    return toSubscription(updated, referenceId);
    /* v8 ignore stop */
  }

  /** {@inheritDoc BillingGateway.createBillingPortalSession} */
  async createBillingPortalSession(
    input: BillingPortalSessionInput,
  ): Promise<BillingPortalSessionResult> {
    /* v8 ignore start */
    let session: Stripe.BillingPortal.Session;
    try {
      session = await this.stripe.billingPortal.sessions.create({
        customer: input.customerId,
        return_url: input.returnUrl,
        ...(this.config.portalConfigId ? { configuration: this.config.portalConfigId } : {}),
      });
    } catch (cause) {
      throw new Error('RealStripeGateway: failed to open billing portal session.', { cause });
    }
    return { url: session.url };
    /* v8 ignore stop */
  }

  /** Resolve the Stripe product attached to one configured Docket Pro price. */
  private async resolveProduct(priceRef: string): Promise<string> {
    /* v8 ignore start */
    let price: Stripe.Price;
    try {
      if (priceRef.startsWith('price_')) {
        price = await this.stripe.prices.retrieve(priceRef);
      } else {
        const prices = await this.stripe.prices.list({
          lookup_keys: [priceRef],
          active: true,
          limit: 1,
        });
        const matched = prices.data[0];
        if (!matched) {
          throw new Error('No active price matched the configured lookup key.');
        }
        price = matched;
      }
    } catch (cause) {
      throw new Error('RealStripeGateway: failed to resolve the Docket Pro product.', { cause });
    }
    return typeof price.product === 'string' ? price.product : price.product.id;
    /* v8 ignore stop */
  }

  /** {@inheritDoc BillingGateway.createDiscountCoupon} */
  async createDiscountCoupon(input: DiscountCouponInput): Promise<DiscountCoupon> {
    const productId = await this.resolveProduct(input.priceKey);
    /* v8 ignore start */
    let coupon: Stripe.Coupon;
    try {
      coupon = await this.stripe.coupons.create(
        {
          name: input.name,
          percent_off: input.percentOff,
          // Docket owns the exact award boundary. A repeating Stripe coupon starts its clock when
          // attached and can consume part of its term during a trial, which would shortchange the
          // customer. Reconciliation removes this forever coupon at the first renewal after the
          // local award end.
          duration: 'forever',
          applies_to: { products: [productId] },
          metadata: { awardId: input.awardId },
        },
        { idempotencyKey: input.idempotencyKey },
      );
    } catch (cause) {
      throw new Error('RealStripeGateway: failed to create discount coupon.', { cause });
    }
    return { id: coupon.id };
    /* v8 ignore stop */
  }

  /** {@inheritDoc BillingGateway.applySubscriptionDiscount} */
  async applySubscriptionDiscount(
    input: SubscriptionDiscountInput,
  ): Promise<AppliedSubscriptionDiscount> {
    const subscription = await this.findSubscription(input.referenceId);
    if (!subscription) throw new Error('RealStripeGateway: no subscription for discount.');
    /* v8 ignore start */
    let updated: Stripe.Subscription;
    try {
      updated = await this.stripe.subscriptions.update(
        subscription.id,
        { discounts: [{ coupon: input.couponId }], proration_behavior: 'none' },
        { idempotencyKey: input.idempotencyKey },
      );
    } catch (cause) {
      throw new Error('RealStripeGateway: failed to apply subscription discount.', { cause });
    }
    const discount = updated.discounts[0];
    return {
      discountId: typeof discount === 'string' ? discount : (discount?.id ?? null),
    };
    /* v8 ignore stop */
  }

  /** {@inheritDoc BillingGateway.removeSubscriptionDiscount} */
  async removeSubscriptionDiscount(referenceId: string, idempotencyKey: string): Promise<void> {
    const subscription = await this.findSubscription(referenceId);
    if (!subscription) return;
    /* v8 ignore start */
    try {
      await this.stripe.subscriptions.deleteDiscount(subscription.id, {}, { idempotencyKey });
    } catch (cause) {
      throw new Error('RealStripeGateway: failed to remove subscription discount.', { cause });
    }
    /* v8 ignore stop */
  }

  /** {@inheritDoc BillingGateway.getLatestRecurringInvoice} */
  async getLatestRecurringInvoice(referenceId: string): Promise<RecurringInvoiceLine | null> {
    const subscription = await this.findSubscription(referenceId);
    if (!subscription) return null;
    const priceRef = this.config.priceKey;
    if (!priceRef) {
      throw new Error('RealStripeGateway: no Docket Pro price configured for invoice matching.');
    }
    const priceId = await this.resolvePrice(priceRef);
    /* v8 ignore start */
    let invoices: Stripe.ApiList<Stripe.Invoice>;
    try {
      invoices = await this.stripe.invoices.list({
        subscription: subscription.id,
        limit: 10,
        expand: ['data.lines'],
      });
    } catch (cause) {
      throw new Error('RealStripeGateway: failed to read subscription invoices.', { cause });
    }
    for (const invoice of invoices.data) {
      if (invoice.status !== 'open' && invoice.status !== 'paid') continue;
      const line = invoice.lines.data.find((candidate) => {
        const view = candidate as typeof candidate & {
          price?: { id?: string } | null;
          pricing?: { price_details?: { price?: string } | null } | null;
          parent?: {
            type?: string;
            subscription_item_details?: { proration?: boolean } | null;
          } | null;
        };
        const linePriceId = view.pricing?.price_details?.price ?? view.price?.id;
        return (
          candidate.amount > 0 &&
          linePriceId === priceId &&
          view.parent?.type === 'subscription_item_details' &&
          view.parent.subscription_item_details?.proration === false
        );
      });
      if (!line) continue;
      return {
        invoiceId: invoice.id,
        lineId: line.id,
        invoiceStatus: invoice.status,
        currency: invoice.currency,
        recurringAmount: line.amount,
        periodStartsAt: new Date(line.period.start * 1000).toISOString(),
        periodEndsAt: new Date(line.period.end * 1000).toISOString(),
      };
    }
    return null;
    /* v8 ignore stop */
  }

  /** Map a Stripe credit note into the provider-neutral audited values. */
  private creditNoteValues(creditNote: Stripe.CreditNote, baseAmount: number): CreditNotePreview {
    return {
      baseAmount,
      taxAmount: creditNote.total - creditNote.subtotal,
      totalAmount: creditNote.total,
      prePaymentAmount: creditNote.pre_payment_amount,
      postPaymentAmount: creditNote.post_payment_amount,
    };
  }

  /** Build the line-specific params shared by preview and issuance. */
  private creditNoteParams(input: CreditNotePreviewInput): Stripe.CreditNotePreviewParams {
    return {
      invoice: input.invoiceId,
      lines: [
        {
          type: 'invoice_line_item',
          invoice_line_item: input.invoiceLineId,
          amount: input.baseAmount,
        },
      ],
    };
  }

  /** {@inheritDoc BillingGateway.previewCreditNote} */
  async previewCreditNote(input: CreditNotePreviewInput): Promise<CreditNotePreview> {
    /* v8 ignore start */
    let preview: Stripe.CreditNote;
    try {
      preview = await this.stripe.creditNotes.preview(this.creditNoteParams(input));
    } catch (cause) {
      throw new Error('RealStripeGateway: failed to preview credit note.', { cause });
    }
    return this.creditNoteValues(preview, input.baseAmount);
    /* v8 ignore stop */
  }

  /** {@inheritDoc BillingGateway.issueCreditNote} */
  async issueCreditNote(input: CreditNoteIssueInput): Promise<IssuedCreditNote> {
    /* v8 ignore start */
    let creditNote: Stripe.CreditNote;
    try {
      creditNote = await this.stripe.creditNotes.create(
        {
          ...this.creditNoteParams(input),
          memo: input.memo,
          reason: 'order_change',
          ...(input.creditAmount > 0 ? { credit_amount: input.creditAmount } : {}),
        },
        { idempotencyKey: input.idempotencyKey },
      );
    } catch (cause) {
      throw new Error('RealStripeGateway: failed to issue credit note.', { cause });
    }
    return { id: creditNote.id, ...this.creditNoteValues(creditNote, input.baseAmount) };
    /* v8 ignore stop */
  }

  /** Thin instance wrapper over the pure {@link mapStripeEvent} function. */
  mapStripeEvent(event: StripeEventView): BillingEvent | null {
    return mapStripeEvent(event);
  }

  /**
   * Verify a Stripe webhook signature and normalize the payload to a {@link BillingEvent}.
   *
   * @param rawBody - The raw, unparsed request body.
   * @param signature - The `Stripe-Signature` request header.
   * @throws {Error} When no webhook secret is configured or the signature is invalid.
   */
  async verifyWebhook(rawBody: string | Buffer, signature: string): Promise<BillingEvent | null> {
    if (!this.config.webhookSecret) {
      throw new Error('RealStripeGateway: no STRIPE_WEBHOOK_SECRET configured for webhooks.');
    }
    /* v8 ignore start */
    let event: Stripe.Event;
    try {
      event = await this.stripe.webhooks.constructEventAsync(
        rawBody,
        signature,
        this.config.webhookSecret,
        undefined,
        Stripe.createSubtleCryptoProvider(),
      );
    } catch (cause) {
      throw new Error('RealStripeGateway: webhook signature verification failed.', { cause });
    }
    return this.mapStripeEvent(event);
    /* v8 ignore stop */
  }
}
