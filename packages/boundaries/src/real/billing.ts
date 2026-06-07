/**
 * `@docket/boundaries/real` — `RealStripeGateway`.
 *
 * @remarks
 * The env-driven {@link BillingGateway} that talks to Stripe through the official
 * `stripe` SDK. Selected only when `STRIPE_SECRET_KEY` is present and real-shaped (see
 * {@link selectAdapter}) and never in `APP_MODE ∈ {local,test}`. All values come from
 * validated env; the network edge runs through the SDK's `fetch` HTTP client, which is
 * fed the injectable {@link HttpClient} so the only non-deterministic part — live
 * Stripe I/O — is swappable at the composition root (`boundaries.md` §3).
 *
 * Docket bills the **Organization** (`referenceId = organization.id`): the org's
 * `referenceId` is stamped onto the Stripe subscription's `metadata` at checkout, so
 * {@link RealStripeGateway.getSubscription} can locate it again by metadata. The 14-day
 * free trial uses Stripe's supported `trial_period_days` mechanism (`plan.freeTrial.days`
 * in the engineering plan). The default checkout flow is **embedded Checkout**
 * (`ui_mode: 'embedded_page'`); the hosted-redirect variant is available too.
 *
 * Pure logic here — config parsing, price-key resolution, Stripe→port mapping, and
 * webhook event mapping — is unit-tested. The lines that can only run against live
 * Stripe (the SDK calls and signature verification) are marked with v8-ignore, like the
 * DB driver, rather than chased with mock-wiring tests.
 */
import Stripe from 'stripe';

import type {
  BillingEvent,
  BillingEventType,
  BillingGateway,
  BillingPortalSessionResult,
  CheckoutSessionInput,
  CheckoutSessionResult,
  Subscription,
  SubscriptionStatus,
} from '../ports/billing';
import { defaultHttpClient, type HttpClient } from './http';

/**
 * The default free-trial length, in days.
 *
 * @remarks
 * Docket's policy trial (`plan.freeTrial.days: 14` in the engineering plan). Applied to
 * checkout via Stripe's supported `subscription_data.trial_period_days` when the caller
 * does not override {@link CheckoutSessionInput.trialDays}.
 */
export const DEFAULT_TRIAL_DAYS = 14;

/**
 * The Stripe API version Docket pins.
 *
 * @remarks
 * Matches the engineering plan (`stripe@^22`, API version `2026-03-25.dahlia`). Typed as
 * a plain string by the SDK's config, so the pin is explicit and stable across SDK patch
 * bumps that would otherwise float the default version.
 */
export const STRIPE_API_VERSION = '2026-03-25.dahlia';

/** Validated configuration for {@link RealStripeGateway} (sourced from env). */
export interface RealStripeGatewayConfig {
  /** Stripe secret key (`sk_...`). Never logged. */
  readonly secretKey: string;
  /**
   * Stripe webhook signing secret (`whsec_...`).
   *
   * @remarks
   * Required by {@link RealStripeGateway.verifyWebhook}; optional here so the gateway can
   * still be constructed for the checkout/subscription paths when webhooks aren't wired.
   */
  readonly webhookSecret?: string;
  /**
   * Default price the checkout subscribes to when the caller supplies none.
   *
   * @remarks
   * Either a price id (`price_...`) or a price `lookup_key` (`DOCKET_PRICE_LOOKUP_*`);
   * {@link RealStripeGateway} resolves a lookup key to a price id on demand.
   */
  readonly priceKey?: string;
  /** Stripe billing-portal configuration id (`bpc_...`). */
  readonly portalConfigId?: string;
  /** Free-trial length in days; defaults to {@link DEFAULT_TRIAL_DAYS}. */
  readonly trialDays?: number;
  /**
   * API host override for testing against `stripe-mock` (e.g. `http://localhost:12111`).
   * Defaults to the live Stripe API.
   */
  readonly apiBase?: string;
  /** API version override; defaults to {@link STRIPE_API_VERSION}. */
  readonly apiVersion?: string;
}

/** The result of opening an embedded Checkout session (for the embedded Stripe.js UI). */
export interface EmbeddedCheckoutSessionResult {
  /** The session `client_secret` the embedded Checkout component mounts with. */
  readonly clientSecret: string;
  /** Provider checkout session id (echoed back by webhooks). */
  readonly sessionId: string;
}

/**
 * Map a Stripe subscription status onto the port's {@link SubscriptionStatus}.
 *
 * @remarks
 * Pure. `incomplete`/`unpaid` collapse to `past_due` (a payment is owed); `paused`,
 * `incomplete_expired`, `ended`, and anything unrecognized collapse to `canceled`.
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
 * Pure. Returns `null` for event types Docket does not model (the consumer ignores
 * them). `customer.subscription.updated` is disambiguated by the subscription's mapped
 * status: a `past_due` status surfaces as `subscription.past_due`, otherwise as
 * `subscription.updated`. `invoice.payment_failed` is normalized to
 * `subscription.past_due`.
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
 * Pure. The `referenceId` is taken from the subscription `metadata` (falling back to the
 * supplied `fallbackReferenceId` — the org id the caller queried by). In the dahlia API
 * `current_period_end` lives on the subscription **items**, so it is read from the first
 * item; `0` (no item) yields the Unix epoch, which downstream treats as "ended now".
 *
 * @param sub - The Stripe subscription.
 * @param fallbackReferenceId - Reference id to use when the subscription has no metadata.
 * @returns the provider-agnostic subscription snapshot.
 */
export function toSubscription(
  sub: Stripe.Subscription,
  fallbackReferenceId?: string,
): Subscription {
  // Stripe's *types* mark `metadata`/`items` as always-present, but real webhook and
  // search payloads can be partial, so read them defensively through a relaxed view.
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
 * Pure. Returns an empty object for an absent/blank base so the SDK keeps its live
 * defaults. A malformed base throws a clear error rather than silently hitting Stripe.
 *
 * @param apiBase - An absolute URL such as `http://localhost:12111`.
 * @returns the partial SDK config (`protocol`/`host`/`port`).
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
 * A real, env-driven Stripe billing gateway built on the official `stripe` SDK.
 *
 * @remarks
 * Implements the {@link BillingGateway} port (embedded checkout, subscription read,
 * cancellation, billing portal) and adds two non-port surfaces the integrator wires in
 * `apps/api`: {@link RealStripeGateway.createEmbeddedCheckoutSession} (returns the
 * `client_secret` for the embedded Checkout UI) and {@link RealStripeGateway.verifyWebhook}
 * (signature verification + normalization to a {@link BillingEvent}). Every SDK call is
 * wrapped so a Stripe/transport failure surfaces as a clear `Error`.
 */
export class RealStripeGateway implements BillingGateway {
  private readonly config: RealStripeGatewayConfig;
  private readonly stripe: Stripe;

  /**
   * @param config - Validated Stripe config from env.
   * @param http - HTTP transport (defaults to the platform `fetch`); injected into the
   *   Stripe SDK so the network edge is overridable in tests / at the composition root.
   */
  constructor(config: RealStripeGatewayConfig, http: HttpClient = defaultHttpClient) {
    this.config = config;
    const base = parseApiBase(config.apiBase);
    // Adapt the port's narrow `HttpClient` to the Web `fetch` shape the SDK expects.
    // The SDK always passes a string URL, but normalize URL/Request for completeness.
    const toUrl = (input: Parameters<typeof fetch>[0]): string => {
      if (typeof input === 'string') return input;
      /* v8 ignore next 2 -- the Stripe SDK only ever passes a string URL; URL/Request are defensive. */
      if (input instanceof URL) return input.href;
      return input.url;
    };
    const fetchFn: typeof fetch = (input, init) => http(toUrl(input), init ?? undefined);
    /* v8 ignore start -- live Stripe SDK construction; exercised only against the real service. */
    type StripeOptions = NonNullable<ConstructorParameters<typeof Stripe>[1]>;
    // The SDK types `apiVersion` as the *latest* literal only; we intentionally pin the
    // engineering-plan version, so cast just that field to the SDK's expected type.
    const apiVersion = (config.apiVersion ?? STRIPE_API_VERSION) as StripeOptions['apiVersion'];
    const options: StripeOptions = {
      apiVersion,
      httpClient: Stripe.createFetchHttpClient(fetchFn),
      ...base,
    };
    this.stripe = new Stripe(config.secretKey, options);
    /* v8 ignore stop */
  }

  /** The trial length (days) to apply when the caller supplies none. */
  private get trialDays(): number {
    return this.config.trialDays ?? DEFAULT_TRIAL_DAYS;
  }

  /**
   * Resolve a price reference to a concrete Stripe price id.
   *
   * @remarks
   * A `price_...` value is already an id and is returned as-is (no I/O). Anything else is
   * treated as a `lookup_key` (`DOCKET_PRICE_LOOKUP_*`) and resolved via the Prices API.
   *
   * @param priceRef - A price id or a price lookup key.
   * @returns the resolved Stripe price id.
   * @throws {Error} When a lookup key matches no active price.
   */
  private async resolvePrice(priceRef: string): Promise<string> {
    if (priceRef.startsWith('price_')) return priceRef;
    /* v8 ignore start -- live Stripe Prices API lookup. */
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

  /**
   * Build the shared `subscription`-mode session params for a checkout (pure).
   *
   * @param input - The checkout input.
   * @param price - The resolved Stripe price id.
   * @returns the common `SessionCreateParams` (sans `ui_mode` and URLs).
   */
  private baseCheckoutParams(
    input: CheckoutSessionInput,
    price: string,
  ): Stripe.Checkout.SessionCreateParams {
    return {
      mode: 'subscription',
      line_items: [{ price, quantity: 1 }],
      client_reference_id: input.referenceId,
      ...(input.customerEmail ? { customer_email: input.customerEmail } : {}),
      subscription_data: {
        trial_period_days: input.trialDays ?? this.trialDays,
        metadata: { referenceId: input.referenceId },
      },
      metadata: { referenceId: input.referenceId },
    };
  }

  /** {@inheritDoc BillingGateway.createCheckoutSession} */
  async createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSessionResult> {
    const priceRef = input.priceKey || this.config.priceKey;
    if (!priceRef) throw new Error('RealStripeGateway: no price key configured for checkout.');
    const price = await this.resolvePrice(priceRef);
    const params: Stripe.Checkout.SessionCreateParams = {
      ...this.baseCheckoutParams(input, price),
      ui_mode: 'hosted_page',
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
    };
    /* v8 ignore start -- live Stripe Checkout Sessions API. */
    let session: Stripe.Checkout.Session;
    try {
      session = await this.stripe.checkout.sessions.create(params);
    } catch (cause) {
      throw new Error('RealStripeGateway: failed to create checkout session.', { cause });
    }
    if (!session.url) {
      throw new Error('RealStripeGateway: Stripe returned a checkout session without a URL.');
    }
    return { url: session.url, sessionId: session.id };
    /* v8 ignore stop */
  }

  /**
   * Open an **embedded** Checkout session for the embedded Stripe.js UI.
   *
   * @remarks
   * The product renders embedded Checkout (via `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`)
   * rather than redirecting to a hosted page, so the frontend needs the session
   * `client_secret`. This is not on the {@link BillingGateway} port (which only carries a
   * redirect `url`); see the integrator note in the port gap. `successUrl` is used as the
   * embedded `return_url`; `cancelUrl` is ignored (embedded Checkout has no cancel URL).
   *
   * @param input - The scope, price, and return URL.
   * @returns the embedded session `client_secret` and id.
   * @throws {Error} When no price is configured or Stripe omits the client secret.
   */
  async createEmbeddedCheckoutSession(
    input: CheckoutSessionInput,
  ): Promise<EmbeddedCheckoutSessionResult> {
    const priceRef = input.priceKey || this.config.priceKey;
    if (!priceRef) throw new Error('RealStripeGateway: no price key configured for checkout.');
    const price = await this.resolvePrice(priceRef);
    const params: Stripe.Checkout.SessionCreateParams = {
      ...this.baseCheckoutParams(input, price),
      ui_mode: 'embedded_page',
      return_url: input.successUrl,
    };
    /* v8 ignore start -- live Stripe Checkout Sessions API. */
    let session: Stripe.Checkout.Session;
    try {
      session = await this.stripe.checkout.sessions.create(params);
    } catch (cause) {
      throw new Error('RealStripeGateway: failed to create embedded checkout session.', { cause });
    }
    if (!session.client_secret) {
      throw new Error('RealStripeGateway: embedded checkout session has no client secret.');
    }
    return { clientSecret: session.client_secret, sessionId: session.id };
    /* v8 ignore stop */
  }

  /**
   * Find the most recent Stripe subscription for a Docket scope.
   *
   * @remarks
   * Subscriptions carry `metadata.referenceId = organization.id` (stamped at checkout),
   * so they are located via the Search API. Returns `null` when none match.
   *
   * @param referenceId - The Docket scope key (organization id).
   * @returns the raw Stripe subscription, or `null`.
   */
  private async findSubscription(referenceId: string): Promise<Stripe.Subscription | null> {
    /* v8 ignore start -- live Stripe Subscriptions Search API. */
    let result: Stripe.ApiSearchResult<Stripe.Subscription>;
    try {
      result = await this.stripe.subscriptions.search({
        query: `metadata['referenceId']:'${referenceId}'`,
        limit: 1,
        expand: ['data.items'],
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

  /** {@inheritDoc BillingGateway.cancelSubscription} */
  async cancelSubscription(referenceId: string): Promise<void> {
    const sub = await this.findSubscription(referenceId);
    if (!sub) return;
    /* v8 ignore start -- live Stripe Subscriptions cancel API. */
    try {
      await this.stripe.subscriptions.cancel(sub.id);
    } catch (cause) {
      throw new Error('RealStripeGateway: failed to cancel subscription.', { cause });
    }
    /* v8 ignore stop */
  }

  /** {@inheritDoc BillingGateway.createBillingPortalSession} */
  async createBillingPortalSession(referenceId: string): Promise<BillingPortalSessionResult> {
    /* v8 ignore start -- live Stripe Billing Portal Sessions API. */
    let session: Stripe.BillingPortal.Session;
    try {
      session = await this.stripe.billingPortal.sessions.create({
        customer: referenceId,
        ...(this.config.portalConfigId ? { configuration: this.config.portalConfigId } : {}),
      });
    } catch (cause) {
      throw new Error('RealStripeGateway: failed to open billing portal session.', { cause });
    }
    return { url: session.url };
    /* v8 ignore stop */
  }

  /**
   * Normalize a verified Stripe `Event` into a port {@link BillingEvent}, when modeled.
   *
   * @remarks
   * Pure. Pulls the subscription snapshot from the event's data object when it is a
   * subscription (or a checkout session that already embeds a subscription), maps the
   * event type (disambiguating `customer.subscription.updated` by the mapped status), and
   * returns `null` for event types Docket does not consume.
   *
   * @param event - A verified Stripe event.
   * @returns the normalized billing event, or `null` when not modeled.
   */
  mapStripeEvent(event: Stripe.Event): BillingEvent | null {
    const object = event.data.object as unknown as Record<string, unknown>;
    const isSubscription = object['object'] === 'subscription';
    const subscription = isSubscription
      ? toSubscription(object as unknown as Stripe.Subscription)
      : undefined;
    // For a subscription event use its mapped ref; otherwise (checkout session / invoice)
    // carry the org ref from the object's metadata / client_reference_id when present.
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

  /**
   * Verify a Stripe webhook signature and normalize the payload to a {@link BillingEvent}.
   *
   * @remarks
   * Uses the SDK's async, Web-Crypto verifier so it works on edge/serverless runtimes.
   * The **raw** request body (a string or `Buffer`, exactly as received — not re-parsed
   * JSON) must be passed. A bad signature, missing secret, or tampered body throws a clear
   * error. Returns `null` when the event verifies but Docket does not model its type.
   *
   * @param rawBody - The raw, unparsed request body.
   * @param signature - The `Stripe-Signature` request header.
   * @returns the normalized billing event, or `null` when the verified event isn't modeled.
   * @throws {Error} When no webhook secret is configured or the signature is invalid.
   */
  async verifyWebhook(rawBody: string | Buffer, signature: string): Promise<BillingEvent | null> {
    if (!this.config.webhookSecret) {
      throw new Error('RealStripeGateway: no STRIPE_WEBHOOK_SECRET configured for webhooks.');
    }
    /* v8 ignore start -- live Stripe signature verification (Web Crypto). */
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
