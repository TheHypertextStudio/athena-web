import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';

import type { AppEnv } from '../../src/context';
import { CapabilityError, NotFoundError, ValidationError, onError } from '../../src/error';
import { captureIdempotencyBody, idempotency, idempotencyFor } from '../../src/lib/idempotency';
import { fakeSession, getDb, principalForSession } from '../support/routes-harness';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

beforeAll(async () => {
  await getDb();
});

function sessionPrincipal(userId: string) {
  const session = fakeSession(userId);
  if (!session) throw new Error('The session test user was not created.');
  const principal = principalForSession(session);
  if (principal?.kind !== 'session') throw new Error('The session principal was not created.');
  return principal;
}

describe('idempotency authorization boundary', () => {
  it.each(['comments', 'updates'])(
    'lets %s enforce authorization before its declared retry handler',
    async (resource) => {
      const principal = sessionPrincipal(`content-boundary-${crypto.randomUUID()}`);
      const app = new Hono<AppEnv>();
      const path = `/v1/orgs/org-1/${resource}`;
      let authorized = false;
      let calls = 0;
      app.use('*', async (c, next) => {
        c.set('principal', principal);
        c.set('session', { user: principal.user, session: principal.session });
        await next();
      });
      app.use('*', idempotency);
      app.post(
        path,
        async (_c, next) => {
          if (!authorized) throw new CapabilityError();
          await next();
        },
        idempotencyFor('json-receipt'),
        (c) => c.json({ call: ++calls }, 201),
      );
      app.onError(onError);
      const request = () =>
        app.request(path, {
          method: 'POST',
          headers: { ...JSON_HEADERS, 'Idempotency-Key': crypto.randomUUID() },
          body: '{}',
        });
      expect((await request()).status).toBe(403);
      expect(calls).toBe(0);
      authorized = true;
      expect((await request()).status).toBe(201);
      expect(calls).toBe(1);
    },
  );

  it('rejects a key on an undeclared legacy operation before its handler executes', async () => {
    const principal = sessionPrincipal(`receipt-legacy-undeclared-${crypto.randomUUID()}`);
    const app = new Hono<AppEnv>();
    let calls = 0;
    app.use('*', async (c, next) => {
      c.set('principal', principal);
      c.set('session', { user: principal.user, session: principal.session });
      await next();
    });
    app.use('*', idempotency);
    app.post('/legacy-json', (c) => c.json({ call: ++calls }, 201));
    app.onError(onError);

    const response = await app.request('/legacy-json', {
      method: 'POST',
      headers: { ...JSON_HEADERS, 'Idempotency-Key': `legacy-${crypto.randomUUID()}` },
      body: '{}',
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: 'validation_error' });
    expect(calls).toBe(0);
  });

  it('runs a current authorization guard before replaying a child-route receipt', async () => {
    const principal = sessionPrincipal(`receipt-guard-${crypto.randomUUID()}`);
    const app = new Hono<AppEnv>();
    let authorized = true;
    let calls = 0;
    app.use('/guarded/*', async (c, next) => {
      c.set('principal', principal);
      c.set('session', { user: principal.user, session: principal.session });
      if (!authorized) throw new CapabilityError();
      await next();
    });
    app.use('/guarded/create', idempotencyFor('json-receipt'));
    app.route(
      '/guarded/create',
      new Hono<AppEnv>().post('/', (c) => c.json({ call: ++calls }, 201)),
    );
    app.onError(onError);
    const key = `guard-${crypto.randomUUID()}`;
    const request = () =>
      app.request('/guarded/create', {
        method: 'POST',
        headers: { ...JSON_HEADERS, 'Idempotency-Key': key },
        body: '{}',
      });

    expect((await request()).status).toBe(201);
    authorized = false;
    const replay = await request();

    expect(replay.status).toBe(403);
    expect(replay.headers.get('Idempotency-Replayed')).toBeNull();
    expect(calls).toBe(1);
  });

  it.each([new CapabilityError(), new NotFoundError(), new ValidationError([])])(
    'preserves a downstream $status and releases its unfinished atomic claim',
    async (error) => {
      const principal = sessionPrincipal(`receipt-rejected-${crypto.randomUUID()}`);
      const app = new Hono<AppEnv>();
      let calls = 0;
      app.use('*', async (c, next) => {
        c.set('principal', principal);
        c.set('session', { user: principal.user, session: principal.session });
        await next();
      });
      app.post('/atomic', idempotencyFor('atomic-receipt'), () => {
        calls += 1;
        throw error;
      });
      app.onError(onError);
      const request = () =>
        app.request('/atomic', {
          method: 'POST',
          headers: { ...JSON_HEADERS, 'Idempotency-Key': 'rejected' },
          body: '{}',
        });
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await request();
        expect(response.status).toBe(error.status);
        expect(await response.json()).toMatchObject({ code: error.code });
      }
      expect(calls).toBe(2);
    },
  );

  it.each([403, 201] as const)(
    'preserves a returned error but rejects an uncompleted success (%i)',
    async (status) => {
      const principal = sessionPrincipal(`receipt-response-${crypto.randomUUID()}`);
      const app = new Hono<AppEnv>();
      app.use('*', async (c, next) => {
        c.set('principal', principal);
        c.set('session', { user: principal.user, session: principal.session });
        await next();
      });
      app.post('/atomic', idempotencyFor('atomic-receipt'), (c) => c.json({ status }, status));
      app.onError(onError);
      const response = await app.request('/atomic', {
        method: 'POST',
        headers: { ...JSON_HEADERS, 'Idempotency-Key': 'uncompleted' },
        body: '{}',
      });
      expect(response.status).toBe(status === 403 ? 403 : 500);
    },
  );

  it('retains exact body bytes when JSON validation runs before the receipt adapter', async () => {
    const principal = sessionPrincipal(`receipt-original-bytes-${crypto.randomUUID()}`);
    const app = new Hono<AppEnv>();
    let calls = 0;
    app.use('*', async (c, next) => {
      c.set('principal', principal);
      c.set('session', { user: principal.user, session: principal.session });
      await next();
    });
    app.use('*', captureIdempotencyBody);
    app.use('*', async (c, next) => {
      await c.req.json();
      await next();
    });
    app.post('/validated', idempotencyFor('json-receipt'), (c) => c.json({ call: ++calls }, 201));
    app.onError(onError);
    const prefix = new TextEncoder().encode('{"name":"');
    const suffix = new TextEncoder().encode('"}');
    const request = (byte: number) =>
      app.request('/validated', {
        method: 'POST',
        headers: { ...JSON_HEADERS, 'Idempotency-Key': 'exact-original-bytes' },
        body: new Uint8Array([...prefix, byte, ...suffix]),
      });
    expect((await request(0x80)).status).toBe(201);
    expect((await request(0x80)).status).toBe(201);
    // Both invalid UTF-8 bytes decode to the same replacement character during JSON parsing.
    expect((await request(0x81)).status).toBe(422);
    expect(calls).toBe(1);
  });
});
