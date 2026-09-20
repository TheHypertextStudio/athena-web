import { runWithRequestState } from '@better-auth/core/context';
import type * as BetterAuthContextModule from '@better-auth/core/context';
import type { DBTransactionAdapter } from '@better-auth/core/db/adapter';
import type * as OAuthProviderModule from '@better-auth/oauth-provider';
import type { BetterAuthPlugin } from 'better-auth';
import type * as BetterAuthApiModule from 'better-auth/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const core = vi.hoisted(() => ({ adapter: undefined as DBTransactionAdapter | undefined }));
const providerState = vi.hoisted(() => vi.fn());
const genericState = vi.hoisted(() => vi.fn());

vi.mock('@better-auth/core/context', async (importOriginal) => ({
  ...(await importOriginal<typeof BetterAuthContextModule>()),
  getCurrentAdapter: async () => core.adapter,
  runWithTransaction: async (_adapter: unknown, callback: () => Promise<unknown>) => callback(),
}));

vi.mock('@better-auth/oauth-provider', async (importOriginal) => ({
  ...(await importOriginal<typeof OAuthProviderModule>()),
  getOAuthProviderState: providerState,
}));

vi.mock('better-auth/api', async (importOriginal) => ({
  ...(await importOriginal<typeof BetterAuthApiModule>()),
  createAuthMiddleware: (handler: (ctx: unknown) => unknown) => handler,
  getOAuthState: genericState,
}));

vi.mock('../src/oauth-provider-transaction', () => ({
  coordinatingAdapter: () => ({ transaction: vi.fn() }),
  rawInput: (
    ctx: { context?: Record<string, unknown> },
    adapter: DBTransactionAdapter,
    body: Record<string, unknown>,
  ) => ({
    ...ctx,
    body,
    context: { ...ctx.context, adapter },
    asResponse: false,
    returnHeaders: false,
    returnStatus: false,
  }),
}));

import { wrapPostLoginAuthorizeHook } from '../src/oauth-provider-authorization-endpoints';
import { heldClientLockState, type ProviderEndpoint } from '../src/oauth-provider-types';

const MCP = 'https://api.clearthedocket.com/mcp';
const RESOURCES = {
  issuer: 'https://api.clearthedocket.com/api/auth',
  mcpResource: MCP,
  restResource: 'https://api.clearthedocket.com/v1',
};

function endpoint(implementation: (input: Record<string, unknown>) => unknown): ProviderEndpoint {
  return Object.assign(async (input: Record<string, unknown>) => implementation(input), {
    path: '/provider',
    options: {},
  }) as unknown as ProviderEndpoint;
}

function adapter(findResults: unknown[][] = []) {
  const finds = [...findResults];
  return {
    findMany: vi.fn(async () => finds.shift() ?? []),
  } as unknown as DBTransactionAdapter;
}

function context() {
  return {
    query: {},
    context: { options: {}, adapter: core.adapter },
  } as never;
}

beforeEach(() => {
  core.adapter = undefined;
  providerState.mockReset();
  genericState.mockReset();
});

describe('OAuth post-login authorization hook wrapper', () => {
  it('rejects changed hook shapes and bypasses absent state', async () => {
    for (const hooks of [
      undefined,
      [],
      [{ handler: endpoint(() => null) }, { handler: endpoint(() => null) }],
    ]) {
      const plugin = {
        hooks: hooks === undefined ? undefined : { after: hooks },
      } as BetterAuthPlugin;
      expect(() => {
        wrapPostLoginAuthorizeHook(plugin, RESOURCES);
      }).toThrow('The installed OAuth provider post-login hook shape changed.');
    }

    const raw = vi.fn(endpoint(() => ({ postLogin: true })));
    const plugin = {
      hooks: { after: [{ matcher: () => true, handler: raw }] },
    } as unknown as BetterAuthPlugin;
    wrapPostLoginAuthorizeHook(plugin, RESOURCES);
    providerState.mockResolvedValue({});
    genericState.mockResolvedValue({});
    const handler = plugin.hooks?.after?.[0]?.handler as unknown as ProviderEndpoint;
    await expect(handler(context())).resolves.toEqual({ postLogin: true });

    providerState.mockResolvedValue({
      query: `client_id=client_1&resource=${encodeURIComponent(MCP)}`,
    });
    await runWithRequestState(new WeakMap(), async () => {
      await heldClientLockState.set({ clientId: 'client_1', adapter: adapter([[]]) });
      await expect(handler(context())).resolves.toEqual({ postLogin: true });
    });
    await runWithRequestState(new WeakMap(), async () => {
      await heldClientLockState.set({
        clientId: 'client_1',
        adapter: adapter([[{ clientId: 'client_1', disabled: false, skipConsent: true }]]),
      });
      await expect(handler(context())).resolves.toEqual({ postLogin: true });
    });
  });
});
