/**
 * `@docket/boundaries/real` — `RealStripeGateway`.
 *
 * @remarks
 * The env-driven {@link BillingGateway} that talks to the Stripe REST API. Selected
 * only when `STRIPE_SECRET_KEY` is present and real-shaped (see {@link selectAdapter})
 * and never in `APP_MODE ∈ {local,test}`. All values come from validated env; the
 * network edge goes through an injectable {@link HttpClient}. No business logic lives
 * here — only the Stripe I/O edge (`boundaries.md` §3).
 */
import type {
  BillingGateway,
  BillingPortalSessionResult,
  CheckoutSessionInput,
  CheckoutSessionResult,
  Subscription,
  SubscriptionStatus,
} from '../ports/billing';
import { defaultHttpClient, type HttpClient } from './http';

/** Validated configuration for {@link RealStripeGateway} (sourced from env). */
export interface RealStripeGatewayConfig {
  /** Stripe secret key (`sk_...`). */
  readonly secretKey: string;
  /** Default price lookup key / price id used by checkout. */
  readonly priceKey?: string;
  /** Stripe billing portal configuration id. */
  readonly portalConfigId?: string;
  /** API base (override for testing against a Stripe mock); defaults to the live API. */
  readonly apiBase?: string;
}

/** Encode a flat record as `application/x-www-form-urlencoded` for the Stripe API. */
function form(params: Record<string, string | number | undefined>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) usp.set(k, String(v));
  }
  return usp.toString();
}

/** Map a Stripe subscription status string onto the port's {@link SubscriptionStatus}. */
function toStatus(stripeStatus: string): SubscriptionStatus {
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
 * A real, env-driven Stripe billing gateway.
 *
 * @remarks
 * Each method issues a single Stripe REST call through the injected HTTP client; the
 * port's provider-agnostic shapes are mapped from Stripe's response.
 */
export class RealStripeGateway implements BillingGateway {
  private readonly config: RealStripeGatewayConfig;
  private readonly http: HttpClient;
  private readonly apiBase: string;

  /**
   * @param config - Validated Stripe config from env.
   * @param http - HTTP transport (defaults to the platform `fetch`).
   */
  constructor(config: RealStripeGatewayConfig, http: HttpClient = defaultHttpClient) {
    this.config = config;
    this.http = http;
    this.apiBase = config.apiBase ?? 'https://api.stripe.com';
  }

  private async call(method: string, path: string, body?: string): Promise<unknown> {
    const res = await this.http(`${this.apiBase}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.config.secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    if (!res.ok) {
      throw new Error(`Stripe API ${method} ${path} failed: ${res.status}`);
    }
    return res.json();
  }

  /** {@inheritDoc BillingGateway.createCheckoutSession} */
  async createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSessionResult> {
    const price = input.priceKey || this.config.priceKey;
    if (!price) throw new Error('RealStripeGateway: no price key configured for checkout.');
    const body = form({
      mode: 'subscription',
      'line_items[0][price]': price,
      'line_items[0][quantity]': 1,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      client_reference_id: input.referenceId,
      customer_email: input.customerEmail,
      'subscription_data[trial_period_days]': input.trialDays,
    });
    const json = (await this.call('POST', '/v1/checkout/sessions', body)) as {
      id: string;
      url: string;
    };
    return { url: json.url, sessionId: json.id };
  }

  /** {@inheritDoc BillingGateway.getSubscription} */
  async getSubscription(referenceId: string): Promise<Subscription | null> {
    const query = form({ 'metadata[referenceId]': referenceId, limit: 1, status: 'all' });
    const json = (await this.call('GET', `/v1/subscriptions?${query}`)) as {
      data?: {
        id: string;
        status: string;
        current_period_end: number;
        trial_end?: number | null;
      }[];
    };
    const sub = json.data?.[0];
    if (!sub) return null;
    return {
      id: sub.id,
      referenceId,
      status: toStatus(sub.status),
      currentPeriodEnd: new Date(sub.current_period_end * 1000).toISOString(),
      ...(sub.trial_end ? { trialEnd: new Date(sub.trial_end * 1000).toISOString() } : {}),
    };
  }

  /** {@inheritDoc BillingGateway.cancelSubscription} */
  async cancelSubscription(referenceId: string): Promise<void> {
    const current = await this.getSubscription(referenceId);
    if (!current) return;
    await this.call('DELETE', `/v1/subscriptions/${current.id}`);
  }

  /** {@inheritDoc BillingGateway.createBillingPortalSession} */
  async createBillingPortalSession(referenceId: string): Promise<BillingPortalSessionResult> {
    const body = form({ customer: referenceId, configuration: this.config.portalConfigId });
    const json = (await this.call('POST', '/v1/billing_portal/sessions', body)) as { url: string };
    return { url: json.url };
  }
}
