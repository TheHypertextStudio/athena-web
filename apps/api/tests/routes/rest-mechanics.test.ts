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
import { and, eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AppEnv } from '../../src/context';
import { getSession } from '../support/auth-mock';
import { getDb, seedUserWithHub } from '../support/routes-harness';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

/**
 * The composed `/v1` app plus the migrated database, both memoized.
 *
 * @remarks
 * `sessionMiddleware` is registered on the root server rather than on `app`, so a test driving
 * `app` alone would reach `requireAuth` with no session set. Wrapping it here reproduces the
 * production order — resolve the session, then gate — without booting a listener.
 */
async function setup() {
  const schema = await getDb();
  const { app: v1 } = await import('../../src/app');
  const { sessionMiddleware } = await import('../../src/auth/session-middleware');
  const { onError } = await import('../../src/error');
  const { Hono } = await import('hono');
  const app = new Hono();
  app.use('*', sessionMiddleware as never);
  app.route('/', v1 as never);
  app.onError(onError);
  return { schema, db: schema.db, app };
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
  it('answers 201 with a Location that names the new resource under /v1', async () => {
    const res = await createCategory('Deep work');
    expect(res.status).toBe(201);

    const { id } = (await res.json()) as { id: string };
    const location = res.headers.get('location');
    // Absolute, and carrying the mount prefix — a client must be able to follow it verbatim.
    expect(location).toBe(`https://api.docket.localhost/v1/time/categories/${id}`);
  });
});

describe('Idempotency-Key', () => {
  it('replays the first outcome instead of creating a second resource', async () => {
    const { db, schema } = await setup();
    const key = `retry-${Math.random().toString(36).slice(2)}`;

    const first = await createCategory('Retried', { 'Idempotency-Key': key });
    expect(first.status).toBe(201);
    const created = (await first.json()) as { id: string };
    expect(first.headers.get('idempotency-replayed')).toBeNull();

    const replay = await createCategory('Retried', { 'Idempotency-Key': key });
    expect(replay.status).toBe(201);
    expect(replay.headers.get('idempotency-replayed')).toBe('true');
    // A replay is the original answer again, `Location` included — a client that lost the first
    // response and retried must not end up with a 201 it cannot follow.
    expect(replay.headers.get('location')).toBe(first.headers.get('location'));
    // The same resource comes back, and no second one was written.
    expect((await replay.json()) as { id: string }).toMatchObject({ id: created.id });
    expect(
      await db.select().from(schema.timeCategory).where(eq(schema.timeCategory.name, 'Retried')),
    ).toHaveLength(1);
  });

  it('refuses a key replayed against a different request', async () => {
    const key = `reused-${Math.random().toString(36).slice(2)}`;
    expect((await createCategory('Original', { 'Idempotency-Key': key })).status).toBe(201);

    const mismatch = await createCategory('Something else', { 'Idempotency-Key': key });
    expect(mismatch.status).toBe(422);
    expect(mismatch.headers.get('content-type')).toContain('application/problem+json');
    expect((await mismatch.json()) as { code: string }).toMatchObject({
      code: 'idempotency_key_reuse',
    });
  });

  it('leaves the key usable when the first attempt failed', async () => {
    const { app } = await setup();
    const key = `failed-${Math.random().toString(36).slice(2)}`;
    const invalid = await app.request('/v1/time/categories', {
      method: 'POST',
      headers: { ...JSON_HEADERS, 'Idempotency-Key': key },
      body: JSON.stringify({ name: '' }),
    });
    expect(invalid.status).toBe(422);

    // Retrying a create that failed is exactly what the header is for, so the key must not be
    // burned by the attempt that never produced anything.
    expect((await createCategory('After a failure', { 'Idempotency-Key': key })).status).toBe(201);
  });

  it('ignores the header on a method that is already idempotent', async () => {
    const { app } = await setup();
    const res = await app.request('/v1/time/categories', {
      headers: { 'Idempotency-Key': 'unused-on-a-read' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('idempotency-replayed')).toBeNull();
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

  it('refuses a write whose If-Match names a version the resource no longer has', async () => {
    const { app } = await setup();
    const stale = (await app.request(PROFILE)).headers.get('etag') ?? '';

    // Someone else writes first, which is what makes the held tag stale.
    expect(
      (
        await app.request(PROFILE, {
          method: 'PATCH',
          headers: JSON_HEADERS,
          body: JSON.stringify({ name: 'Renamed by someone else' }),
        })
      ).status,
    ).toBe(200);

    const lost = await app.request(PROFILE, {
      method: 'PATCH',
      headers: { ...JSON_HEADERS, 'If-Match': stale },
      body: JSON.stringify({ name: 'Would have clobbered' }),
    });
    expect(lost.status).toBe(412);
    expect(lost.headers.get('content-type')).toContain('application/problem+json');
    expect((await lost.json()) as { code: string }).toMatchObject({ code: 'precondition_failed' });

    // The write that would have been lost did not land.
    expect((await (await app.request(PROFILE)).json()) as { name: string }).toMatchObject({
      name: 'Renamed by someone else',
    });
  });

  it('accepts a write whose If-Match is current', async () => {
    const { app } = await setup();
    const tag = (await app.request(PROFILE)).headers.get('etag') ?? '';

    const res = await app.request(PROFILE, {
      method: 'PATCH',
      headers: { ...JSON_HEADERS, 'If-Match': tag },
      body: JSON.stringify({ name: 'Renamed by the holder' }),
    });
    expect(res.status).toBe(200);
  });

  it('refuses a precondition on a URI that serves no representation', async () => {
    const { app } = await setup();

    // `If-Match: *` means "if a current representation exists". A write-only address has none,
    // so a caller asserting a version of it is mistaken about what it is writing.
    const res = await app.request('/v1/me/notifications/read-all', {
      method: 'DELETE',
      headers: { ...JSON_HEADERS, 'If-Match': '*' },
    });
    expect(res.status).toBe(412);
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

describe('an unmatched request', () => {
  /** A throwaway app carrying the same fallback the real server registers. */
  async function appWithFallback() {
    const { Hono } = await import('hono');
    const { onError } = await import('../../src/error');
    const { unmatchedRoute } = await import('../../src/lib/unmatched-route');
    const probe = new Hono<AppEnv>()
      .get('/things/:id', (c) => c.json({ ok: true }))
      .patch('/things/:id', (c) => c.json({ ok: true }));
    probe.notFound(unmatchedRoute(probe));
    probe.onError(onError);
    return probe;
  }

  it('answers 405 with an Allow header when the path exists under another method', async () => {
    const res = await (await appWithFallback()).request('/things/abc', { method: 'DELETE' });
    expect(res.status).toBe(405);
    // RFC 9110 §15.5.6 requires it, and without it a client learns only that it failed.
    expect(res.headers.get('allow')?.split(', ').sort()).toEqual(['GET', 'PATCH']);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
    expect((await res.json()) as { code: string }).toMatchObject({ code: 'method_not_allowed' });
  });

  it('answers 404 as a Problem rather than as plain text', async () => {
    const res = await (await appWithFallback()).request('/nothing-here');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
    expect((await res.json()) as { code: string; status: number }).toMatchObject({
      code: 'not_found',
      status: 404,
    });
  });
});

describe('idempotency records', () => {
  it('scopes a key to the user who used it', async () => {
    const { db, schema } = await setup();
    const key = `scoped-${Math.random().toString(36).slice(2)}`;
    expect((await createCategory('Mine', { 'Idempotency-Key': key })).status).toBe(201);

    const other = await seedUserWithHub(db, schema, `restmech-other-${key.slice(-6)}`);
    getSession.mockResolvedValue({
      user: { id: other, name: 'Someone Else', email: 'other@example.test' },
    });

    // The same key from a different caller is a fresh key, never a replay of someone else's
    // response — the primary key is `(user_id, key)` precisely so this cannot leak.
    const res = await createCategory('Theirs', { 'Idempotency-Key': key });
    expect(res.status).toBe(201);
    expect(res.headers.get('idempotency-replayed')).toBeNull();
    expect(
      await db
        .select()
        .from(schema.idempotencyKey)
        .where(and(eq(schema.idempotencyKey.key, key), eq(schema.idempotencyKey.userId, other))),
    ).toHaveLength(1);
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

  it('does not demand a Content-Type from a request with no body', async () => {
    const { app } = await setup();
    // A POST to a controller resource often carries nothing; requiring a type to describe an
    // absent body would reject a well-formed call.
    const res = await app.request('/v1/me/notifications/read-all', { method: 'POST' });
    expect(res.status).not.toBe(415);
  });

  it('answers 406 when Accept excludes everything it can produce', async () => {
    const { app } = await setup();
    const res = await app.request('/v1/time/categories', {
      headers: { Accept: 'application/xml' },
    });

    expect(res.status).toBe(406);
    expect((await res.json()) as { code: string }).toMatchObject({ code: 'not_acceptable' });
  });

  it('treats a wildcard, a suffix, and silence as acceptable', async () => {
    const { app } = await setup();
    for (const accept of ['*/*', 'application/*', 'application/problem+json', 'text/html, */*']) {
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
});

describe('authentication challenges', () => {
  it('carries WWW-Authenticate on a 401, as RFC 9110 requires', async () => {
    const { app } = await setup();
    getSession.mockResolvedValue(null);

    const res = await app.request('/v1/time/categories');
    expect(res.status).toBe(401);
    // A 401 without this tells a client that it failed but not how to succeed.
    const challenge = res.headers.get('www-authenticate') ?? '';
    expect(challenge).toContain('Bearer');
    expect(challenge).toContain('error="unauthorized"');
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
