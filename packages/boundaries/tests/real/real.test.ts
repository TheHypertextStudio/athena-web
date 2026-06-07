import { afterEach, describe, expect, it } from 'vitest';

import type { SessionActivity } from '../../src/ports/agent-runtime';
import { RealProviderRuntime } from '../../src/real/agent-runtime';
import { RealStripeGateway } from '../../src/real/billing';
import { RealBlob } from '../../src/real/blob';
import { RealConnector } from '../../src/real/connector';
import { defaultHttpClient, type HttpClient } from '../../src/real/http';
import { RealMailer } from '../../src/real/mailer';

/** One recorded HTTP call: the URL and the (optional) request init. */
interface RecordedCall {
  readonly url: string;
  readonly init?: RequestInit;
}

/** A fake {@link HttpClient} that records calls and returns scripted responses. */
function fakeHttp(responses: Response[] | ((call: RecordedCall) => Response)): {
  http: HttpClient;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  let index = 0;
  const http: HttpClient = async (url, init) => {
    calls.push({ url, ...(init ? { init } : {}) });
    if (typeof responses === 'function') return responses({ url, ...(init ? { init } : {}) });
    const res = responses[index];
    index += 1;
    if (!res) throw new Error(`fakeHttp: no scripted response for call #${index}`);
    return res;
  };
  return { http, calls };
}

/** Read a recorded request body that is known to be a string. */
function bodyText(call: RecordedCall): string {
  return call.init?.body as string;
}

/** Read one header value off a recorded request's headers record. */
function header(call: RecordedCall, name: string): string | undefined {
  return (call.init?.headers as Record<string, string>)[name];
}

/** Fully consume an async iterable, collecting nothing (used to surface stream errors). */
async function drain<T>(iterable: AsyncIterable<T>): Promise<void> {
  for await (const item of iterable) {
    void item;
  }
}

/** Build a streaming `Response` whose body yields `chunks` as UTF-8 bytes. */
function streamResponse(chunks: string[], init?: ResponseInit): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, init);
}

describe('RealStripeGateway', () => {
  it('shapes a checkout request and maps the response', async () => {
    const { http, calls } = fakeHttp([
      new Response(JSON.stringify({ id: 'cs_123', url: 'https://stripe/checkout' }), {
        status: 200,
      }),
    ]);
    const gw = new RealStripeGateway({ secretKey: 'sk_test_1', priceKey: 'price_default' }, http);
    const result = await gw.createCheckoutSession({
      referenceId: 'org_1',
      priceKey: 'price_override',
      successUrl: 'https://app/ok',
      cancelUrl: 'https://app/no',
      customerEmail: 'a@b.com',
      trialDays: 14,
    });
    expect(result).toEqual({ url: 'https://stripe/checkout', sessionId: 'cs_123' });
    const call = calls[0]!;
    expect(call.url).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect(call.init?.method).toBe('POST');
    expect(header(call, 'Authorization')).toBe('Bearer sk_test_1');
    expect(header(call, 'Content-Type')).toBe('application/x-www-form-urlencoded');
    const body = bodyText(call);
    expect(body).toContain('line_items%5B0%5D%5Bprice%5D=price_override');
    expect(body).toContain('customer_email=a%40b.com');
    expect(body).toContain('subscription_data%5Btrial_period_days%5D=14');
  });

  it('falls back to the configured price key when none is supplied', async () => {
    const { http, calls } = fakeHttp([
      new Response(JSON.stringify({ id: 'cs_1', url: 'u' }), { status: 200 }),
    ]);
    const gw = new RealStripeGateway({ secretKey: 'sk', priceKey: 'price_default' }, http);
    await gw.createCheckoutSession({
      referenceId: 'o',
      priceKey: '',
      successUrl: 's',
      cancelUrl: 'c',
    });
    expect(bodyText(calls[0]!)).toContain('price_default');
  });

  it('throws when no price key is configured for checkout', async () => {
    const { http } = fakeHttp([]);
    const gw = new RealStripeGateway({ secretKey: 'sk' }, http);
    await expect(
      gw.createCheckoutSession({ referenceId: 'o', priceKey: '', successUrl: 's', cancelUrl: 'c' }),
    ).rejects.toThrow(/no price key configured/);
  });

  it('throws when the Stripe API returns a non-2xx status', async () => {
    const { http } = fakeHttp([new Response('nope', { status: 402 })]);
    const gw = new RealStripeGateway({ secretKey: 'sk', priceKey: 'p' }, http);
    await expect(
      gw.createCheckoutSession({
        referenceId: 'o',
        priceKey: 'p',
        successUrl: 's',
        cancelUrl: 'c',
      }),
    ).rejects.toThrow(/Stripe API POST \/v1\/checkout\/sessions failed: 402/);
  });

  it('maps each Stripe subscription status onto the port status', async () => {
    const cases: { stripe: string; mapped: string }[] = [
      { stripe: 'trialing', mapped: 'trialing' },
      { stripe: 'active', mapped: 'active' },
      { stripe: 'past_due', mapped: 'past_due' },
      { stripe: 'unpaid', mapped: 'past_due' },
      { stripe: 'incomplete', mapped: 'past_due' },
      { stripe: 'something_else', mapped: 'canceled' },
    ];
    for (const c of cases) {
      const { http } = fakeHttp([
        new Response(
          JSON.stringify({
            data: [{ id: 'sub_1', status: c.stripe, current_period_end: 1_700_000_000 }],
          }),
          { status: 200 },
        ),
      ]);
      const gw = new RealStripeGateway({ secretKey: 'sk' }, http);
      const sub = await gw.getSubscription('org_1');
      expect(sub?.status).toBe(c.mapped);
    }
  });

  it('includes trialEnd only when Stripe returns a trial_end', async () => {
    const { http } = fakeHttp([
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'sub_1',
              status: 'trialing',
              current_period_end: 1_700_000_000,
              trial_end: 1_701_000_000,
            },
          ],
        }),
        { status: 200 },
      ),
    ]);
    const gw = new RealStripeGateway({ secretKey: 'sk' }, http);
    const sub = await gw.getSubscription('org_1');
    expect(sub?.id).toBe('sub_1');
    expect(sub?.currentPeriodEnd).toBe(new Date(1_700_000_000 * 1000).toISOString());
    expect(sub?.trialEnd).toBe(new Date(1_701_000_000 * 1000).toISOString());
  });

  it('omits trialEnd when trial_end is null and queries via GET', async () => {
    const { http, calls } = fakeHttp([
      new Response(
        JSON.stringify({
          data: [
            { id: 'sub_2', status: 'active', current_period_end: 1_700_000_000, trial_end: null },
          ],
        }),
        { status: 200 },
      ),
    ]);
    const gw = new RealStripeGateway({ secretKey: 'sk' }, http);
    const sub = await gw.getSubscription('org_2');
    expect(sub?.trialEnd).toBeUndefined();
    expect(calls[0]!.init?.method).toBe('GET');
    expect(calls[0]!.url).toContain('/v1/subscriptions?');
  });

  it('returns null when no subscription is found (missing data array)', async () => {
    const { http } = fakeHttp([new Response(JSON.stringify({}), { status: 200 })]);
    const gw = new RealStripeGateway({ secretKey: 'sk' }, http);
    expect(await gw.getSubscription('none')).toBeNull();
  });

  it('returns null when the data array is empty', async () => {
    const { http } = fakeHttp([new Response(JSON.stringify({ data: [] }), { status: 200 })]);
    const gw = new RealStripeGateway({ secretKey: 'sk' }, http);
    expect(await gw.getSubscription('none')).toBeNull();
  });

  it('cancels by deleting the resolved subscription', async () => {
    const { http, calls } = fakeHttp([
      new Response(
        JSON.stringify({
          data: [{ id: 'sub_9', status: 'active', current_period_end: 1_700_000_000 }],
        }),
        { status: 200 },
      ),
      new Response(JSON.stringify({ deleted: true }), { status: 200 }),
    ]);
    const gw = new RealStripeGateway({ secretKey: 'sk' }, http);
    await gw.cancelSubscription('org_1');
    expect(calls[1]!.url).toBe('https://api.stripe.com/v1/subscriptions/sub_9');
    expect(calls[1]!.init?.method).toBe('DELETE');
  });

  it('cancel is a no-op when there is no current subscription', async () => {
    const { http, calls } = fakeHttp([new Response(JSON.stringify({ data: [] }), { status: 200 })]);
    const gw = new RealStripeGateway({ secretKey: 'sk' }, http);
    await gw.cancelSubscription('org_x');
    expect(calls).toHaveLength(1);
  });

  it('opens a billing portal session with the configured portal config id', async () => {
    const { http, calls } = fakeHttp([
      new Response(JSON.stringify({ url: 'https://portal' }), { status: 200 }),
    ]);
    const gw = new RealStripeGateway({ secretKey: 'sk', portalConfigId: 'bpc_1' }, http);
    const result = await gw.createBillingPortalSession('cus_1');
    expect(result).toEqual({ url: 'https://portal' });
    const body = bodyText(calls[0]!);
    expect(body).toContain('customer=cus_1');
    expect(body).toContain('configuration=bpc_1');
  });

  it('honors a custom apiBase', async () => {
    const { http, calls } = fakeHttp([
      new Response(JSON.stringify({ id: 'cs', url: 'u' }), { status: 200 }),
    ]);
    const gw = new RealStripeGateway(
      { secretKey: 'sk', priceKey: 'p', apiBase: 'https://stripe-mock.local' },
      http,
    );
    await gw.createCheckoutSession({
      referenceId: 'o',
      priceKey: 'p',
      successUrl: 's',
      cancelUrl: 'c',
    });
    expect(calls[0]!.url).toBe('https://stripe-mock.local/v1/checkout/sessions');
  });
});

describe('RealProviderRuntime', () => {
  it('posts the input and yields NDJSON activities across chunk boundaries', async () => {
    const activities: SessionActivity[] = [
      { type: 'thought', body: 'thinking' },
      { type: 'response', body: 'done' },
    ];
    // Split a newline across two chunks, and leave a no-trailing-newline tail.
    const second = JSON.stringify(activities[1]);
    const { http, calls } = fakeHttp([
      streamResponse([`${JSON.stringify(activities[0])}\n${second.slice(0, 5)}`, second.slice(5)], {
        status: 200,
      }),
    ]);
    const runtime = new RealProviderRuntime({ endpoint: 'https://runtime', apiKey: 'k' }, http);
    const out: SessionActivity[] = [];
    for await (const a of runtime.startSession({ sessionId: 's', task: 't', agent: 'athena' }))
      out.push(a);
    expect(out).toEqual(activities);
    const call = calls[0]!;
    expect(call.url).toBe('https://runtime');
    expect(call.init?.method).toBe('POST');
    expect(header(call, 'Authorization')).toBe('Bearer k');
    expect(JSON.parse(bodyText(call))).toEqual({ sessionId: 's', task: 't', agent: 'athena' });
  });

  it('skips blank lines and yields a trailing activity without a newline', async () => {
    const { http } = fakeHttp([
      streamResponse([`\n${JSON.stringify({ type: 'response', body: 'only' })}`], { status: 200 }),
    ]);
    const runtime = new RealProviderRuntime({ endpoint: 'https://r', apiKey: 'k' }, http);
    const out: SessionActivity[] = [];
    for await (const a of runtime.startSession({ sessionId: 's', task: 't', agent: 'a' }))
      out.push(a);
    expect(out).toEqual([{ type: 'response', body: 'only' }]);
  });

  it('does not yield a tail when the buffer ends empty', async () => {
    const { http } = fakeHttp([
      streamResponse([`${JSON.stringify({ type: 'thought', body: 'x' })}\n`], { status: 200 }),
    ]);
    const runtime = new RealProviderRuntime({ endpoint: 'https://r', apiKey: 'k' }, http);
    const out: SessionActivity[] = [];
    for await (const a of runtime.startSession({ sessionId: 's', task: 't', agent: 'a' }))
      out.push(a);
    expect(out).toEqual([{ type: 'thought', body: 'x' }]);
  });

  it('throws when the runtime returns a non-2xx status', async () => {
    const { http } = fakeHttp([new Response('err', { status: 500 })]);
    const runtime = new RealProviderRuntime({ endpoint: 'https://r', apiKey: 'k' }, http);
    await expect(
      drain(runtime.startSession({ sessionId: 's', task: 't', agent: 'a' })),
    ).rejects.toThrow(/Agent runtime failed: 500/);
  });

  it('throws when the response has no body', async () => {
    const { http } = fakeHttp([new Response(null, { status: 200 })]);
    const runtime = new RealProviderRuntime({ endpoint: 'https://r', apiKey: 'k' }, http);
    await expect(
      drain(runtime.startSession({ sessionId: 's', task: 't', agent: 'a' })),
    ).rejects.toThrow(/Agent runtime failed/);
  });
});

describe('RealConnector', () => {
  it('defaults the API base per provider and connects with the identity login', async () => {
    const { http, calls } = fakeHttp([
      new Response(JSON.stringify({ login: 'octocat' }), { status: 200 }),
    ]);
    const connector = new RealConnector({ provider: 'github', accessToken: 'tok' }, http);
    const result = await connector.connect({ provider: 'github', referenceId: 'org_1' });
    expect(result).toEqual({
      connectionId: 'github:org_1',
      provider: 'github',
      status: 'connected',
      account: 'octocat',
    });
    const call = calls[0]!;
    expect(call.url).toBe('https://api.github.com/user');
    expect(header(call, 'Authorization')).toBe('Bearer tok');
    expect(header(call, 'Accept')).toBe('application/json');
  });

  it('falls back to name when login is absent', async () => {
    const { http } = fakeHttp([
      new Response(JSON.stringify({ name: 'Octo Cat' }), { status: 200 }),
    ]);
    const connector = new RealConnector({ provider: 'linear', accessToken: 'tok' }, http);
    const result = await connector.connect({ provider: 'linear', referenceId: 'org_1' });
    expect(result.account).toBe('Octo Cat');
    expect(result.status).toBe('connected');
  });

  it('reports an error status when the identity call fails', async () => {
    const { http } = fakeHttp([new Response('forbidden', { status: 401 })]);
    const connector = new RealConnector({ provider: 'github', accessToken: 'bad' }, http);
    const result = await connector.connect({ provider: 'github', referenceId: 'org_1' });
    expect(result.status).toBe('error');
    expect(result).not.toHaveProperty('account');
  });

  it('connects with no account when the identity has neither login nor name', async () => {
    const { http } = fakeHttp([new Response(JSON.stringify({}), { status: 200 })]);
    const connector = new RealConnector({ provider: 'drive', accessToken: 'tok' }, http);
    const result = await connector.connect({ provider: 'drive', referenceId: 'org_1' });
    expect(result.status).toBe('connected');
    expect(result).not.toHaveProperty('account');
  });

  it('imports issues with provenance, including url and body when present', async () => {
    const { http } = fakeHttp([
      new Response(
        JSON.stringify({ items: [{ id: 'i1', title: 'T', body: 'B', url: 'https://x/1' }] }),
        { status: 200 },
      ),
    ]);
    const connector = new RealConnector({ provider: 'github', accessToken: 'tok' }, http);
    const items = await connector.importWork({ connectionId: 'c1', provider: 'github' });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: 'i1',
      kind: 'issue',
      title: 'T',
      body: 'B',
      provenance: { provider: 'github', externalId: 'i1', externalUrl: 'https://x/1' },
    });
    expect(items[0]?.provenance.importedAt).toMatch(/Z$/);
  });

  it('imports issues omitting body and url when absent, and tolerates a missing items array', async () => {
    const { http } = fakeHttp([
      new Response(JSON.stringify({ items: [{ id: 'i2', title: 'T2' }] }), { status: 200 }),
      new Response(JSON.stringify({}), { status: 200 }),
    ]);
    const connector = new RealConnector({ provider: 'github', accessToken: 'tok' }, http);
    const withItem = await connector.importWork({ connectionId: 'c1', provider: 'github' });
    expect(withItem[0]).not.toHaveProperty('body');
    expect(withItem[0]?.provenance).not.toHaveProperty('externalUrl');
    const empty = await connector.importWork({ connectionId: 'c1', provider: 'github' });
    expect(empty).toEqual([]);
  });

  it('throws when an import API call fails', async () => {
    const { http } = fakeHttp([new Response('boom', { status: 503 })]);
    const connector = new RealConnector({ provider: 'github', accessToken: 'tok' }, http);
    await expect(connector.importWork({ connectionId: 'c1', provider: 'github' })).rejects.toThrow(
      /github API \/issues failed: 503/,
    );
  });

  it('reports mirror status with lastSyncedAt and itemCount', async () => {
    const { http } = fakeHttp([
      new Response(JSON.stringify({ itemCount: 5, lastSyncedAt: '2026-01-01T00:00:00.000Z' }), {
        status: 200,
      }),
    ]);
    const connector = new RealConnector({ provider: 'linear', accessToken: 'tok' }, http);
    const status = await connector.mirrorStatus({ connectionId: 'c1', provider: 'linear' });
    expect(status).toEqual({
      connectionId: 'c1',
      status: 'idle',
      lastSyncedAt: '2026-01-01T00:00:00.000Z',
      itemCount: 5,
    });
  });

  it('defaults itemCount to 0 and omits lastSyncedAt when absent', async () => {
    const { http } = fakeHttp([new Response(JSON.stringify({}), { status: 200 })]);
    const connector = new RealConnector({ provider: 'linear', accessToken: 'tok' }, http);
    const status = await connector.mirrorStatus({ connectionId: 'c1', provider: 'linear' });
    expect(status.itemCount).toBe(0);
    expect(status).not.toHaveProperty('lastSyncedAt');
  });

  it('links a resource without I/O', async () => {
    const { http, calls } = fakeHttp([]);
    const connector = new RealConnector({ provider: 'github', accessToken: 'tok' }, http);
    const link = await connector.linkResource({
      connectionId: 'c1',
      provider: 'github',
      resourceId: 'r1',
      externalId: 'e1',
    });
    expect(link).toEqual({ resourceId: 'r1', externalId: 'e1', linked: true });
    expect(calls).toHaveLength(0);
  });

  it('honors a custom apiBase', async () => {
    const { http, calls } = fakeHttp([
      new Response(JSON.stringify({ login: 'x' }), { status: 200 }),
    ]);
    const connector = new RealConnector(
      { provider: 'github', accessToken: 'tok', apiBase: 'https://ghe.local/api' },
      http,
    );
    await connector.connect({ provider: 'github', referenceId: 'o' });
    expect(calls[0]!.url).toBe('https://ghe.local/api/user');
  });
});

describe('RealMailer', () => {
  it('posts a message merged with the from-address', async () => {
    const { http, calls } = fakeHttp([new Response(null, { status: 202 })]);
    const mailer = new RealMailer(
      { endpoint: 'https://mail', apiKey: 'k', from: 'no-reply@docket.dev' },
      http,
    );
    await mailer.send({ to: 'a@b.com', subject: 'Hi', text: 'body', html: '<p>body</p>' });
    const call = calls[0]!;
    expect(call.url).toBe('https://mail');
    expect(call.init?.method).toBe('POST');
    expect(header(call, 'Authorization')).toBe('Bearer k');
    expect(header(call, 'Content-Type')).toBe('application/json');
    expect(JSON.parse(bodyText(call))).toEqual({
      from: 'no-reply@docket.dev',
      to: 'a@b.com',
      subject: 'Hi',
      text: 'body',
      html: '<p>body</p>',
    });
  });

  it('throws when the provider rejects the send', async () => {
    const { http } = fakeHttp([new Response('bad', { status: 400 })]);
    const mailer = new RealMailer(
      { endpoint: 'https://mail', apiKey: 'k', from: 'f@docket.dev' },
      http,
    );
    await expect(mailer.send({ to: 'a@b.com', subject: 'S', text: 'b' })).rejects.toThrow(
      /RealMailer send failed: 400/,
    );
  });
});

describe('RealBlob', () => {
  it('puts bytes with the default content type and returns the addressed url', async () => {
    const { http, calls } = fakeHttp([new Response(null, { status: 200 })]);
    const blob = new RealBlob({ baseUrl: 'https://store.example.com/', token: 'tok' }, http);
    const data = new TextEncoder().encode('hello');
    const result = await blob.put('exports/a.txt', data);
    expect(result).toEqual({
      key: 'exports/a.txt',
      url: 'https://store.example.com/exports/a.txt',
    });
    const call = calls[0]!;
    expect(call.url).toBe('https://store.example.com/exports/a.txt');
    expect(call.init?.method).toBe('PUT');
    expect(header(call, 'Authorization')).toBe('Bearer tok');
    expect(header(call, 'Content-Type')).toBe('application/octet-stream');
    expect(call.init?.body).toBe(data);
  });

  it('puts bytes with an explicit content type', async () => {
    const { http, calls } = fakeHttp([new Response(null, { status: 201 })]);
    const blob = new RealBlob({ baseUrl: 'https://store.example.com', token: 'tok' }, http);
    await blob.put('a.json', new Uint8Array([1]), 'application/json');
    expect(header(calls[0]!, 'Content-Type')).toBe('application/json');
  });

  it('throws when put fails', async () => {
    const { http } = fakeHttp([new Response('no', { status: 403 })]);
    const blob = new RealBlob({ baseUrl: 'https://store', token: 'tok' }, http);
    await expect(blob.put('a.txt', new Uint8Array([1]))).rejects.toThrow(
      /RealBlob put failed: 403/,
    );
  });

  it('gets bytes for an existing key', async () => {
    const { http, calls } = fakeHttp([new Response(new Uint8Array([1, 2, 3]), { status: 200 })]);
    const blob = new RealBlob({ baseUrl: 'https://store', token: 'tok' }, http);
    const got = await blob.get('a.bin');
    expect(got && Array.from(got)).toEqual([1, 2, 3]);
    expect(header(calls[0]!, 'Authorization')).toBe('Bearer tok');
  });

  it('returns null for a 404', async () => {
    const { http } = fakeHttp([new Response('missing', { status: 404 })]);
    const blob = new RealBlob({ baseUrl: 'https://store', token: 'tok' }, http);
    expect(await blob.get('missing')).toBeNull();
  });

  it('throws on a non-404 error status for get', async () => {
    const { http } = fakeHttp([new Response('err', { status: 500 })]);
    const blob = new RealBlob({ baseUrl: 'https://store', token: 'tok' }, http);
    await expect(blob.get('a')).rejects.toThrow(/RealBlob get failed: 500/);
  });

  it('addresses a key, trimming leading slashes and trailing base slashes', () => {
    const blob = new RealBlob({ baseUrl: 'https://store.example.com///', token: 'tok' });
    expect(blob.url('/nested/key.txt')).toBe('https://store.example.com/nested/key.txt');
  });
});

describe('defaultHttpClient', () => {
  const original = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = original;
  });

  it('delegates to globalThis.fetch when present', async () => {
    const calls: { input: string; init?: RequestInit }[] = [];
    globalThis.fetch = (async (input: string, init?: RequestInit) => {
      calls.push({ input, ...(init ? { init } : {}) });
      return new Response('ok', { status: 200 });
    }) as typeof fetch;
    const res = await defaultHttpClient('https://x', { method: 'GET' });
    expect(await res.text()).toBe('ok');
    expect(calls[0]?.input).toBe('https://x');
    expect(calls[0]?.init?.method).toBe('GET');
  });

  it('throws when no global fetch is available', () => {
    // @ts-expect-error — deliberately removing fetch to hit the guard.
    globalThis.fetch = undefined;
    expect(() => defaultHttpClient('https://x')).toThrow(/No global fetch available/);
  });
});
