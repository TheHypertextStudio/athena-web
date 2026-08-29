/**
 * Offline-capable live attempts and replays bind to the captured account.
 *
 * @remarks
 * The normal session middleware may accept a signed cookie cache entry for a short window. A
 * browser can switch accounts during that window. The owner header therefore asks the exact
 * object-command POST route to compare the captured owner with a live session read before auth,
 * idempotency, authz, or the route handler can act on the request.
 */
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppEnv } from '../../src/context';
import { getSession, resetAuthMocks } from '../support/auth-mock';

const { replayOwnerSessionMiddleware, sessionMiddleware } =
  await import('../../src/auth/session-middleware');
const { onError } = await import('../../src/error');

const REPLAY_OWNER_HEADER = 'X-Docket-Replay-Owner';

/** Return the session shape the auth test boundary exposes. */
function authSession(userId: string) {
  return {
    user: { id: userId, name: `User ${userId}`, email: `${userId}@example.test` },
  };
}

/**
 * Compose the cached and authoritative production session middleware in their real order.
 */
function replayProbe(handlerCalls: { count: number }): Hono<AppEnv> {
  const root = new Hono<AppEnv>();
  root.use('*', sessionMiddleware);
  root.use('*', replayOwnerSessionMiddleware);
  root.all('*', (c) => {
    handlerCalls.count += 1;
    return c.json({ userId: c.get('session')?.user.id });
  });
  root.onError(onError);
  return root;
}

beforeEach(() => {
  resetAuthMocks();
});

describe('replay-owner session binding', () => {
  it('replaces cached identity with the exact authoritative replay owner before the handler', async () => {
    getSession
      .mockResolvedValueOnce(authSession('cached-user'))
      .mockResolvedValueOnce(authSession('replay-user'));
    const handlerCalls = { count: 0 };

    const response = await replayProbe(handlerCalls).request('/v1/orgs/o1/object-commands', {
      method: 'POST',
      headers: { [REPLAY_OWNER_HEADER]: 'replay-user' },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ userId: 'replay-user' });
    expect(handlerCalls.count).toBe(1);
    expect(getSession).toHaveBeenCalledTimes(2);
    expect(getSession).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ query: { disableCookieCache: true } }),
    );
  });

  it('rejects a valid cached owner when the authoritative session belongs to another user', async () => {
    getSession
      .mockResolvedValueOnce(authSession('queued-owner'))
      .mockResolvedValueOnce(authSession('current-owner'));
    const handlerCalls = { count: 0 };

    const response = await replayProbe(handlerCalls).request('/v1/orgs/o1/object-commands', {
      method: 'POST',
      headers: { [REPLAY_OWNER_HEADER]: 'queued-owner' },
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ status: 401, code: 'unauthorized' });
    expect(handlerCalls.count).toBe(0);
  });

  it('rejects replay when the authoritative session was revoked', async () => {
    getSession.mockResolvedValueOnce(authSession('queued-owner')).mockResolvedValueOnce(null);
    const handlerCalls = { count: 0 };

    const response = await replayProbe(handlerCalls).request('/v1/orgs/o1/object-commands', {
      method: 'POST',
      headers: { [REPLAY_OWNER_HEADER]: 'queued-owner' },
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ status: 401, code: 'unauthorized' });
    expect(handlerCalls.count).toBe(0);
  });

  it('keeps the cached-session path when no replay-owner header is present', async () => {
    getSession.mockResolvedValueOnce(authSession('cached-user'));
    const handlerCalls = { count: 0 };

    const response = await replayProbe(handlerCalls).request('/v1/orgs/o1/object-commands', {
      method: 'POST',
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ userId: 'cached-user' });
    expect(handlerCalls.count).toBe(1);
    expect(getSession).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a non-command POST', 'POST', '/v1/orgs/o1/tasks'],
    ['the wrong method on the command route', 'PATCH', '/v1/orgs/o1/object-commands'],
  ])(
    'rejects the owner header on %s before an authoritative lookup',
    async (_case, method, path) => {
      getSession.mockResolvedValueOnce(authSession('cached-user'));
      const handlerCalls = { count: 0 };

      const response = await replayProbe(handlerCalls).request(path, {
        method,
        headers: { [REPLAY_OWNER_HEADER]: 'cached-user' },
      });

      expect(response.status).toBe(401);
      expect(handlerCalls.count).toBe(0);
      expect(getSession).toHaveBeenCalledOnce();
    },
  );

  it('propagates an authoritative session lookup rejection without reaching the handler', async () => {
    getSession
      .mockResolvedValueOnce(authSession('cached-user'))
      .mockRejectedValueOnce(new Error('Authoritative session lookup failed'));
    const handlerCalls = { count: 0 };
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      const response = await replayProbe(handlerCalls).request('/v1/orgs/o1/object-commands', {
        method: 'POST',
        headers: { [REPLAY_OWNER_HEADER]: 'cached-user' },
      });

      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({ status: 500, code: 'internal' });
      expect(handlerCalls.count).toBe(0);
      expect(getSession).toHaveBeenCalledTimes(2);
      expect(logged).toHaveBeenCalledOnce();
    } finally {
      logged.mockRestore();
    }
  });
});
