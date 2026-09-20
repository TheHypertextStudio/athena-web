import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppEnv } from '../../src/context';
import type * as AuthModule from '@docket/auth';
import type * as OAuthBearerModule from '../../src/auth/oauth-bearer';
import type * as StaffGuardModule from '../../src/permissions/staff-guard';

const verifyRestBearer = vi.fn();
const getSession = vi.fn();
const idempotencyCalls = vi.fn();
const staffCalls = vi.fn();
const rootHandlerCalls = vi.fn();
const contactPointListCalls = vi.fn();

vi.mock('@docket/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthModule>();
  return {
    ...actual,
    auth: {
      ...actual.auth,
      api: { ...actual.auth.api, getSession },
    },
  };
});

vi.mock('../../src/auth/oauth-bearer', async (importOriginal) => {
  const actual = await importOriginal<typeof OAuthBearerModule>();
  return { ...actual, verifyRestBearer };
});

vi.mock('../../src/lib/idempotency', () => {
  const middleware = async (_context: unknown, next: () => Promise<void>): Promise<void> => {
    idempotencyCalls();
    await next();
  };
  return {
    idempotency: middleware,
    idempotencyFor: () => middleware,
  };
});

vi.mock('../../src/permissions/staff-guard', async (importOriginal) => {
  const actual = await importOriginal<typeof StaffGuardModule>();
  return {
    ...actual,
    staffMiddleware: async (_context: unknown, next: () => Promise<void>): Promise<void> => {
      staffCalls();
      await next();
    },
  };
});

vi.mock('../../src/services/notifications/contact-point-service', () => ({
  NotificationContactPointService: class {
    async list(userId: string): Promise<readonly unknown[]> {
      contactPointListCalls(userId);
      return [];
    }
  },
}));

const { app, adminApp } = await import('../../src/app');
const { principalMiddleware, requireSessionPrincipal } =
  await import('../../src/auth/principal-middleware');
const { sessionMiddleware } = await import('../../src/auth/session-middleware');
const { onError } = await import('../../src/error');

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

const SESSION = {
  user: { ...OAUTH_PRINCIPAL.user, id: 'session_user' },
  session: {
    id: 'session_1',
    token: 'session_token_1',
    userId: 'session_user',
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    updatedAt: new Date(),
    ipAddress: null,
    userAgent: null,
  },
};

function productionComposedServer(): Hono<AppEnv> {
  const root = new Hono<AppEnv>();
  root.use('*', sessionMiddleware);
  root.use('*', principalMiddleware);
  root.use('/v1/stream/*', requireSessionPrincipal);
  root.use('/v1/me/account/exports/:exportId/file', requireSessionPrincipal);
  root.get('/v1/stream/sse', (c) => {
    rootHandlerCalls();
    return c.text('stream');
  });
  root.get('/v1/me/account/exports/:exportId/file', (c) => {
    rootHandlerCalls();
    return c.body('export');
  });
  root.use('/admin/*', requireSessionPrincipal);
  root.route('/', adminApp);
  root.get('/admin/openapi.json', (c) => {
    rootHandlerCalls();
    return c.json({});
  });
  root.get('/admin/docs', (c) => {
    rootHandlerCalls();
    return c.html('<main>Admin docs</main>');
  });
  root.route('/', app);
  root.onError(onError);
  return root;
}

const SESSION_ONLY_REPRESENTATIVES = [
  ['account profile', 'GET', '/v1/me/account/profile'],
  ['account deletion step-up', 'DELETE', '/v1/me/account'],
  ['session management', 'POST', '/v1/me/sessions/session_1/revoke'],
  ['passkeys', 'DELETE', '/v1/me/passkeys/passkey_1'],
  ['recovery codes step-up', 'POST', '/v1/me/recovery-codes'],
  ['identities step-up', 'DELETE', '/v1/me/identities/google/account_1'],
  ['contact points', 'GET', '/v1/me/contact-points'],
  ['phone numbers step-up', 'POST', '/v1/me/phone-numbers'],
  ['phone verification step-up', 'POST', '/v1/me/phone-numbers/phone_1/verify'],
  ['phone calling branch', 'POST', '/v1/me/phone-numbers/phone_1/calling'],
  ['phone deletion step-up', 'DELETE', '/v1/me/phone-numbers/phone_1'],
  ['web push', 'POST', '/v1/me/web-push/subscription'],
  ['connected apps', 'DELETE', '/v1/me/connected-apps/client_1'],
  ['consent metadata', 'GET', '/v1/oauth/clients/client_1/metadata'],
  ['share-token management step-up', 'POST', '/v1/time/share-tokens'],
  ['billing read', 'GET', '/v1/orgs/org_1/billing'],
  ['billing mutation', 'POST', '/v1/orgs/org_1/billing/checkout'],
  ['workspace ownership', 'POST', '/v1/orgs'],
  ['membership', 'DELETE', '/v1/orgs/org_1/members/actor_1'],
  ['invitations', 'POST', '/v1/orgs/org_1/members/invitations'],
  ['roles', 'POST', '/v1/orgs/org_1/roles'],
  ['grants', 'DELETE', '/v1/orgs/org_1/grants/grant_1'],
  ['publishing domains', 'POST', '/v1/orgs/org_1/publishing/domains'],
  ['replay-owner object commands', 'POST', '/v1/orgs/org_1/object-commands'],
  ['root account export', 'GET', '/v1/me/account/exports/export_1/file'],
  ['root event stream', 'GET', '/v1/stream/sse'],
  ['staff read', 'GET', '/admin/session'],
  ['staff mutation', 'POST', '/admin/orgs/org_1/reconcile'],
  ['admin OpenAPI', 'GET', '/admin/openapi.json'],
  ['admin docs', 'GET', '/admin/docs'],
] as const;

beforeEach(() => {
  verifyRestBearer.mockReset();
  verifyRestBearer.mockResolvedValue(OAUTH_PRINCIPAL);
  getSession.mockReset();
  idempotencyCalls.mockReset();
  staffCalls.mockReset();
  rootHandlerCalls.mockReset();
  contactPointListCalls.mockReset();
});

describe('production-composed session-only boundaries', () => {
  it.each(SESSION_ONLY_REPRESENTATIVES)(
    'rejects an all-scope OAuth caller from %s before session or operation effects',
    async (_name, method, path) => {
      const response = await productionComposedServer().request(path, {
        method,
        headers: {
          authorization: 'Bearer valid-rest-token',
          cookie: 'better-auth.session_token=must-not-win',
          'idempotency-key': 'must-not-be-claimed',
          ...(path.endsWith('/object-commands')
            ? { 'x-docket-replay-owner': 'must-not-be-resolved' }
            : {}),
        },
      });

      expect(response.status, await response.clone().text()).toBe(403);
      expect(await response.json()).toMatchObject({ code: 'forbidden' });
      expect(response.headers.get('www-authenticate')).toBeNull();
      expect(response.headers.getSetCookie()).toEqual([]);
      expect(getSession).not.toHaveBeenCalled();
      expect(idempotencyCalls).not.toHaveBeenCalled();
      expect(staffCalls).not.toHaveBeenCalled();
      expect(rootHandlerCalls).not.toHaveBeenCalled();
      expect(contactPointListCalls).not.toHaveBeenCalled();
    },
  );

  it.each(SESSION_ONLY_REPRESENTATIVES)(
    'lets a cookie-only caller reach the existing %s route behavior',
    async (_name, method, path) => {
      getSession.mockImplementation(async (options: { readonly returnHeaders?: boolean }) =>
        options.returnHeaders ? { headers: new Headers(), response: SESSION } : SESSION,
      );
      const response = await productionComposedServer().request(path, {
        method,
        headers: {
          cookie: 'better-auth.session_token=session_token_1',
          'content-type': 'application/json',
          ...(path.endsWith('/object-commands') ? { 'x-docket-replay-owner': 'session_user' } : {}),
        },
        ...(method === 'GET' ? {} : { body: '{}' }),
      });

      expect(response.status).not.toBe(401);
      expect(response.status).not.toBe(403);
      expect(getSession).toHaveBeenCalled();
      expect(verifyRestBearer).not.toHaveBeenCalled();
      if (path.endsWith('/object-commands')) expect(idempotencyCalls).toHaveBeenCalled();
      if (path === '/v1/me/contact-points') {
        expect(contactPointListCalls).toHaveBeenCalledWith('session_user');
      }
    },
  );
});
