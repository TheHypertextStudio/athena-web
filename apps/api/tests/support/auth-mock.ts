import { vi } from 'vitest';

interface TestSession {
  readonly user: { readonly id: string; readonly name: string; readonly email: string };
}

interface TestMcpSession {
  readonly accessToken: string;
  readonly userId: string;
  readonly scopes: string;
}

const mocks = vi.hoisted(() => ({
  getSession: vi.fn<() => Promise<TestSession | null>>(async () => null),
  getMcpSession: vi.fn<() => Promise<TestMcpSession | null>>(async () => null),
  handler: vi.fn(async () => new Response('ok')),
}));

vi.mock('@docket/auth', () => ({
  auth: {
    api: {
      getSession: mocks.getSession,
      getMcpSession: mocks.getMcpSession,
    },
    handler: mocks.handler,
  },
}));

export const getSession = mocks.getSession;
export const getMcpSession = mocks.getMcpSession;

/**
 * Restore the default unauthenticated Better Auth boundary for the next test.
 */
export function resetAuthMocks(): void {
  getSession.mockReset();
  getSession.mockResolvedValue(null);
  getMcpSession.mockReset();
  getMcpSession.mockResolvedValue(null);
  mocks.handler.mockReset();
  mocks.handler.mockResolvedValue(new Response('ok'));
}
