import { describe, expect, it } from 'vitest';

import type { HttpClient } from '../src/http';
import {
  DEFAULT_TRIAL_DAYS,
  mapEventType,
  parseApiBase,
  RealStripeGateway,
  STRIPE_API_VERSION,
  toStatus,
  toSubscription,
} from '../src/stripe';
import type {
  StripeEventObjectView,
  StripeEventView,
  StripeSubscriptionView,
} from '../src/stripe-mappers';

/**
 * An {@link HttpClient} that fails if ever called — the pure-logic tests never hit the
 * network, and the SDK-construction lines are v8-ignored, so no real request is expected
 * here.
 */
const neverHttp: HttpClient = () => {
  throw new Error('unexpected network call in a pure-logic test');
};

/** One recorded SDK request: method, URL, and form/query body. */
interface RecordedReq {
  readonly url: string;
  readonly method: string;
  readonly body: string;
}

/**
 * A fake {@link HttpClient} that records each Stripe SDK request and replies with the
 * next scripted JSON payload, so the gateway's non-I/O lines (guards, param mapping,
 * response mapping) run end-to-end without a live Stripe. The SDK calls reached through
 * it are themselves v8-ignored; this exercises the surrounding pure logic.
 */
function scriptedHttp(payloads: unknown[]): { http: HttpClient; reqs: RecordedReq[] } {
  const reqs: RecordedReq[] = [];
  let i = 0;
  const http: HttpClient = async (url, init) => {
    reqs.push({
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? init.body : '',
    });
    const payload = payloads[i] ?? {};
    i += 1;
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Request-Id': 'req_test' },
    });
  };
  return { http, reqs };
}

/** A Stripe `list`-envelope wrapping `data`. */
function list(data: unknown[]): Record<string, unknown> {
  return { object: 'list', url: '/v1/x', has_more: false, data };
}

/** A Stripe `search_result`-envelope wrapping `data`. */
function searchResult(data: unknown[]): Record<string, unknown> {
  return { object: 'search_result', url: '/v1/x', has_more: false, data };
}

/** Build a minimal Stripe `Subscription` for the mapping tests. */
function stripeSub(over: {
  id?: string;
  status?: string;
  referenceId?: string | null;
  periodEnd?: number;
  trialEnd?: number | null;
}): StripeSubscriptionView {
  const metadata: Record<string, string> =
    over.referenceId === null ? {} : { referenceId: over.referenceId ?? 'org_1' };
  return {
    id: over.id ?? 'sub_1',
    object: 'subscription',
    status: over.status ?? 'active',
    metadata,
    trial_end: over.trialEnd === undefined ? null : over.trialEnd,
    items: {
      data: [{ current_period_end: over.periodEnd ?? 1_700_000_000 }],
    },
  };
}

/** Build a minimal Stripe `Event` wrapping the given object. */
function stripeEvent(
  type: string,
  object: StripeSubscriptionView | StripeEventObjectView,
  id = 'evt_1',
): StripeEventView {
  return {
    id,
    type,
    created: 1_700_000_000,
    data: { object },
  };
}

describe('toStatus', () => {
  it.each([
    ['trialing', 'trialing'],
    ['active', 'active'],
    ['past_due', 'past_due'],
    ['unpaid', 'past_due'],
    ['incomplete', 'past_due'],
    ['incomplete_expired', 'canceled'],
    ['paused', 'canceled'],
    ['canceled', 'canceled'],
    ['anything_else', 'canceled'],
  ])('maps stripe %s -> port %s', (stripe, mapped) => {
    expect(toStatus(stripe)).toBe(mapped);
  });
});

describe('mapEventType', () => {
  it('maps the modeled event types', () => {
    expect(mapEventType('checkout.session.completed')).toBe('checkout.completed');
    expect(mapEventType('customer.subscription.created')).toBe('subscription.created');
    expect(mapEventType('customer.subscription.trial_will_end')).toBe(
      'subscription.trial_will_end',
    );
    expect(mapEventType('customer.subscription.deleted')).toBe('subscription.canceled');
    expect(mapEventType('invoice.payment_failed')).toBe('subscription.past_due');
  });

  it('disambiguates subscription.updated by mapped status', () => {
    expect(mapEventType('customer.subscription.updated', 'active')).toBe('subscription.updated');
    expect(mapEventType('customer.subscription.updated', 'past_due')).toBe('subscription.past_due');
    expect(mapEventType('customer.subscription.updated')).toBe('subscription.updated');
  });

  it('returns null for event types Docket does not model', () => {
    expect(mapEventType('charge.succeeded')).toBeNull();
    expect(mapEventType('customer.subscription.paused')).toBeNull();
  });
});

describe('toSubscription', () => {
  it('maps id, referenceId (from metadata), status, period end, and trialEnd', () => {
    const sub = toSubscription(
      stripeSub({
        id: 'sub_x',
        status: 'trialing',
        periodEnd: 1_700_000_000,
        trialEnd: 1_701_000_000,
      }),
    );
    expect(sub).toEqual({
      id: 'sub_x',
      referenceId: 'org_1',
      status: 'trialing',
      currentPeriodEnd: new Date(1_700_000_000 * 1000).toISOString(),
      trialEnd: new Date(1_701_000_000 * 1000).toISOString(),
    });
  });

  it('omits trialEnd when there is no trial_end', () => {
    const sub = toSubscription(stripeSub({ status: 'active', trialEnd: null }));
    expect(sub).not.toHaveProperty('trialEnd');
  });

  it('falls back to the provided referenceId when metadata is absent', () => {
    const sub = toSubscription(stripeSub({ referenceId: null }), 'org_fallback');
    expect(sub.referenceId).toBe('org_fallback');
  });

  it('uses the epoch when the subscription has no item period end', () => {
    const raw: StripeSubscriptionView = {
      id: 'sub_e',
      object: 'subscription',
      status: 'canceled',
      metadata: {},
    };
    const sub = toSubscription(raw, 'org_2');
    expect(sub.referenceId).toBe('org_2');
    expect(sub.currentPeriodEnd).toBe(new Date(0).toISOString());
    expect(sub.status).toBe('canceled');
  });
});

describe('parseApiBase', () => {
  it('returns an empty config for absent/blank bases (keeps live defaults)', () => {
    expect(parseApiBase(undefined)).toEqual({});
    expect(parseApiBase('   ')).toEqual({});
  });

  it('parses host, port, and protocol from an http override', () => {
    expect(parseApiBase('http://localhost:12111')).toEqual({
      protocol: 'http',
      host: 'localhost',
      port: 12111,
    });
  });

  it('parses an https override without a port', () => {
    expect(parseApiBase('https://stripe-mock.local')).toEqual({
      protocol: 'https',
      host: 'stripe-mock.local',
    });
  });

  it('throws a clear error for a malformed base', () => {
    expect(() => parseApiBase('not a url')).toThrow(/invalid apiBase/);
  });
});

describe('RealStripeGateway constants', () => {
  it('pins the engineering-plan API version and default trial', () => {
    expect(STRIPE_API_VERSION).toBe('2026-03-25.dahlia');
    expect(DEFAULT_TRIAL_DAYS).toBe(14);
  });
});

describe('RealStripeGateway.mapStripeEvent', () => {
  const gw = new RealStripeGateway({ secretKey: 'sk_test_x' }, neverHttp);

  it('normalizes a subscription event with its subscription snapshot', () => {
    const event = stripeEvent('customer.subscription.updated', {
      object: 'subscription',
      id: 'sub_42',
      status: 'past_due',
      metadata: { referenceId: 'org_9' },
      trial_end: null,
      items: {
        object: 'list',
        data: [{ current_period_end: 1_700_000_000 }],
        has_more: false,
        url: '',
      },
    });
    const mapped = gw.mapStripeEvent(event);
    expect(mapped).toEqual({
      id: 'evt_1',
      type: 'subscription.past_due',
      referenceId: 'org_9',
      subscription: {
        id: 'sub_42',
        referenceId: 'org_9',
        status: 'past_due',
        currentPeriodEnd: new Date(1_700_000_000 * 1000).toISOString(),
      },
      createdAt: new Date(1_700_000_000 * 1000).toISOString(),
    });
  });

  it('normalizes a checkout.session.completed event by client_reference_id, with no subscription', () => {
    const event = stripeEvent('checkout.session.completed', {
      object: 'checkout.session',
      id: 'cs_1',
      client_reference_id: 'org_7',
      metadata: null,
    });
    const mapped = gw.mapStripeEvent(event);
    expect(mapped?.type).toBe('checkout.completed');
    expect(mapped?.referenceId).toBe('org_7');
    expect(mapped).not.toHaveProperty('subscription');
  });

  it('reads the org reference from a non-subscription object metadata', () => {
    const event = stripeEvent('invoice.payment_failed', {
      object: 'invoice',
      id: 'in_1',
      metadata: { referenceId: 'org_meta' },
    });
    const mapped = gw.mapStripeEvent(event);
    expect(mapped?.type).toBe('subscription.past_due');
    expect(mapped?.referenceId).toBe('org_meta');
  });

  it('returns null for an event type Docket does not model', () => {
    const event = stripeEvent('charge.refunded', { object: 'charge', id: 'ch_1' });
    expect(gw.mapStripeEvent(event)).toBeNull();
  });

  it('falls back to an empty referenceId when none is present', () => {
    const event = stripeEvent('checkout.session.completed', {
      object: 'checkout.session',
      id: 'cs_2',
    });
    expect(gw.mapStripeEvent(event)?.referenceId).toBe('');
  });
});

describe('RealStripeGateway.verifyWebhook', () => {
  it('throws a clear error when no webhook secret is configured', async () => {
    const gw = new RealStripeGateway({ secretKey: 'sk_test_x' }, neverHttp);
    await expect(gw.verifyWebhook('{}', 'sig')).rejects.toThrow(/no STRIPE_WEBHOOK_SECRET/);
  });
});

describe('RealStripeGateway checkout guards (pure)', () => {
  it('createCheckoutSession throws when no price is configured', async () => {
    const gw = new RealStripeGateway({ secretKey: 'sk_test_x' }, neverHttp);
    await expect(
      gw.createCheckoutSession({ referenceId: 'o', priceKey: '', successUrl: 's', cancelUrl: 'c' }),
    ).rejects.toThrow(/no price key configured/);
  });

  it('createEmbeddedCheckoutSession throws when no price is configured', async () => {
    const gw = new RealStripeGateway({ secretKey: 'sk_test_x' }, neverHttp);
    await expect(
      gw.createEmbeddedCheckoutSession({
        referenceId: 'o',
        priceKey: '',
        successUrl: 's',
        cancelUrl: 'c',
      }),
    ).rejects.toThrow(/no price key configured/);
  });
});

describe('RealStripeGateway methods (driven through the SDK over a scripted http)', () => {
  it('creates a hosted checkout, mapping price + redirect URLs', async () => {
    const { http, reqs } = scriptedHttp([{ id: 'cs_h', url: 'https://stripe/checkout' }]);
    const gw = new RealStripeGateway({ secretKey: 'sk_test_x', priceKey: 'price_default' }, http);
    const result = await gw.createCheckoutSession({
      referenceId: 'org_1',
      priceKey: 'price_override',
      successUrl: 'https://app/ok',
      cancelUrl: 'https://app/no',
      customerEmail: 'a@b.com',
    });
    expect(result).toEqual({ url: 'https://stripe/checkout', sessionId: 'cs_h' });
    const req = reqs[0]!;
    expect(req.url).toContain('https://api.stripe.com/v1/checkout/sessions');
    expect(req.method).toBe('POST');
    expect(decodeURIComponent(req.body)).toContain('ui_mode=hosted_page');
    expect(decodeURIComponent(req.body)).toContain('price_override');
    expect(decodeURIComponent(req.body)).toContain('trial_period_days]=14');
    expect(decodeURIComponent(req.body)).toContain('referenceId]=org_1');
    expect(decodeURIComponent(req.body)).toContain('a@b.com');
  });

  it('falls back to the configured price and a custom trial-days override', async () => {
    const { http, reqs } = scriptedHttp([{ id: 'cs_1', url: 'u' }]);
    const gw = new RealStripeGateway(
      { secretKey: 'sk', priceKey: 'price_default', trialDays: 30 },
      http,
    );
    await gw.createCheckoutSession({
      referenceId: 'o',
      priceKey: '',
      successUrl: 's',
      cancelUrl: 'c',
    });
    expect(decodeURIComponent(reqs[0]!.body)).toContain('price_default');
    expect(decodeURIComponent(reqs[0]!.body)).toContain('trial_period_days]=30');
  });

  it('resolves a lookup key to a price id before creating checkout', async () => {
    const { http, reqs } = scriptedHttp([
      list([{ id: 'price_resolved', object: 'price' }]),
      { id: 'cs_2', url: 'u2' },
    ]);
    const gw = new RealStripeGateway({ secretKey: 'sk' }, http);
    await gw.createCheckoutSession({
      referenceId: 'o',
      priceKey: 'lookup_team', // not a price_ id → triggers prices.list
      successUrl: 's',
      cancelUrl: 'c',
    });
    expect(reqs[0]!.url).toContain('/v1/prices');
    expect(reqs[0]!.url).toContain('lookup_keys');
    expect(decodeURIComponent(reqs[1]!.body)).toContain('price_resolved');
  });

  it('throws a clear error when a lookup key resolves to no price', async () => {
    const { http } = scriptedHttp([list([])]);
    const gw = new RealStripeGateway({ secretKey: 'sk' }, http);
    await expect(
      gw.createCheckoutSession({
        referenceId: 'o',
        priceKey: 'missing_lookup',
        successUrl: 's',
        cancelUrl: 'c',
      }),
    ).rejects.toThrow(/no active price/);
  });

  it('creates an embedded checkout and returns the client secret', async () => {
    const { http, reqs } = scriptedHttp([{ id: 'cs_e', client_secret: 'cs_secret_123' }]);
    const gw = new RealStripeGateway({ secretKey: 'sk', priceKey: 'price_default' }, http);
    const result = await gw.createEmbeddedCheckoutSession({
      referenceId: 'org_1',
      priceKey: 'price_default',
      successUrl: 'https://app/return',
      cancelUrl: 'ignored',
    });
    expect(result).toEqual({ clientSecret: 'cs_secret_123', sessionId: 'cs_e' });
    expect(decodeURIComponent(reqs[0]!.body)).toContain('ui_mode=embedded_page');
    expect(decodeURIComponent(reqs[0]!.body)).toContain('return_url=https://app/return');
  });

  it('reads and maps a subscription found by reference metadata', async () => {
    const { http, reqs } = scriptedHttp([
      searchResult([
        {
          id: 'sub_found',
          object: 'subscription',
          status: 'active',
          metadata: { referenceId: 'org_5' },
          trial_end: null,
          items: list([{ current_period_end: 1_700_000_000 }]),
        },
      ]),
    ]);
    const gw = new RealStripeGateway({ secretKey: 'sk' }, http);
    const sub = await gw.getSubscription('org_5');
    expect(sub).toEqual({
      id: 'sub_found',
      referenceId: 'org_5',
      status: 'active',
      currentPeriodEnd: new Date(1_700_000_000 * 1000).toISOString(),
    });
    expect(reqs[0]!.url).toContain('/v1/subscriptions/search');
  });

  it('returns null when no subscription matches', async () => {
    const { http } = scriptedHttp([searchResult([])]);
    const gw = new RealStripeGateway({ secretKey: 'sk' }, http);
    expect(await gw.getSubscription('none')).toBeNull();
  });

  it('cancels the resolved subscription', async () => {
    const { http, reqs } = scriptedHttp([
      searchResult([
        { id: 'sub_cancel', object: 'subscription', status: 'active', items: list([]) },
      ]),
      { id: 'sub_cancel', object: 'subscription', status: 'canceled', items: list([]) },
    ]);
    const gw = new RealStripeGateway({ secretKey: 'sk' }, http);
    await gw.cancelSubscription('org_1');
    expect(reqs[1]!.url).toContain('/v1/subscriptions/sub_cancel');
    expect(reqs[1]!.method).toBe('DELETE');
  });

  it('cancel is a no-op when there is no subscription', async () => {
    const { http, reqs } = scriptedHttp([searchResult([])]);
    const gw = new RealStripeGateway({ secretKey: 'sk' }, http);
    await gw.cancelSubscription('org_x');
    expect(reqs).toHaveLength(1);
  });

  it('opens a billing portal session with the configured config id', async () => {
    const { http, reqs } = scriptedHttp([{ id: 'bps_1', url: 'https://portal' }]);
    const gw = new RealStripeGateway({ secretKey: 'sk', portalConfigId: 'bpc_1' }, http);
    const result = await gw.createBillingPortalSession('cus_1');
    expect(result).toEqual({ url: 'https://portal' });
    const req = reqs[0]!;
    expect(req.url).toContain('/v1/billing_portal/sessions');
    expect(decodeURIComponent(req.body)).toContain('customer=cus_1');
    expect(decodeURIComponent(req.body)).toContain('configuration=bpc_1');
  });

  it('honors a custom apiBase override (stripe-mock)', async () => {
    const { http, reqs } = scriptedHttp([{ id: 'bps_2', url: 'https://portal' }]);
    const gw = new RealStripeGateway({ secretKey: 'sk', apiBase: 'http://localhost:12111' }, http);
    await gw.createBillingPortalSession('cus_2');
    expect(reqs[0]!.url).toContain('http://localhost:12111/v1/billing_portal/sessions');
  });
});
