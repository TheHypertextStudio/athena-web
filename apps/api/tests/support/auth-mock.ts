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
  getSession: vi.fn<() => Promise<TestSession | null>>(async () => null),
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
        getSession: mocks.getSession,
      },
      handler: mocks.handler,
    },
    verifyAccessToken: mocks.verifyAccessToken,
  };
});

export const getSession = mocks.getSession;
export const verifyAccessToken = mocks.verifyAccessToken;

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
