/**
 * `@docket/billing` - `RealStripeGateway`.
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
  BillingEvent,
  BillingGateway,
  BillingPortalSessionResult,
  CheckoutSessionInput,
  CheckoutSessionResult,
  Subscription,
} from './index';
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
  readonly webhookSecret?: string;
  /** Default price the checkout subscribes to when the caller supplies none. */
  readonly priceKey?: string;
  /** Stripe billing-portal configuration id (`bpc_...`). */
  readonly portalConfigId?: string;
  /** Free-trial length in days; defaults to {@link DEFAULT_TRIAL_DAYS}. */
  readonly trialDays?: number;
  /** API host override for testing against `stripe-mock` (e.g. `http://localhost:12111`). */
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
    const toUrl = (input: Parameters<typeof fetch>[0]): string => {
      if (typeof input === 'string') return input;
      /* v8 ignore next 2 */
      if (input instanceof URL) return input.href;
      return input.url;
    };
    const fetchFn: typeof fetch = (input, init) => http(toUrl(input), init ?? undefined);
    /* v8 ignore start */
    type StripeOptions = NonNullable<ConstructorParameters<typeof Stripe>[1]>;
    const apiVersion = (config.apiVersion ?? STRIPE_API_VERSION) as StripeOptions['apiVersion'];
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

  private async findSubscription(referenceId: string): Promise<Stripe.Subscription | null> {
    /* v8 ignore start */
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
    /* v8 ignore start */
    try {
      await this.stripe.subscriptions.cancel(sub.id);
    } catch (cause) {
      throw new Error('RealStripeGateway: failed to cancel subscription.', { cause });
    }
    /* v8 ignore stop */
  }

  /** {@inheritDoc BillingGateway.createBillingPortalSession} */
  async createBillingPortalSession(referenceId: string): Promise<BillingPortalSessionResult> {
    /* v8 ignore start */
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
