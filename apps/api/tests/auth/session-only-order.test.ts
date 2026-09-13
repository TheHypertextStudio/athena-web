import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppEnv } from '../../src/context';
import type * as AuthModule from '@docket/auth';
import type * as OAuthBearerModule from '../../src/auth/oauth-bearer';

const verifyRestBearer = vi.fn();
const getSession = vi.fn();

vi.mock('@docket/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthModule>();
  return {
    ...actual,
    auth: {
      ...actual.auth,
      api: {
        ...actual.auth.api,
        getSession,
      },
    },
  };
});

vi.mock('../../src/auth/oauth-bearer', async (importOriginal) => {
  const actual = await importOriginal<typeof OAuthBearerModule>();
  return { ...actual, verifyRestBearer };
});

const { principalMiddleware } = await import('../../src/auth/principal-middleware');
const { authoritativeSessionMiddleware, replayOwnerSessionMiddleware, sessionMiddleware } =
  await import('../../src/auth/session-middleware');
const { onError } = await import('../../src/error');
const { mediaTypes } = await import('../../src/lib/media-types');
const { requireAuth } = await import('../../src/permissions/require-auth');

const OAUTH_PRINCIPAL = {
  kind: 'oauth' as const,
  userId: 'oauth_user',
  user: {
    id: 'oauth_user',
    name: 'OAuth user',
    email: 'oauth@example.test',
    emailVerified: true,
    image: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  clientId: 'client_1',
  scopes: ['work:read', 'work:write', 'agents:run', 'connectors:link'] as const,
};

function productionOrderProbe(): Hono<AppEnv> {
  const root = new Hono<AppEnv>();
  root.use('*', sessionMiddleware);
  root.use('*', principalMiddleware);

  const api = new Hono<AppEnv>().basePath('/v1');
  for (const path of [
    '/me/sessions',
    '/me/sessions/*',
    '/me/account',
    '/me/account/*',
    '/me/recovery-codes',
    '/me/recovery-codes/*',
    '/me/passkeys',
    '/me/passkeys/*',
  ]) {
    api.use(path, authoritativeSessionMiddleware);
  }
  api.use('*', replayOwnerSessionMiddleware);
  api.use('*', requireAuth);
  api.use('*', mediaTypes);
  api.all('*', (c) => c.json({ ok: true }));
  root.route('/', api);
  root.onError(onError);
  return root;
}

beforeEach(() => {
  verifyRestBearer.mockReset();
  verifyRestBearer.mockResolvedValue(OAUTH_PRINCIPAL);
  getSession.mockReset();
});

describe('session-only access ordering', () => {
  it.each([
    ['account', '/v1/me/account'],
    ['session management', '/v1/me/sessions/session_1/revoke'],
    ['passkeys', '/v1/me/passkeys/passkey_1'],
    ['recovery codes', '/v1/me/recovery-codes'],
  ])(
    'rejects an OAuth caller from %s as forbidden before content negotiation',
    async (_name, path) => {
      const response = await productionOrderProbe().request(path, {
        method: 'POST',
        headers: {
          accept: 'application/xml',
          authorization: 'Bearer valid',
          cookie: 'better-auth.session_token=must-not-be-read',
        },
      });

      expect(response.status).toBe(403);
      expect(((await response.json()) as { code: string }).code).toBe('forbidden');
      expect(getSession).not.toHaveBeenCalled();
      expect(response.headers.getSetCookie()).toEqual([]);
    },
  );

  it('rejects an OAuth replay-owner request as forbidden before content negotiation', async () => {
    const response = await productionOrderProbe().request('/v1/orgs/org_1/object-commands', {
      method: 'POST',
      headers: {
        accept: 'application/xml',
        authorization: 'Bearer valid',
        cookie: 'better-auth.session_token=must-not-be-read',
        'X-Docket-Replay-Owner': 'oauth_user',
      },
    });

    expect(response.status).toBe(403);
    expect(((await response.json()) as { code: string }).code).toBe('forbidden');
    expect(getSession).not.toHaveBeenCalled();
    expect(response.headers.getSetCookie()).toEqual([]);
  });
});
