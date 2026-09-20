import { createHash } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';

import type { AppEnv, CallerPrincipal } from '../../src/context';
import { API_VERSION } from '../../src/api-version';
import { onError } from '../../src/error';
import {
  completeIdempotencyInTransaction,
  idempotencyFingerprint,
  idempotencyFor,
  type IdempotencyClaim,
  type IdempotencyReceiptMode,
} from '../../src/lib/idempotency';
import { fakeSession, getDb, principalForSession } from '../support/routes-harness';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function oauthPrincipal(userId: string, clientId: string): CallerPrincipal {
  const session = fakeSession(userId);
  if (!session) throw new Error('The OAuth test user was not created.');
  return {
    kind: 'oauth',
    userId,
    user: session.user,
    clientId,
    scopes: ['work:write'],
  };
}

function receiptApp(
  principal: CallerPrincipal,
  receiptMode: IdempotencyReceiptMode = 'json-receipt',
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('principal', principal);
    c.set(
      'session',
      principal.kind === 'session' ? { user: principal.user, session: principal.session } : null,
    );
    await next();
  });
  app.use('*', idempotencyFor(receiptMode));
  app.onError(onError);
  return app;
}

beforeAll(async () => {
  await getDb();
});

describe('versioned idempotency receipts', () => {
  it('prevents an expired claimant from completing over its replacement', async () => {
    const database = await getDb();
    const userId = `receipt-generation-${crypto.randomUUID()}`;
    const session = fakeSession(userId);
    if (!session) throw new Error('The session test user was not created.');
    const principal = principalForSession(session);
    if (!principal) throw new Error('The session principal was not created.');
    const key = `generation-${crypto.randomUUID()}`;
    const path = '/creates?view=compact';
    const body = '{"title":"Replacement"}';
    const raw = new Request(`http://docket.test${path}`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, 'Idempotency-Key': key },
      body,
    });
    const staleClaim: IdempotencyClaim = {
      userId,
      callerNamespace: 'session',
      apiVersion: API_VERSION,
      key,
      claimId: crypto.randomUUID(),
      receiptFormat: 'json-receipt',
      completedExpiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
    };
    await database.db.insert(database.apiIdempotencyReceipt).values({
      userId,
      callerNamespace: 'session',
      apiVersion: API_VERSION,
      key,
      claimId: staleClaim.claimId,
      method: 'POST',
      path: '/creates',
      requestHash: await idempotencyFingerprint(raw),
      receiptFormat: 'json-receipt',
      status: 'in_progress',
      createdAt: new Date(Date.now() - 10 * 60 * 1000),
      expiresAt: new Date(Date.now() - 1_000),
    });
    const app = receiptApp(principal);
    app.post('/creates', (c) => c.json({ id: 'replacement' }, 201));

    expect(
      (
        await app.request(path, {
          method: 'POST',
          headers: { ...JSON_HEADERS, 'Idempotency-Key': key },
          body,
        })
      ).status,
    ).toBe(201);
    await expect(
      completeIdempotencyInTransaction(database.db, staleClaim, {
        organizationId: null,
        responseStatus: 201,
        responseBody: { id: 'stale-owner' },
      }),
    ).rejects.toThrow(/no longer active/);
    const [receipt] = await database.db
      .select({ claimId: database.apiIdempotencyReceipt.claimId })
      .from(database.apiIdempotencyReceipt)
      .where(
        and(
          eq(database.apiIdempotencyReceipt.userId, userId),
          eq(database.apiIdempotencyReceipt.key, key),
        ),
      );
    expect(receipt?.claimId).not.toBe(staleClaim.claimId);
  });

  it('rolls back atomic completion with its mutation and replays a post-commit crash', async () => {
    const database = await getDb();
    const userId = `receipt-atomic-${crypto.randomUUID()}`;
    const sideEffectUserId = `receipt-effect-${crypto.randomUUID()}`;
    const session = fakeSession(userId);
    if (!session) throw new Error('The session test user was not created.');
    const principal = principalForSession(session);
    if (!principal) throw new Error('The session principal was not created.');
    const key = `atomic-${crypto.randomUUID()}`;
    const body = '{"title":"Atomic"}';
    const raw = new Request('http://docket.test/atomic', {
      method: 'POST',
      headers: { ...JSON_HEADERS, 'Idempotency-Key': key },
      body,
    });
    const claim: IdempotencyClaim = {
      userId,
      callerNamespace: 'session',
      apiVersion: API_VERSION,
      key,
      claimId: crypto.randomUUID(),
      receiptFormat: 'atomic-receipt',
      completedExpiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
    };
    await database.db.insert(database.apiIdempotencyReceipt).values({
      userId,
      callerNamespace: 'session',
      apiVersion: API_VERSION,
      key,
      claimId: claim.claimId,
      method: 'POST',
      path: '/atomic',
      requestHash: await idempotencyFingerprint(raw),
      receiptFormat: 'atomic-receipt',
      status: 'in_progress',
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });
    const commit = async (shouldFail: boolean): Promise<void> => {
      await database.db.transaction(async (transaction) => {
        await transaction.insert(database.user).values({
          id: sideEffectUserId,
          name: 'Atomic side effect',
          email: `${sideEffectUserId}@example.test`,
        });
        await completeIdempotencyInTransaction(transaction, claim, {
          organizationId: null,
          responseStatus: 201,
          responseBody: { id: sideEffectUserId },
          responseHeaders: { Location: `/v1/users/${sideEffectUserId}` },
        });
        if (shouldFail) throw new Error('injected crash before commit');
      });
    };

    await expect(commit(true)).rejects.toThrow('injected crash before commit');
    expect(
      await database.db.select().from(database.user).where(eq(database.user.id, sideEffectUserId)),
    ).toEqual([]);
    await commit(false);
    let handlerCalls = 0;
    const app = receiptApp(principal, 'atomic-receipt');
    app.post('/atomic', (c) => {
      handlerCalls += 1;
      return c.json({ id: 'duplicate' }, 201);
    });
    const replay = await app.request('/atomic', {
      method: 'POST',
      headers: { ...JSON_HEADERS, 'Idempotency-Key': key },
      body,
    });

    expect(replay.status).toBe(201);
    expect(replay.headers.get('Idempotency-Replayed')).toBe('true');
    expect(replay.headers.get('Location')).toBe(`/v1/users/${sideEffectUserId}`);
    expect(await replay.json()).toEqual({ id: sideEffectUserId });
    expect(handlerCalls).toBe(0);
  });

  it('admits re-execution after the documented JSON mutation-to-receipt crash boundary', async () => {
    const database = await getDb();
    const userId = `receipt-json-crash-${crypto.randomUUID()}`;
    const session = fakeSession(userId);
    if (!session) throw new Error('The session test user was not created.');
    const principal = principalForSession(session);
    if (!principal) throw new Error('The session principal was not created.');
    const key = `json-crash-${crypto.randomUUID()}`;
    const body = '{"title":"Retry"}';
    const raw = new Request('http://docket.test/json-crash', {
      method: 'POST',
      headers: { ...JSON_HEADERS, 'Idempotency-Key': key },
      body,
    });
    await database.db.insert(database.apiIdempotencyReceipt).values({
      userId,
      callerNamespace: 'session',
      apiVersion: API_VERSION,
      key,
      claimId: crypto.randomUUID(),
      method: 'POST',
      path: '/json-crash',
      requestHash: await idempotencyFingerprint(raw),
      receiptFormat: 'json-receipt',
      status: 'in_progress',
      createdAt: new Date(Date.now() - 10 * 60 * 1000),
      expiresAt: new Date(Date.now() - 1_000),
    });
    let domainExecutions = 1;
    const app = receiptApp(principal);
    app.post('/json-crash', (c) => c.json({ execution: ++domainExecutions }, 201));

    const retry = await app.request('/json-crash', {
      method: 'POST',
      headers: { ...JSON_HEADERS, 'Idempotency-Key': key },
      body,
    });

    expect(retry.status).toBe(201);
    expect(await retry.json()).toEqual({ execution: 2 });
    expect(domainExecutions).toBe(2);
  });

  it('does not extend an expired legacy receipt beyond its stored deadline', async () => {
    const database = await getDb();
    const userId = `receipt-legacy-deadline-${crypto.randomUUID()}`;
    const session = fakeSession(userId);
    if (!session) throw new Error('The session test user was not created.');
    const principal = principalForSession(session);
    if (!principal) throw new Error('The session principal was not created.');
    const app = receiptApp(principal);
    const key = `legacy-deadline-${crypto.randomUUID()}`;
    const path = '/v1/orgs/legacy-org/object-commands';
    const body = JSON.stringify({ commandId: key });
    let calls = 0;
    app.post(path, (c) => c.json({ call: ++calls }, 201));
    await database.db.insert(database.idempotencyKey).values({
      userId,
      key,
      method: 'POST',
      path,
      requestHash: createHash('sha256').update(`POST\n${path}\n${body}`).digest('base64url'),
      responseStatus: 200,
      responseBody: { stale: true },
      status: 'completed',
      createdAt: new Date(Date.now() - 60 * 60 * 1000),
      expiresAt: new Date(Date.now() - 1_000),
    });

    const response = await app.request(path, {
      method: 'POST',
      headers: { ...JSON_HEADERS, 'Idempotency-Key': key },
      body,
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ call: 1 });
    expect(calls).toBe(1);
  });

  it.each([
    ['bodyless', 'POST', () => new Response(null, { status: 204 })],
    ['binary', 'POST', () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })],
    [
      'streaming',
      'GET',
      () =>
        new Response('event: ready\ndata: {}\n\n', {
          headers: { 'Content-Type': 'text/event-stream' },
        }),
    ],
  ])(
    'rejects a key before an unsupported %s operation executes',
    async (_kind, method, response) => {
      const userId = `receipt-unsupported-${crypto.randomUUID()}`;
      const session = fakeSession(userId);
      if (!session) throw new Error('The session test user was not created.');
      const principal = principalForSession(session);
      if (principal?.kind !== 'session') throw new Error('The session principal was not created.');
      const app = new Hono<AppEnv>();
      let calls = 0;
      app.use('*', async (c, next) => {
        c.set('principal', principal);
        c.set('session', { user: principal.user, session: principal.session });
        await next();
      });
      app.use('*', idempotencyFor(false));
      app.on(method, '/unsupported', () => {
        calls += 1;
        return response();
      });
      app.onError(onError);

      const result = await app.request('/unsupported', {
        method,
        headers: { ...JSON_HEADERS, 'Idempotency-Key': `unsupported-${crypto.randomUUID()}` },
        ...(method === 'GET' ? {} : { body: '{}' }),
      });

      expect(result.status).toBe(422);
      expect(await result.json()).toMatchObject({ code: 'validation_error' });
      expect(calls).toBe(0);
    },
  );

  it('isolates one user key by OAuth client and API version', async () => {
    const database = await getDb();
    const userId = `receipt-namespace-${crypto.randomUUID()}`;
    const key = `shared-${crypto.randomUUID()}`;
    const body = '{"title":"One"}';
    const priorVersionRequest = new Request('http://docket.test/creates', {
      method: 'POST',
      headers: { ...JSON_HEADERS, 'Idempotency-Key': key },
      body,
    });
    await database.db.insert(database.apiIdempotencyReceipt).values({
      userId,
      callerNamespace: 'oauth:client-a',
      apiVersion: '0.0.9',
      key,
      claimId: crypto.randomUUID(),
      method: 'POST',
      path: '/creates',
      requestHash: await idempotencyFingerprint(priorVersionRequest),
      receiptFormat: 'json-receipt',
      responseStatus: 201,
      responseBody: { call: 'old-version' },
      responseHeaders: { 'content-type': 'application/json' },
      status: 'completed',
      expiresAt: new Date(Date.now() + 60_000),
    });
    let calls = 0;
    const makeApp = (clientId: string) => {
      const app = receiptApp(oauthPrincipal(userId, clientId));
      app.post('/creates', (c) => c.json({ call: ++calls }, 201));
      return app;
    };

    const first = await makeApp('client-a').request('/creates', {
      method: 'POST',
      headers: { ...JSON_HEADERS, 'Idempotency-Key': key },
      body,
    });
    const second = await makeApp('client-b').request('/creates', {
      method: 'POST',
      headers: { ...JSON_HEADERS, 'Idempotency-Key': key },
      body,
    });
    const rows = await database.db
      .select()
      .from(database.apiIdempotencyReceipt)
      .where(
        and(
          eq(database.apiIdempotencyReceipt.userId, userId),
          eq(database.apiIdempotencyReceipt.key, key),
        ),
      );

    expect([first.status, second.status]).toEqual([201, 201]);
    expect(await first.json()).toEqual({ call: 1 });
    expect(await second.json()).toEqual({ call: 2 });
    expect(calls).toBe(2);
    expect(
      rows.map(({ callerNamespace, apiVersion }) => `${callerNamespace}@${apiVersion}`).sort(),
    ).toEqual([
      'oauth:client-a@0.0.9',
      `oauth:client-a@${API_VERSION}`,
      `oauth:client-b@${API_VERSION}`,
    ]);
  });

  it('replays Location and permitted content headers without storing response identity or cookies', async () => {
    const database = await getDb();
    const userId = `receipt-headers-${crypto.randomUUID()}`;
    const session = fakeSession(userId);
    if (!session) throw new Error('The session test user was not created.');
    const principal = principalForSession(session);
    if (!principal) throw new Error('The session principal was not created.');
    const app = receiptApp(principal);
    let calls = 0;
    app.post('/creates', (c) => {
      calls += 1;
      c.header('Location', '/v1/things/thing_1');
      c.header('Content-Language', 'en-US');
      c.header('X-Request-Id', 'must-not-survive');
      c.header('Set-Cookie', 'secret=value');
      c.header('Access-Control-Allow-Origin', 'https://untrusted.example');
      return c.json({ id: 'thing_1' }, 201);
    });
    const key = `headers-${crypto.randomUUID()}`;
    const request = () =>
      app.request('/creates', {
        method: 'POST',
        headers: { ...JSON_HEADERS, 'Idempotency-Key': key },
        body: '{"title":"One"}',
      });

    expect((await request()).status).toBe(201);
    const replay = await request();
    const [row] = await database.db
      .select({ responseHeaders: database.apiIdempotencyReceipt.responseHeaders })
      .from(database.apiIdempotencyReceipt)
      .where(
        and(
          eq(database.apiIdempotencyReceipt.userId, userId),
          eq(database.apiIdempotencyReceipt.key, key),
        ),
      );

    expect(calls).toBe(1);
    expect(replay.status).toBe(201);
    expect(replay.headers.get('Idempotency-Replayed')).toBe('true');
    expect(replay.headers.get('Location')).toBe('/v1/things/thing_1');
    expect(replay.headers.get('Content-Language')).toBe('en-US');
    expect(replay.headers.get('X-Request-Id')).not.toBe('must-not-survive');
    expect(replay.headers.get('Set-Cookie')).toBeNull();
    expect(replay.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(row?.responseHeaders).toEqual({
      'content-language': 'en-US',
      'content-type': 'application/json',
      location: '/v1/things/thing_1',
    });
  });

  it('normalizes query key order but preserves duplicate value order in the fingerprint', async () => {
    const userId = `receipt-query-${crypto.randomUUID()}`;
    const session = fakeSession(userId);
    if (!session) throw new Error('The session test user was not created.');
    const principal = principalForSession(session);
    if (!principal) throw new Error('The session principal was not created.');
    const app = receiptApp(principal);
    let calls = 0;
    app.post('/creates', (c) => c.json({ call: ++calls }, 201));
    const key = `query-${crypto.randomUUID()}`;
    const request = (query: string) =>
      app.request(`/creates?${query}`, {
        method: 'POST',
        headers: { ...JSON_HEADERS, 'Idempotency-Key': key },
        body: '{"title":"One"}',
      });

    expect((await request('b=2&a=1&a=2')).status).toBe(201);
    expect((await request('a=1&a=2&b=2')).headers.get('Idempotency-Replayed')).toBe('true');
    const changed = await request('a=2&a=1&b=2');

    expect(changed.status).toBe(422);
    expect(calls).toBe(1);
  });

  it('binds normalized content type and exact body bytes into the fingerprint', async () => {
    const userId = `receipt-bytes-${crypto.randomUUID()}`;
    const session = fakeSession(userId);
    if (!session) throw new Error('The session test user was not created.');
    const principal = principalForSession(session);
    if (!principal) throw new Error('The session principal was not created.');
    const app = receiptApp(principal);
    let calls = 0;
    app.post('/creates', (c) => c.json({ call: ++calls }, 201));
    const contentTypeKey = `content-type-${crypto.randomUUID()}`;
    const bytesKey = `bytes-${crypto.randomUUID()}`;

    expect(
      (
        await app.request('/creates', {
          method: 'POST',
          headers: {
            'Content-Type': 'Application/JSON; Charset=UTF-8',
            'Idempotency-Key': contentTypeKey,
          },
          body: '{"title":"One"}',
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await app.request('/creates', {
          method: 'POST',
          headers: {
            'Content-Type': 'text/json; charset=utf-8',
            'Idempotency-Key': contentTypeKey,
          },
          body: '{"title":"One"}',
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await app.request('/creates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream', 'Idempotency-Key': bytesKey },
          body: new Uint8Array([0x80]),
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await app.request('/creates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream', 'Idempotency-Key': bytesKey },
          body: new Uint8Array([0x81]),
        })
      ).status,
    ).toBe(422);
    expect(calls).toBe(2);
  });
});
