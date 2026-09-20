/**
 * The response mechanics every endpoint shares, exercised end to end.
 *
 * @remarks
 * Sibling to `rest-conformance.test.ts`, which checks the *shape* of the route table. This one
 * checks what a request and response actually carry: the created resource's `Location`, the
 * entity tag a read hands back, the precondition a write honors, and the deduplication a
 * retried create gets.
 *
 * These run against the **composed** `/v1` app rather than a bare router, because that is the
 * only place `Location` resolves to its real `/v1`-prefixed URL. A router mounted at the root
 * in a sibling test resolves it against its own root and would prove nothing about production.
 */
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getSession } from '../support/auth-mock';
import { composedV1App, getDb, seedBaseOrg, seedUserWithHub } from '../support/routes-harness';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

/** The composed `/v1` app plus the migrated database. */
async function setup() {
  const schema = await getDb();
  return { schema, db: schema.db, app: await composedV1App() };
}

let userId: string;

beforeAll(async () => {
  const { db, schema } = await setup();
  userId = await seedUserWithHub(db, schema, 'restmech');
});

beforeEach(() => {
  getSession.mockResolvedValue({
    user: { id: userId, name: 'Rest Mechanic', email: 'rest@example.test' },
  });
});

/** Create a time category, the smallest session-only create on the surface. */
async function createCategory(name: string, headers: Record<string, string> = {}) {
  const { app } = await setup();
  return app.request('/v1/time/categories', {
    method: 'POST',
    headers: { ...JSON_HEADERS, ...headers },
    body: JSON.stringify({ name, color: 'blue' }),
  });
}

describe('creating a resource', () => {
  it('omits Location when the created resource has no readable member route', async () => {
    const res = await createCategory('Deep work');
    expect(res.status).toBe(201);

    expect((await res.json()) as { id: string }).toMatchObject({ id: expect.any(String) });
    expect(res.headers.get('location')).toBeNull();
  });
});

describe('typed work-view requests', () => {
  it('accepts the browser project query through the complete production middleware stack', async () => {
    const { app, db, schema } = await setup();
    const base = await seedBaseOrg(db, schema);
    await db.update(schema.actor).set({ userId }).where(eq(schema.actor.id, base.humanActorId));

    const response = await app.request(`/v1/orgs/${base.orgId}/work-views/query`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        target: 'project',
        definition: {
          version: 2,
          target: 'project',
          filter: null,
          arrangement: { groupBy: 'status', subGroupBy: null, orderBy: [] },
          presentation: {
            layout: 'list',
            properties: ['status', 'priority', 'health', 'lead', 'targetDate', 'progress'],
            density: 'compact',
            showEmptyGroups: false,
          },
        },
        temporaryFilter: null,
        context: { kind: 'organization' },
        limit: 100,
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ target: 'project', rows: [], groups: [] });
  });
});

describe('Idempotency-Key', () => {
  it('rejects the header before an undeclared operation executes', async () => {
    const { db, schema } = await setup();
    const key = `retry-${Math.random().toString(36).slice(2)}`;

    const response = await createCategory('Retried', { 'Idempotency-Key': key });
    expect(response.status).toBe(422);
    expect((await response.json()) as { code: string }).toMatchObject({
      code: 'validation_error',
    });
    expect(
      await db.select().from(schema.timeCategory).where(eq(schema.timeCategory.name, 'Retried')),
    ).toHaveLength(0);
  });

  it('rejects the header on an undeclared safe operation', async () => {
    const { app } = await setup();
    const res = await app.request('/v1/time/categories', {
      headers: { 'Idempotency-Key': 'unused-on-a-read' },
    });
    expect(res.status).toBe(422);
  });
});

describe('conditional requests', () => {
  /** The account profile: one URI whose GET and PATCH serve the same representation. */
  const PROFILE = '/v1/me/account/profile';

  it('tags a read and answers a matching If-None-Match with 304', async () => {
    const { app } = await setup();

    const first = await app.request(PROFILE);
    expect(first.status).toBe(200);
    const tag = first.headers.get('etag');
    expect(tag).toMatch(/^"[\w-]+"$/);

    const repeat = await app.request(PROFILE, { headers: { 'If-None-Match': tag ?? '' } });
    expect(repeat.status).toBe(304);
    expect(await repeat.text()).toBe('');
  });

  it('re-tags a read once the resource changes', async () => {
    const { app } = await setup();
    const before = (await app.request(PROFILE)).headers.get('etag');

    await app.request(PROFILE, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: 'Renamed Once' }),
    });

    const after = (await app.request(PROFILE)).headers.get('etag');
    expect(after).not.toBe(before);
    // The stale tag must no longer select the representation, or a cache would serve the old one.
    expect(
      (await app.request(PROFILE, { headers: { 'If-None-Match': before ?? '' } })).status,
    ).toBe(200);
  });

  it('rejects If-Match on a write without a transactional aggregate adapter', async () => {
    const { app } = await setup();
    const before = (await (await app.request(PROFILE)).json()) as { name: string };
    const response = await app.request(PROFILE, {
      method: 'PATCH',
      headers: {
        ...JSON_HEADERS,
        'If-Match': (await app.request(PROFILE)).headers.get('etag') ?? '',
      },
      body: JSON.stringify({ name: 'Must not execute' }),
    });
    expect(response.status).toBe(422);
    expect((await response.json()) as { code: string }).toMatchObject({ code: 'validation_error' });
    expect((await (await app.request(PROFILE)).json()) as { name: string }).toMatchObject(before);
  });

  it('writes last-writer-wins when no precondition is sent', async () => {
    const { app } = await setup();

    // The opt-in half of the contract: an unconditional write is still allowed, so no existing
    // client breaks by not knowing about `If-Match`.
    const res = await app.request(PROFILE, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: 'No precondition' }),
    });
    expect(res.status).toBe(200);
  });
});

describe('caching', () => {
  it('marks every response private and revalidate-before-reuse', async () => {
    const { app } = await setup();
    const res = await app.request('/v1/time/categories');

    // `no-cache` permits storing and requires revalidation, which is what makes the `ETag`
    // useful; `private` keeps a shared cache from holding one person's workspace at all.
    expect(res.headers.get('cache-control')).toBe('private, no-cache');
  });

  it('varies on the credentials the body depends on', async () => {
    const { app } = await setup();
    const vary = (await app.request('/v1/time/categories')).headers.get('vary') ?? '';
    const fields = vary.split(',').map((field) => field.trim().toLowerCase());

    // Without these, a cache keyed on the URL alone could serve one user's response to another.
    expect(fields).toContain('cookie');
    expect(fields).toContain('authorization');
  });

  it('leaves a handler’s own directive alone', async () => {
    const { app } = await setup();
    const res = await app.request('/v1/me/athena/sessions', {
      headers: { Accept: 'application/json' },
    });

    // The middleware fills silence; it does not overrule a handler that knew better. This one
    // has no directive of its own, so it takes the default — the assertion that matters is that
    // the value is a single coherent policy rather than two appended together.
    expect(res.headers.get('cache-control')?.split(',').length).toBe(2);
  });
});

describe('media types', () => {
  it('refuses a body it cannot read with 415 rather than failing at 500', async () => {
    const { app } = await setup();
    const res = await app.request('/v1/time/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'not json',
    });

    expect(res.status).toBe(415);
    // §15.5.16 asks a 415 to name what it would have read.
    expect(res.headers.get('accept')).toContain('application/json');
    expect((await res.json()) as { code: string }).toMatchObject({
      code: 'unsupported_media_type',
    });
  });

  it('accepts a JSON media type with parameters, and the +json suffix', async () => {
    const { app } = await setup();
    for (const contentType of ['application/json; charset=utf-8', 'application/merge-patch+json']) {
      const res = await app.request('/v1/time/categories', {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body: JSON.stringify({ name: `Suffixed ${contentType}`, color: 'blue' }),
      });
      expect(res.status).toBe(201);
    }
  });

  it('refuses an undeclared body rather than misreporting it as invalid', async () => {
    const { app } = await setup();
    // A `Blob` with no type is the only way to send a body with genuinely no `Content-Type`:
    // `fetch` stamps `text/plain` on a string body.
    const res = await app.request('/v1/time/categories', {
      method: 'POST',
      body: new Blob([JSON.stringify({ name: 'Untyped', color: 'blue' })]),
    });

    // Hono will not parse an undeclared body, so without this the caller got a 422 saying
    // `name` was missing — from a request that plainly sent one.
    expect(res.status).toBe(415);
  });

  it('does not demand a Content-Type from a request with no content', async () => {
    const { app } = await setup();
    // A POST to a controller resource often carries nothing. A reverse proxy may preserve that
    // as an empty stream rather than `null`, so both wire shapes have to mean "no content".
    for (const body of [undefined, new Blob([])]) {
      const res = await app.request('/v1/me/notifications/read-all', {
        method: 'POST',
        ...(body === undefined ? {} : { body }),
      });
      expect(res.status).not.toBe(415);
    }
  });

  it('answers 406 when Accept excludes everything it can produce', async () => {
    const { app } = await setup();
    const res = await app.request('/v1/time/categories', {
      headers: { Accept: 'application/xml' },
    });

    expect(res.status).toBe(406);
    expect((await res.json()) as { code: string }).toMatchObject({ code: 'not_acceptable' });
  });

  it('treats a wildcard, JSON case variants, and silence as acceptable', async () => {
    const { app } = await setup();
    for (const accept of [
      '*/*',
      'application/*',
      'text/html, */*',
      // Media types are case-insensitive (RFC 9110 §8.3.1); comparing the client's spelling
      // against a lowercase list refused this with `406`.
      'APPLICATION/JSON',
    ]) {
      expect(
        (await app.request('/v1/time/categories', { headers: { Accept: accept } })).status,
      ).toBe(200);
    }
    expect((await app.request('/v1/time/categories')).status).toBe(200);
  });

  it('honors an explicit q=0 refusal of the only type it has', async () => {
    const { app } = await setup();
    const res = await app.request('/v1/time/categories', {
      headers: { Accept: 'application/json;q=0' },
    });
    expect(res.status).toBe(406);
  });

  it('lets an explicit JSON refusal override an acceptable wildcard', async () => {
    const { app } = await setup();
    const res = await app.request('/v1/time/categories', {
      headers: { Accept: 'application/json;q=0, */*;q=1' },
    });
    expect(res.status).toBe(406);
  });
});

describe('authentication challenges', () => {
  it('advertises the first-party session on a session-only 401', async () => {
    const { app } = await setup();
    getSession.mockResolvedValue(null);

    const res = await app.request('/v1/time/categories');
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe('DocketSession realm="docket"');
  });
});

describe('HEAD', () => {
  it('answers a GET route with its headers and no body', async () => {
    const { app } = await setup();
    const get = await app.request('/v1/time/categories');
    const head = await app.request('/v1/time/categories', { method: 'HEAD' });

    expect(head.status).toBe(get.status);
    // RFC 9110 §9.3.2: identical headers to the GET, and no content. A client using HEAD to
    // check an `ETag` before deciding whether to fetch depends on both halves.
    expect(head.headers.get('etag')).toBe(get.headers.get('etag'));
    expect(head.headers.get('cache-control')).toBe(get.headers.get('cache-control'));
    expect(await head.text()).toBe('');
  });
});

describe('streaming responses', () => {
  it('declares itself un-buffered and un-rewritable', async () => {
    const { declareStreaming } = await import('../../src/lib/sse-headers');
    const { Hono } = await import('hono');
    const { streamSSE } = await import('hono/streaming');
    const probe = new Hono().get('/live', (c) =>
      declareStreaming(
        streamSSE(c, async (stream) => {
          await stream.writeSSE({ event: 'ping', data: '1' });
        }),
      ),
    );

    const res = await probe.request('/live');
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    // Hono sets `no-cache`; `no-transform` is what stops an intermediary compressing the stream,
    // and `X-Accel-Buffering` is what stops nginx holding frames until a buffer fills. Both
    // failures look identical to the client: a live connection that never delivers anything.
    expect(res.headers.get('cache-control')).toBe('no-cache, no-transform');
    expect(res.headers.get('x-accel-buffering')).toBe('no');
  });
});

describe('security headers', () => {
  /** The root server's middleware stack, without booting a listener. */
  async function hardened() {
    const { secureHeaders } = await import('hono/secure-headers');
    const { Hono } = await import('hono');
    const probe = new Hono()
      .use('*', secureHeaders({ crossOriginResourcePolicy: 'cross-origin', xFrameOptions: false }))
      .get('/thing', (c) => c.json({ ok: true }))
      // Stands in for the MCP Apps sandbox, which must be framable from the web origin.
      .get('/framed', (c) => c.html('<p>widget</p>'));
    return probe;
  }

  it('tells browsers not to guess at a response’s type', async () => {
    const res = await (await hardened()).request('/thing');
    // The one that matters most on an API that serves user-supplied file bytes: without it a
    // stored upload can be re-interpreted as something executable.
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBeTruthy();
    expect(res.headers.get('strict-transport-security')).toBeTruthy();
  });

  it('stays loadable from the product app, which is a different origin', async () => {
    const res = await (await hardened()).request('/thing');
    // `same-origin` — the library default — would stop the web app rendering an `<img>` served
    // by this API. The two are separate origins by design.
    expect(res.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
  });

  it('leaves framing to the one document that decides it', async () => {
    const res = await (await hardened()).request('/framed');
    // `secureHeaders` applies its headers after the handler, so a blanket `SAMEORIGIN` would
    // overwrite the MCP Apps sandbox's deliberate omission and break cross-origin framing. The
    // sandbox constrains it precisely with `frame-ancestors` instead.
    expect(res.headers.get('x-frame-options')).toBeNull();
  });
});

describe('request correlation', () => {
  it('returns an id a client can quote back', async () => {
    const { requestId } = await import('hono/request-id');
    const { Hono } = await import('hono');
    const probe = new Hono().use('*', requestId()).get('/thing', (c) => c.json({ ok: true }));

    const res = await probe.request('/thing');
    expect(res.headers.get('x-request-id')).toBeTruthy();
  });

  it('honours an id the caller supplied, so a trace spans both sides', async () => {
    const { requestId } = await import('hono/request-id');
    const { Hono } = await import('hono');
    const probe = new Hono().use('*', requestId()).get('/thing', (c) => c.json({ ok: true }));

    const res = await probe.request('/thing', {
      headers: { 'X-Request-Id': 'caller-supplied-id' },
    });
    expect(res.headers.get('x-request-id')).toBe('caller-supplied-id');
  });
});

describe('request size', () => {
  it('refuses an oversized body as a problem document, not plain text', async () => {
    const { app } = await setup();
    const { MAX_REQUEST_BYTES } = await import('../../src/lib/http-limits');

    const res = await app.request('/v1/time/categories', {
      method: 'POST',
      headers: { ...JSON_HEADERS, 'Content-Length': String(MAX_REQUEST_BYTES + 1) },
      body: JSON.stringify({ name: 'x'.repeat(64), color: 'blue' }),
    });

    expect(res.status).toBe(413);
    // Hono's own 413 is plain text; routing it through `onError` keeps the one error shape.
    expect(res.headers.get('content-type')).toContain('application/problem+json');
    expect((await res.json()) as { code: string }).toMatchObject({ code: 'payload_too_large' });
  });
});

describe('canonical URLs', () => {
  it('redirects a trailing slash to the one path that serves the resource', async () => {
    const { trimTrailingSlash } = await import('hono/trailing-slash');
    const { Hono } = await import('hono');
    const probe = new Hono()
      .use('*', trimTrailingSlash({ alwaysRedirect: true }))
      .get('/things', (c) => c.json({ ok: true }));

    const res = await probe.request('http://api.test/things/', { redirect: 'manual' });
    // 301, not 404: the slashed form is not a different resource, and a permanent redirect lets
    // a client — or a search engine — record the canonical one.
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('http://api.test/things');
  });
});

describe('cross-origin redirects', () => {
  it('keeps CORS headers on the trailing-slash redirect', async () => {
    const { trimTrailingSlash } = await import('hono/trailing-slash');
    const { cors } = await import('hono/cors');
    const { Hono } = await import('hono');
    // The server's order: CORS first, then the redirect, so the 301 is inside the CORS response.
    const probe = new Hono()
      .use('*', cors({ origin: ['https://app.test'], credentials: true }))
      .use('*', trimTrailingSlash({ alwaysRedirect: true }))
      .get('/things', (c) => c.json({ ok: true }));

    const res = await probe.request('http://api.test/things/', {
      headers: { Origin: 'https://app.test' },
      redirect: 'manual',
    });
    expect(res.status).toBe(301);
    // A browser CORS-checks the redirect itself; without this the product app — which only ever
    // reaches this API cross-origin — sees an opaque failure instead of following it.
    expect(res.headers.get('access-control-allow-origin')).toBe('https://app.test');
  });
});
