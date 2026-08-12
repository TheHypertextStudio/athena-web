import { vi } from 'vitest';

import type * as AuthModule from '@docket/auth';

interface TestSession {
  readonly user: { readonly id: string; readonly name: string; readonly email: string };
}

/** The minimal JWT payload shape `resolveBearerContext` reads (`sub` + `scope` claims). */
interface TestJwtPayload {
  readonly sub: string;
  readonly scope: string;
  readonly [claim: string]: unknown;
}

const mocks = vi.hoisted(() => ({
  getSession: vi.fn<(options?: unknown) => Promise<TestSession | null>>(async () => null),
  // Rejects by default (no bearer token configured) - matches `verifyAccessToken` throwing on
  // any unverifiable token, which `resolveBearerContext` catches and turns into an AuthError.
  verifyAccessToken: vi.fn<(token: string, opts: unknown) => Promise<TestJwtPayload>>(async () => {
    throw new Error('no bearer token configured for this test');
  }),
  handler: vi.fn(async () => new Response('ok')),
}));

vi.mock('@docket/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthModule>();

  return {
    ...actual,
    auth: {
      ...actual.auth,
      api: {
        ...actual.auth.api,
        // Better Auth's `getSession` is overloaded on `returnHeaders`: asked for headers it
        // answers `{ headers, response }`, otherwise the session itself. Tests configure the
        // session through `mocks.getSession`; this wrapper reproduces the overload so a caller
        // that forwards refreshed cookies sees the same shape it does in production.
        getSession: async (options?: { readonly returnHeaders?: boolean }) => {
          const session = await mocks.getSession(options);
          return options?.returnHeaders ? { headers: new Headers(), response: session } : session;
        },
      },
      handler: mocks.handler,
    },
    verifyAccessToken: mocks.verifyAccessToken,
  };
});

export const getSession = mocks.getSession;
export const verifyAccessToken = mocks.verifyAccessToken;
export const authHandler = mocks.handler;

/**
 * A realistic `.well-known/oauth-authorization-server` document body, the shape
 * `authorizationServerMetadata` (`mcp/server.ts`) fetches via `auth.handler` in-process and
 * patches `authorization_endpoint` on. Callers that exercise that function should
 * `authHandler.mockResolvedValueOnce(new Response(JSON.stringify(fakeAsMetadata(issuer))))`.
 */
export function fakeAsMetadata(issuer: string): Record<string, unknown> {
  return {
    issuer: `${issuer}/api/auth`,
    authorization_endpoint: `${issuer}/api/auth/oauth2/authorize`,
    token_endpoint: `${issuer}/api/auth/oauth2/token`,
    registration_endpoint: `${issuer}/api/auth/oauth2/register`,
    jwks_uri: `${issuer}/api/auth/jwks`,
    introspection_endpoint: `${issuer}/api/auth/oauth2/introspect`,
    revocation_endpoint: `${issuer}/api/auth/oauth2/revoke`,
    code_challenge_methods_supported: ['S256'],
    scopes_supported: [
      'work:read',
      'work:write',
      'agents:run',
      'connectors:link',
      'offline_access',
    ],
    response_types_supported: ['code'],
    token_endpoint_auth_methods_supported: ['none'],
    client_id_metadata_document_supported: true,
  };
}

/**
 * Restore the default unauthenticated Better Auth boundary for the next test.
 */
export function resetAuthMocks(): void {
  getSession.mockReset();
  getSession.mockResolvedValue(null);
  verifyAccessToken.mockReset();
  verifyAccessToken.mockRejectedValue(new Error('no bearer token configured for this test'));
  mocks.handler.mockReset();
  mocks.handler.mockResolvedValue(new Response('ok'));
}
