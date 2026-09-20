import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';

import type { AppEnv } from '../../src/context';
import { CapabilityError, onError } from '../../src/error';
import { idempotency, idempotencyFor } from '../../src/lib/idempotency';
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
});
