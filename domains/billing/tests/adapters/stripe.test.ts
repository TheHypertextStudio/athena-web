import { describe, expect, it } from 'vitest';

import type { HttpClient } from '../../src/adapters/http';
import {
  DEFAULT_TRIAL_DAYS,
  mapEventType,
  parseApiBase,
  RealStripeGateway,
  type RealStripeGatewayConfig,
  STRIPE_API_VERSION,
  toStatus,
  toSubscription,
} from '../../src/adapters/stripe';
import type {
  StripeEventObjectView,
  StripeEventView,
  StripeSubscriptionView,
} from '../../src/adapters/stripe-mappers';

/**
 * An {@link HttpClient} that fails if ever called — the pure-logic tests never hit the
 * network, and the SDK-construction lines are v8-ignored, so no real request is expected
 * here.
 */
const neverHttp: HttpClient = () => {
  throw new Error('unexpected network call in a pure-logic test');
};

const TEST_STRIPE_ACCOUNT_ID = 'acct_hypertext';

/** Build the gateway against one non-production account fixture. */
function createGateway(
  config: Omit<RealStripeGatewayConfig, 'expectedAccountId'>,
  http: HttpClient = neverHttp,
): RealStripeGateway {
  return new RealStripeGateway({ ...config, expectedAccountId: TEST_STRIPE_ACCOUNT_ID }, http);
}

/** One recorded SDK request: method, URL, and form/query body. */
interface RecordedReq {
  readonly url: string;
  readonly method: string;
  readonly body: string;
  readonly headers: Headers;
}

/**
 * A fake {@link HttpClient} that records each Stripe SDK request and replies with the
 * next scripted JSON payload, so the gateway's non-I/O lines (guards, param mapping,
 * response mapping) run end-to-end without a live Stripe. The SDK calls reached through
 * it are themselves v8-ignored; this exercises the surrounding pure logic.
 */
function scriptedHttp(
  payloads: unknown[],
  accountId = TEST_STRIPE_ACCOUNT_ID,
  recordAccount = false,
): { http: HttpClient; reqs: RecordedReq[] } {
  const reqs: RecordedReq[] = [];
  let i = 0;
  const http: HttpClient = async (url, init) => {
    const request = {
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? init.body : '',
      headers: new Headers(init?.headers),
    };
    if (url.includes('/v1/account')) {
      if (recordAccount) reqs.push(request);
      return new Response(JSON.stringify({ id: accountId, object: 'account' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Request-Id': 'req_account' },
      });
    }
    reqs.push(request);
    const payload = payloads[i] ?? {};
    i += 1;
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Request-Id': 'req_test' },
    });
  };
  return { http, reqs };
}

/** Return a recorded request while preserving an actionable failure when it is missing. */
function requestAt(reqs: readonly RecordedReq[], index: number): RecordedReq {
  const request = reqs[index];
  expect(request).toBeDefined();
  if (!request) throw new Error(`Expected recorded Stripe request at index ${index}`);
  return request;
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
  cancelAtPeriodEnd?: boolean;
  cancelAt?: number | null;
  discounts?: StripeSubscriptionView['discounts'];
}): StripeSubscriptionView {
  const metadata: Record<string, string> =
    over.referenceId === null ? {} : { referenceId: over.referenceId ?? 'org_1' };
  return {
    id: over.id ?? 'sub_1',
    object: 'subscription',
    status: over.status ?? 'active',
    metadata,
    trial_end: over.trialEnd === undefined ? null : over.trialEnd,
    cancel_at_period_end: over.cancelAtPeriodEnd ?? false,
    cancel_at: over.cancelAt === undefined ? null : over.cancelAt,
    ...(over.discounts ? { discounts: over.discounts } : {}),
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
    expect(mapEventType('invoice.paid')).toBe('subscription.paid');
    expect(mapEventType('invoice.payment_action_required')).toBe(
      'subscription.payment_action_required',
    );
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
      cancelAtPeriodEnd: false,
      trialEnd: new Date(1_701_000_000 * 1000).toISOString(),
    });
  });

  it('omits trialEnd when there is no trial_end', () => {
    const sub = toSubscription(stripeSub({ status: 'active', trialEnd: null }));
    expect(sub).not.toHaveProperty('trialEnd');
  });

  it('maps an explicit cancel_at timestamp as a scheduled cancellation', () => {
    const cancelAt = 1_700_000_000;
    const sub = toSubscription(
      stripeSub({
        status: 'trialing',
        periodEnd: cancelAt,
        cancelAtPeriodEnd: false,
        cancelAt,
      }),
    );

    expect(sub.cancelAtPeriodEnd).toBe(true);
    expect(sub.currentPeriodEnd).toBe(new Date(cancelAt * 1000).toISOString());
  });

  it('maps expanded subscription discounts for award reconciliation', () => {
    const sub = toSubscription(
      stripeSub({
        discounts: [
          {
            id: 'di_student',
            source: { coupon: { id: 'coupon_student' } },
          },
        ],
      }),
    );
    expect(sub).toMatchObject({
      discountIds: ['di_student'],
      couponIds: ['coupon_student'],
    });
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

  it('falls back to an empty string when metadata has no reference and no fallback is given', () => {
    const sub = toSubscription(stripeSub({ referenceId: null }));
    expect(sub.referenceId).toBe('');
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
  const gw = createGateway({ secretKey: 'sk_test_x' }, neverHttp);

  it('normalizes a subscription event with its subscription snapshot', () => {
    const event = stripeEvent('customer.subscription.updated', {
      object: 'subscription',
      id: 'sub_42',
      customer: 'cus_42',
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
      customerId: 'cus_42',
      subscription: {
        id: 'sub_42',
        customerId: 'cus_42',
        referenceId: 'org_9',
        status: 'past_due',
        currentPeriodEnd: new Date(1_700_000_000 * 1000).toISOString(),
        cancelAtPeriodEnd: false,
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

  it('reads invoice ownership from subscription details instead of invoice metadata', () => {
    const event = stripeEvent('invoice.payment_failed', {
      object: 'invoice',
      id: 'in_2',
      customer: 'cus_2',
      parent: {
        subscription_details: {
          subscription: 'sub_2',
          metadata: { referenceId: 'org_subscription' },
        },
      },
    });
    expect(gw.mapStripeEvent(event)).toMatchObject({
      type: 'subscription.past_due',
      referenceId: 'org_subscription',
      customerId: 'cus_2',
      subscriptionId: 'sub_2',
    });
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
    const gw = createGateway({ secretKey: 'sk_test_x' }, neverHttp);
    await expect(gw.verifyWebhook('{}', 'sig')).rejects.toThrow(/no STRIPE_WEBHOOK_SECRET/);
  });
});

describe('RealStripeGateway checkout guards (pure)', () => {
  it('createCheckoutSession throws when no price is configured', async () => {
    const gw = createGateway({ secretKey: 'sk_test_x' }, neverHttp);
    await expect(
      gw.createCheckoutSession({ referenceId: 'o', priceKey: '', successUrl: 's', cancelUrl: 'c' }),
    ).rejects.toThrow(/no price key configured/);
  });

  it('createEmbeddedCheckoutSession throws when no price is configured', async () => {
    const gw = createGateway({ secretKey: 'sk_test_x' }, neverHttp);
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
  it('verifies the Hypertext Studio account before the first provider request', async () => {
    const { http, reqs } = scriptedHttp(
      [{ id: 'cus_1', object: 'customer' }],
      TEST_STRIPE_ACCOUNT_ID,
      true,
    );
    const gw = createGateway({ secretKey: 'sk_test_x' }, http);

    await expect(gw.createCustomer('org_1')).resolves.toEqual({
      id: 'cus_1',
      referenceId: 'org_1',
    });

    expect(requestAt(reqs, 0).url).toContain('/v1/account');
    expect(requestAt(reqs, 1).url).toContain('/v1/customers');
  });

  it('blocks the provider request when the configured account does not match', async () => {
    const { http, reqs } = scriptedHttp([], 'acct_personal', true);
    const gw = createGateway({ secretKey: 'sk_test_x' }, http);

    await expect(gw.createCustomer('org_1')).rejects.toThrow(
      'RealStripeGateway: failed to create customer.',
    );
    expect(reqs).toHaveLength(1);
    expect(requestAt(reqs, 0).url).toContain('/v1/account');
  });

  it('shares one account verification across concurrent provider requests', async () => {
    let accountReads = 0;
    let customerCreates = 0;
    const http: HttpClient = async (url) => {
      if (url.includes('/v1/account')) {
        accountReads += 1;
        await Promise.resolve();
        return Response.json({ id: TEST_STRIPE_ACCOUNT_ID, object: 'account' });
      }
      customerCreates += 1;
      return Response.json({ id: `cus_${customerCreates}`, object: 'customer' });
    };
    const gw = createGateway({ secretKey: 'sk_test_x' }, http);

    await Promise.all([gw.createCustomer('org_1'), gw.createCustomer('org_2')]);

    expect(accountReads).toBe(1);
    expect(customerCreates).toBe(2);
  });

  it('creates one organization customer with an idempotent provider request', async () => {
    const { http, reqs } = scriptedHttp([{ id: 'cus_1', object: 'customer' }]);
    const gw = createGateway({ secretKey: 'sk_test_x' }, http);

    await expect(gw.createCustomer('org_1', 'owner@example.com')).resolves.toEqual({
      id: 'cus_1',
      referenceId: 'org_1',
    });

    const req = requestAt(reqs, 0);
    expect(req.url).toContain('/v1/customers');
    expect(decodeURIComponent(req.body)).toContain('metadata[referenceId]=org_1');
    expect(decodeURIComponent(req.body)).toContain('email=owner@example.com');
    expect(req.headers.get('idempotency-key')).toBe('docket:customer:org_1');
  });

  it('lists every Stripe customer carrying the organization reference', async () => {
    const { http, reqs } = scriptedHttp([
      searchResult([
        { id: 'cus_1', object: 'customer', metadata: { referenceId: 'org_1' } },
        { id: 'cus_2', object: 'customer', metadata: { referenceId: 'org_1' } },
      ]),
    ]);
    const gw = createGateway({ secretKey: 'sk_test_x' }, http);

    await expect(gw.listCustomers('org_1')).resolves.toEqual([
      { id: 'cus_1', referenceId: 'org_1' },
      { id: 'cus_2', referenceId: 'org_1' },
    ]);

    const req = requestAt(reqs, 0);
    expect(req.url).toContain('/v1/customers/search');
    expect(decodeURIComponent(req.url)).toContain("metadata['referenceId']:'org_1'");
  });

  it('reports safe provider diagnostics without copying Stripe prose', async () => {
    const http: HttpClient = async (url) => {
      if (url.includes('/v1/account')) {
        return Response.json({ id: TEST_STRIPE_ACCOUNT_ID, object: 'account' });
      }
      return new Response(
        JSON.stringify({
          error: {
            type: 'invalid_request_error',
            code: 'permission_denied',
            message: 'Provider prose must not enter application-owned errors.',
          },
        }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json', 'Request-Id': 'req_denied' },
        },
      );
    };
    const gateway = createGateway({ secretKey: 'sk_test_x' }, http);

    const failure = await gateway.listCustomers('org_1').catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(/Stripe .*permission.*HTTP 403/);
    expect((failure as Error).message).not.toContain('Provider prose');
  });

  it('reports a safe nested transport code without copying its message', async () => {
    const http: HttpClient = async (url) => {
      if (url.includes('/v1/account')) {
        return Response.json({ id: TEST_STRIPE_ACCOUNT_ID, object: 'account' });
      }
      throw Object.assign(new Error('Transport prose must remain private.'), {
        code: 'ECONNRESET',
      });
    };
    const gateway = createGateway({ secretKey: 'sk_test_x' }, http);

    const failure = await gateway.listCustomers('org_1').catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('ECONNRESET');
    expect((failure as Error).message).not.toContain('Transport prose');
  });

  it('reads the hosted Checkout billing country from the durable customer', async () => {
    const { http } = scriptedHttp([
      { id: 'cus_1', object: 'customer', address: { country: 'US' } },
    ]);
    const gw = createGateway({ secretKey: 'sk_test_x' }, http);

    await expect(gw.getCustomerBillingCountry('cus_1')).resolves.toBe('US');
  });

  it('creates a hosted checkout, mapping price + redirect URLs', async () => {
    const { http, reqs } = scriptedHttp([{ id: 'cs_h', url: 'https://stripe/checkout' }]);
    const gw = createGateway(
      {
        secretKey: 'sk_test_x',
        priceKey: 'price_default',
      },
      http,
    );
    const result = await gw.createCheckoutSession({
      referenceId: 'org_1',
      priceKey: 'price_override',
      successUrl: 'https://app/ok',
      cancelUrl: 'https://app/no',
      customerEmail: 'a@b.com',
      customerId: 'cus_1',
      couponId: 'coupon_student',
      idempotencyKey: 'checkout-attempt-1',
    });
    expect(result).toEqual({ url: 'https://stripe/checkout', sessionId: 'cs_h' });
    const req = requestAt(reqs, 0);
    expect(req.url).toContain('https://api.stripe.com/v1/checkout/sessions');
    expect(req.method).toBe('POST');
    expect(decodeURIComponent(req.body)).toContain('ui_mode=hosted_page');
    expect(decodeURIComponent(req.body)).toContain('price_override');
    expect(decodeURIComponent(req.body)).toContain('trial_period_days]=14');
    expect(decodeURIComponent(req.body)).toContain('referenceId]=org_1');
    expect(decodeURIComponent(req.body)).toContain('customer=cus_1');
    expect(decodeURIComponent(req.body)).toContain('automatic_tax[enabled]=true');
    expect(decodeURIComponent(req.body)).toContain('billing_address_collection=required');
    expect(decodeURIComponent(req.body)).toContain('tax_id_collection[enabled]=true');
    expect(decodeURIComponent(req.body)).toContain('payment_method_collection=always');
    expect(decodeURIComponent(req.body)).toContain('customer_update[address]=auto');
    expect(decodeURIComponent(req.body)).toContain('discounts[0][coupon]=coupon_student');
    expect(decodeURIComponent(req.body)).not.toContain('allow_promotion_codes');
    expect(req.headers.get('idempotency-key')).toBe('checkout-attempt-1');
  });

  it('falls back to the configured price and a custom trial-days override', async () => {
    const { http, reqs } = scriptedHttp([{ id: 'cs_1', url: 'u' }]);
    const gw = createGateway(
      {
        secretKey: 'sk',
        priceKey: 'price_default',
        trialDays: 30,
      },
      http,
    );
    await gw.createCheckoutSession({
      referenceId: 'o',
      priceKey: '',
      successUrl: 's',
      cancelUrl: 'c',
    });
    expect(decodeURIComponent(requestAt(reqs, 0).body)).toContain('price_default');
    expect(decodeURIComponent(requestAt(reqs, 0).body)).toContain('trial_period_days]=30');
  });

  it('omits Stripe trial parameters when the organization already consumed its trial', async () => {
    const { http, reqs } = scriptedHttp([{ id: 'cs_paid', url: 'u' }]);
    const gw = createGateway({ secretKey: 'sk', priceKey: 'price_default' }, http);
    await gw.createCheckoutSession({
      referenceId: 'returning',
      priceKey: 'price_default',
      successUrl: 's',
      cancelUrl: 'c',
      trialDays: 0,
    });
    expect(decodeURIComponent(requestAt(reqs, 0).body)).not.toContain('trial_period_days');
  });

  it('resolves a lookup key to a price id before creating checkout', async () => {
    const { http, reqs } = scriptedHttp([
      list([{ id: 'price_resolved', object: 'price' }]),
      { id: 'cs_2', url: 'u2' },
    ]);
    const gw = createGateway({ secretKey: 'sk' }, http);
    await gw.createCheckoutSession({
      referenceId: 'o',
      priceKey: 'lookup_team', // not a price_ id → triggers prices.list
      successUrl: 's',
      cancelUrl: 'c',
    });
    expect(requestAt(reqs, 0).url).toContain('/v1/prices');
    expect(requestAt(reqs, 0).url).toContain('lookup_keys');
    expect(decodeURIComponent(requestAt(reqs, 1).body)).toContain('price_resolved');
  });

  it('throws a clear error when a lookup key resolves to no price', async () => {
    const { http } = scriptedHttp([list([])]);
    const gw = createGateway({ secretKey: 'sk' }, http);
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
    const gw = createGateway({ secretKey: 'sk', priceKey: 'price_default' }, http);
    const result = await gw.createEmbeddedCheckoutSession({
      referenceId: 'org_1',
      priceKey: 'price_default',
      successUrl: 'https://app/return',
      cancelUrl: 'ignored',
    });
    expect(result).toEqual({ clientSecret: 'cs_secret_123', sessionId: 'cs_e' });
    expect(decodeURIComponent(requestAt(reqs, 0).body)).toContain('ui_mode=embedded_page');
    expect(decodeURIComponent(requestAt(reqs, 0).body)).toContain('return_url=https://app/return');
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
    const gw = createGateway({ secretKey: 'sk' }, http);
    const sub = await gw.getSubscription('org_5');
    expect(sub).toEqual({
      id: 'sub_found',
      referenceId: 'org_5',
      status: 'active',
      currentPeriodEnd: new Date(1_700_000_000 * 1000).toISOString(),
      cancelAtPeriodEnd: false,
    });
    expect(requestAt(reqs, 0).url).toContain('/v1/subscriptions/search');
  });

  it('returns null when no subscription matches', async () => {
    const { http } = scriptedHttp([searchResult([])]);
    const gw = createGateway({ secretKey: 'sk' }, http);
    expect(await gw.getSubscription('none')).toBeNull();
  });

  it('rejects an exact subscription that lacks Docket ownership metadata', async () => {
    const { http } = scriptedHttp([
      {
        id: 'sub_unowned',
        object: 'subscription',
        status: 'active',
        metadata: {},
        items: list([{ current_period_end: 1_700_000_000 }]),
      },
    ]);
    const gw = createGateway({ secretKey: 'sk' }, http);

    await expect(gw.getSubscriptionById('sub_unowned', 'org_claimed')).rejects.toThrow(
      'belongs to another organization',
    );
  });

  it('lists every current subscription so reconciliation can alert on duplicates', async () => {
    const { http, reqs } = scriptedHttp([
      searchResult([
        stripeSub({ id: 'sub_first', referenceId: 'org_duplicate' }),
        stripeSub({ id: 'sub_second', referenceId: 'org_duplicate', status: 'past_due' }),
      ]),
    ]);
    const gw = createGateway({ secretKey: 'sk' }, http);

    const subscriptions = await gw.listSubscriptions('org_duplicate');

    expect(subscriptions.map((subscription) => subscription.id)).toEqual([
      'sub_first',
      'sub_second',
    ]);
    expect(requestAt(reqs, 0).url).toContain('/v1/subscriptions/search');
    expect(requestAt(reqs, 0).url).toContain('limit=10');
  });

  it('cancels the resolved subscription', async () => {
    const { http, reqs } = scriptedHttp([
      searchResult([
        { id: 'sub_cancel', object: 'subscription', status: 'active', items: list([]) },
      ]),
      { id: 'sub_cancel', object: 'subscription', status: 'canceled', items: list([]) },
    ]);
    const gw = createGateway({ secretKey: 'sk' }, http);
    await gw.cancelSubscription('org_1');
    expect(requestAt(reqs, 1).url).toContain('/v1/subscriptions/sub_cancel');
    expect(requestAt(reqs, 1).method).toBe('DELETE');
  });

  it('cancels an exact subscription without a search race', async () => {
    const { http, reqs } = scriptedHttp([
      {
        id: 'sub_exact',
        object: 'subscription',
        status: 'active',
        metadata: { referenceId: 'org_1' },
        items: list([]),
      },
      {
        id: 'sub_exact',
        object: 'subscription',
        status: 'canceled',
        metadata: { referenceId: 'org_1' },
        items: list([]),
      },
    ]);
    const gw = createGateway({ secretKey: 'sk' }, http);

    const canceled = await gw.cancelSubscriptionById('sub_exact', 'org_1', 'country-event-1');

    expect(requestAt(reqs, 0).method).toBe('GET');
    expect(requestAt(reqs, 1).url).toContain('/v1/subscriptions/sub_exact');
    expect(requestAt(reqs, 1).method).toBe('DELETE');
    expect(requestAt(reqs, 1).headers.get('idempotency-key')).toBe('country-event-1');
    expect(canceled).toMatchObject({ id: 'sub_exact', referenceId: 'org_1', status: 'canceled' });
  });

  it('checks exact subscription ownership before sending a cancellation mutation', async () => {
    const { http, reqs } = scriptedHttp([
      {
        id: 'sub_other',
        object: 'subscription',
        status: 'active',
        metadata: { referenceId: 'org_other' },
        items: list([{ current_period_end: 1_700_000_000 }]),
      },
    ]);
    const gw = createGateway({ secretKey: 'sk' }, http);

    await expect(
      gw.cancelSubscriptionById('sub_other', 'org_claimed', 'country-event-wrong-owner'),
    ).rejects.toThrow('belongs to another organization');
    expect(reqs).toHaveLength(1);
    expect(requestAt(reqs, 0).method).toBe('GET');
  });

  it('schedules an exact paid subscription to end after its service period', async () => {
    const { http, reqs } = scriptedHttp([
      {
        id: 'sub_exact',
        object: 'subscription',
        status: 'active',
        metadata: { referenceId: 'org_1' },
        items: list([]),
      },
      {
        id: 'sub_exact',
        object: 'subscription',
        status: 'active',
        metadata: { referenceId: 'org_1' },
        items: list([]),
      },
    ]);
    const gw = createGateway({ secretKey: 'sk' }, http);

    const scheduled = await gw.cancelSubscriptionById(
      'sub_exact',
      'org_1',
      'country-event-2',
      true,
    );

    expect(requestAt(reqs, 0).method).toBe('GET');
    const request = requestAt(reqs, 1);
    expect(request.url).toContain('/v1/subscriptions/sub_exact');
    expect(request.method).toBe('POST');
    expect(decodeURIComponent(request.body)).toContain('cancel_at_period_end=true');
    expect(request.headers.get('idempotency-key')).toBe('country-event-2');
    expect(scheduled).toMatchObject({ id: 'sub_exact', referenceId: 'org_1', status: 'active' });
  });

  it('cancel is a no-op when there is no subscription', async () => {
    const { http, reqs } = scriptedHttp([searchResult([])]);
    const gw = createGateway({ secretKey: 'sk' }, http);
    await gw.cancelSubscription('org_x');
    expect(reqs).toHaveLength(1);
  });

  it('extends a provider trial with an idempotent subscription update', async () => {
    const trialEnd = 1_700_000_000;
    const extendedEnd = trialEnd + 7 * 24 * 60 * 60;
    const { http, reqs } = scriptedHttp([
      searchResult([
        {
          id: 'sub_trial',
          object: 'subscription',
          status: 'trialing',
          metadata: { referenceId: 'org_trial' },
          trial_end: trialEnd,
          items: list([{ current_period_end: trialEnd }]),
        },
      ]),
      {
        id: 'sub_trial',
        object: 'subscription',
        status: 'trialing',
        metadata: { referenceId: 'org_trial' },
        trial_end: extendedEnd,
        items: list([{ current_period_end: extendedEnd }]),
      },
    ]);
    const gw = createGateway({ secretKey: 'sk' }, http);

    const result = await gw.extendTrial('org_trial', 7, 'trial-extension-op');

    expect(result.trialEnd).toBe(new Date(extendedEnd * 1000).toISOString());
    const update = requestAt(reqs, 1);
    expect(update.url).toContain('/v1/subscriptions/sub_trial');
    expect(decodeURIComponent(update.body)).toContain(`trial_end=${String(extendedEnd)}`);
    expect(decodeURIComponent(update.body)).toContain('proration_behavior=none');
    expect(update.headers.get('idempotency-key')).toBe('trial-extension-op');
  });

  it('opens a billing portal session with the configured config id', async () => {
    const { http, reqs } = scriptedHttp([{ id: 'bps_1', url: 'https://portal' }]);
    const gw = createGateway({ secretKey: 'sk', portalConfigId: 'bpc_1' }, http);
    const result = await gw.createBillingPortalSession({
      customerId: 'cus_1',
      returnUrl: 'https://app.example/orgs/org_1/settings/billing',
    });
    expect(result).toEqual({ url: 'https://portal' });
    const req = requestAt(reqs, 0);
    expect(req.url).toContain('/v1/billing_portal/sessions');
    expect(decodeURIComponent(req.body)).toContain('customer=cus_1');
    expect(decodeURIComponent(req.body)).toContain('configuration=bpc_1');
    expect(decodeURIComponent(req.body)).toContain(
      'return_url=https://app.example/orgs/org_1/settings/billing',
    );
  });

  it('creates a product-scoped repeating coupon with provider idempotency', async () => {
    const { http, reqs } = scriptedHttp([
      { id: 'price_pro', object: 'price', product: 'prod_pro' },
      { id: 'coupon_student', object: 'coupon' },
    ]);
    const gw = createGateway({ secretKey: 'sk' }, http);

    await expect(
      gw.createDiscountCoupon({
        awardId: 'award_1',
        name: 'Student discount',
        percentOff: 50,
        priceKey: 'price_pro',
        idempotencyKey: 'award-1-coupon',
      }),
    ).resolves.toEqual({ id: 'coupon_student' });

    const create = requestAt(reqs, 1);
    expect(create.url).toContain('/v1/coupons');
    expect(decodeURIComponent(create.body)).toContain('percent_off=50');
    expect(decodeURIComponent(create.body)).toContain('duration=forever');
    expect(decodeURIComponent(create.body)).not.toContain('duration_in_months');
    expect(decodeURIComponent(create.body)).toContain('applies_to[products][0]=prod_pro');
    expect(decodeURIComponent(create.body)).toContain('metadata[awardId]=award_1');
    expect(create.headers.get('idempotency-key')).toBe('award-1-coupon');
  });

  it('applies a coupon to an existing subscription without proration', async () => {
    const { http, reqs } = scriptedHttp([
      searchResult([
        { id: 'sub_discount', object: 'subscription', status: 'active', items: list([]) },
      ]),
      {
        id: 'sub_discount',
        object: 'subscription',
        status: 'active',
        discounts: [{ id: 'di_1' }],
        items: list([]),
      },
    ]);
    const gw = createGateway({ secretKey: 'sk' }, http);

    await expect(
      gw.applySubscriptionDiscount({
        referenceId: 'org_1',
        couponId: 'coupon_student',
        idempotencyKey: 'award-1-apply',
      }),
    ).resolves.toEqual({ discountId: 'di_1' });

    const update = requestAt(reqs, 1);
    expect(decodeURIComponent(update.body)).toContain('discounts[0][coupon]=coupon_student');
    expect(decodeURIComponent(update.body)).toContain('proration_behavior=none');
    expect(update.headers.get('idempotency-key')).toBe('award-1-apply');
  });

  it('removes a subscription discount with provider idempotency', async () => {
    const { http, reqs } = scriptedHttp([
      searchResult([
        { id: 'sub_discount', object: 'subscription', status: 'active', items: list([]) },
      ]),
      { id: 'di_1', object: 'discount', deleted: true },
    ]);
    const gw = createGateway({ secretKey: 'sk' }, http);

    await gw.removeSubscriptionDiscount('org_1', 'award-1-remove');

    const remove = requestAt(reqs, 1);
    expect(remove.url).toContain('/v1/subscriptions/sub_discount/discount');
    expect(remove.method).toBe('DELETE');
    expect(remove.headers.get('idempotency-key')).toBe('award-1-remove');
  });

  it('previews and issues a tax-aware invoice-line credit', async () => {
    const { http, reqs } = scriptedHttp([
      {
        object: 'credit_note',
        amount: 218,
        total: 218,
        subtotal: 200,
        pre_payment_amount: 0,
        post_payment_amount: 218,
        tax_amounts: [{ amount: 18 }],
      },
      {
        id: 'cn_1',
        object: 'credit_note',
        amount: 218,
        total: 218,
        subtotal: 200,
        pre_payment_amount: 0,
        post_payment_amount: 218,
        tax_amounts: [{ amount: 18 }],
      },
    ]);
    const gw = createGateway({ secretKey: 'sk' }, http);

    await expect(
      gw.previewCreditNote({ invoiceId: 'in_1', invoiceLineId: 'il_1', baseAmount: 200 }),
    ).resolves.toEqual({
      baseAmount: 200,
      taxAmount: 18,
      totalAmount: 218,
      prePaymentAmount: 0,
      postPaymentAmount: 218,
    });
    await expect(
      gw.issueCreditNote({
        invoiceId: 'in_1',
        invoiceLineId: 'il_1',
        baseAmount: 200,
        creditAmount: 218,
        idempotencyKey: 'credit-1',
        memo: 'Student discount effective 2026-08-16',
      }),
    ).resolves.toMatchObject({ id: 'cn_1', totalAmount: 218 });

    expect(requestAt(reqs, 0).url).toContain('/v1/credit_notes/preview');
    const issue = requestAt(reqs, 1);
    expect(issue.url).toContain('/v1/credit_notes');
    expect(decodeURIComponent(issue.body)).toContain('lines[0][invoice_line_item]=il_1');
    expect(decodeURIComponent(issue.body)).toContain('lines[0][amount]=200');
    expect(decodeURIComponent(issue.body)).toContain('credit_amount=218');
    expect(issue.headers.get('idempotency-key')).toBe('credit-1');
  });

  it('reads the latest paid recurring invoice line for credit calculation', async () => {
    const { http } = scriptedHttp([
      searchResult([
        { id: 'sub_invoice', object: 'subscription', status: 'active', items: list([]) },
      ]),
      list([
        {
          id: 'in_1',
          object: 'invoice',
          status: 'paid',
          currency: 'usd',
          lines: list([
            {
              id: 'il_setup_fee',
              object: 'line_item',
              amount: 2_500,
              pricing: { price_details: { price: 'price_setup' } },
              period: { start: 1_700_000_000, end: 1_700_000_000 },
            },
            {
              id: 'il_proration',
              object: 'line_item',
              amount: 400,
              pricing: { price_details: { price: 'price_docket_pro' } },
              parent: {
                type: 'subscription_item_details',
                subscription_item_details: { proration: true },
              },
              period: { start: 1_701_000_000, end: 1_702_678_400 },
            },
            {
              id: 'il_1',
              object: 'line_item',
              amount: 800,
              pricing: { price_details: { price: 'price_docket_pro' } },
              parent: {
                type: 'subscription_item_details',
                subscription_item_details: { proration: false },
              },
              period: { start: 1_700_000_000, end: 1_702_678_400 },
            },
          ]),
        },
      ]),
    ]);
    const gw = createGateway({ secretKey: 'sk', priceKey: 'price_docket_pro' }, http);

    await expect(gw.getLatestRecurringInvoice('org_1')).resolves.toEqual({
      invoiceId: 'in_1',
      lineId: 'il_1',
      invoiceStatus: 'paid',
      currency: 'usd',
      recurringAmount: 800,
      periodStartsAt: new Date(1_700_000_000 * 1000).toISOString(),
      periodEndsAt: new Date(1_702_678_400 * 1000).toISOString(),
    });
  });

  it('honors a custom apiBase override (stripe-mock)', async () => {
    const { http, reqs } = scriptedHttp([{ id: 'bps_2', url: 'https://portal' }]);
    const gw = createGateway(
      {
        secretKey: 'sk',
        apiBase: 'http://localhost:12111',
      },
      http,
    );
    await gw.createBillingPortalSession({ customerId: 'cus_2', returnUrl: 'https://app/return' });
    expect(requestAt(reqs, 0).url).toContain('http://localhost:12111/v1/billing_portal/sessions');
  });
});
