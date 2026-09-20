import { runWithRequestState } from '@better-auth/core/context';
import type * as BetterAuthContextModule from '@better-auth/core/context';
import type { DBTransactionAdapter } from '@better-auth/core/db/adapter';
import type * as BetterAuthApiModule from 'better-auth/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const core = vi.hoisted(() => ({ adapter: undefined as DBTransactionAdapter | undefined }));
const live = vi.hoisted(() => ({
  clientId: 'client_1',
  liveIntrospectionResult: vi.fn(async (_adapter, _body, response) => response),
  presentedRevocationToken: vi.fn((body: { token?: string }) => body.token ?? 'token'),
  revokeGrant: vi.fn(async () => undefined),
  verifyRevocableJwt: vi.fn(async () => null as Record<string, unknown> | null),
}));

vi.mock('@better-auth/core/context', async (importOriginal) => ({
  ...(await importOriginal<typeof BetterAuthContextModule>()),
  getCurrentAdapter: async () => core.adapter,
  runWithAdapter: async (_adapter: unknown, callback: () => Promise<unknown>) => callback(),
  runWithTransaction: async (_adapter: unknown, callback: () => Promise<unknown>) => callback(),
}));

vi.mock('better-auth/api', async (importOriginal) => ({
  ...(await importOriginal<typeof BetterAuthApiModule>()),
  createAuthEndpoint: (path: string, options: unknown, handler: (ctx: unknown) => unknown) =>
    Object.assign(handler, { path, options }),
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

vi.mock('../src/oauth-provider-authorization-state', async (importOriginal) => ({
  ...(await importOriginal()),
  rejectRepeatedFields: vi.fn(async () => undefined),
}));

vi.mock('../src/oauth-provider-issuance', () => ({
  assertReturnedAccess: vi.fn(),
  bindReturnedRefresh: vi.fn(),
  extendGrantDeadline: vi.fn(),
  findRefreshSnapshot: vi.fn(),
  materializeCodeGrant: vi.fn(),
  prepareAuthorizationCode: vi.fn(),
  prepareRefresh: vi.fn(),
}));

vi.mock('../src/oauth-provider-live-state', () => ({
  clientIdFromRequest: () => live.clientId,
  liveIntrospectionResult: live.liveIntrospectionResult,
  presentedRevocationToken: live.presentedRevocationToken,
  revokeGrant: live.revokeGrant,
  verifyRevocableJwt: live.verifyRevocableJwt,
}));

import {
  wrapIntrospectionEndpoint,
  wrapRevokeEndpoint,
} from '../src/oauth-provider-token-endpoints';
import {
  savepointState,
  type ProviderEndpoint,
  type SavepointHandle,
} from '../src/oauth-provider-types';

const RESOURCES = {
  issuer: 'https://api.clearthedocket.com/api/auth',
  mcpResource: 'https://api.clearthedocket.com/mcp',
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

function context(
  input: { body?: Record<string, unknown>; context?: Record<string, unknown> } = {},
) {
  return {
    body: input.body ?? {},
    context: { options: {}, ...input.context },
    request: new Request('https://api.clearthedocket.com/oauth2/provider', { method: 'POST' }),
    setHeader: vi.fn(),
  } as never;
}

function savepoint(overrides: Partial<SavepointHandle> = {}): SavepointHandle {
  return {
    run: async (callback) => {
      const current = core.adapter;
      if (!current) throw new Error('Missing test adapter.');
      return callback(current);
    },
    lockClient: async () => true,
    recordJwtRevocation: async () => undefined,
    ...overrides,
  };
}

async function withAdapter<T>(
  current: DBTransactionAdapter,
  callback: () => Promise<T>,
  currentSavepoint: SavepointHandle | null = savepoint(),
): Promise<T> {
  core.adapter = current;
  return runWithRequestState(new WeakMap(), async () => {
    if (currentSavepoint !== null) await savepointState.set(currentSavepoint);
    return callback();
  });
}

beforeEach(() => {
  core.adapter = undefined;
  live.clientId = 'client_1';
  vi.clearAllMocks();
  live.liveIntrospectionResult.mockImplementation(async (_adapter, _body, response) => response);
  live.presentedRevocationToken.mockImplementation((body) => body.token ?? 'token');
  live.revokeGrant.mockResolvedValue(undefined);
  live.verifyRevocableJwt.mockResolvedValue(null);
});

describe('OAuth revoke endpoint wrapper', () => {
  it('requires savepoint state before client authentication', async () => {
    const revoke = wrapRevokeEndpoint(
      endpoint(() => null),
      RESOURCES,
    );
    await withAdapter(
      adapter(),
      async () => {
        await expect(
          revoke(context({ body: { client_id: 'client_1', token: 'token' } })),
        ).rejects.toMatchObject({ body: expect.objectContaining({ error: 'server_error' }) });
      },
      null,
    );
  });

  it('fails closed when the outer client lock loses nested savepoint state', async () => {
    const revoke = wrapRevokeEndpoint(
      endpoint(() => null),
      RESOURCES,
    );
    const disappearing = savepoint({
      lockClient: async () => {
        await savepointState.set(null);
        return true;
      },
    });
    await withAdapter(
      adapter(),
      async () => {
        await expect(
          revoke(context({ body: { client_id: 'client_1', token: 'token' } })),
        ).rejects.toMatchObject({ body: expect.objectContaining({ error: 'server_error' }) });
      },
      disappearing,
    );
  });

  it('rolls back the successful authentication probe before exact revocation', async () => {
    const raw = vi.fn(endpoint(() => null));
    const revoke = wrapRevokeEndpoint(raw, RESOURCES);
    await withAdapter(adapter([[]]), async () => {
      await expect(
        revoke(
          context({
            body: { client_id: 'client_1', client_secret: 'secret', token: 'token' },
          }),
        ),
      ).resolves.toBeNull();
    });
    expect(raw).toHaveBeenCalledWith(
      expect.objectContaining({
        body: {
          client_id: 'client_1',
          client_secret: 'secret',
          token: 'docket-rfc7009-client-authentication-probe',
        },
      }),
    );
  });

  it('rejects malformed or expired JWT claims without recording a revocation', async () => {
    live.verifyRevocableJwt
      .mockResolvedValueOnce({ azp: 'client_1', exp: 'later' })
      .mockResolvedValueOnce({ azp: 'client_1', exp: 0 });
    const record = vi.fn(async () => undefined);
    const revoke = wrapRevokeEndpoint(
      endpoint(() => null),
      RESOURCES,
    );
    for (const token of ['malformed-exp', 'expired']) {
      await withAdapter(
        adapter([[]]),
        async () => {
          await expect(
            revoke(context({ body: { client_id: 'client_1', token } })),
          ).resolves.toBeNull();
        },
        savepoint({ recordJwtRevocation: record }),
      );
    }
    expect(record).not.toHaveBeenCalled();
  });

  it('leaves a revoked refresh family alone when it has no live descendants', async () => {
    const revokedRefresh = {
      clientId: 'client_1',
      docketGrantId: 'grant_1',
      expiresAt: new Date(Date.now() + 60_000),
      revoked: new Date(),
    };
    const revoke = wrapRevokeEndpoint(
      endpoint(() => null),
      RESOURCES,
    );
    const current = adapter([[revokedRefresh], []]);
    await withAdapter(current, async () => {
      await expect(
        revoke(context({ body: { client_id: 'client_1', token: 'revoked-refresh' } })),
      ).resolves.toBeNull();
    });
    expect(current.findMany).toHaveBeenCalledTimes(2);
    expect(live.revokeGrant).not.toHaveBeenCalled();
  });

  it('revokes a refresh family when the presented credential is still live', async () => {
    const liveRefresh = {
      clientId: 'client_1',
      docketGrantId: 'grant_1',
      expiresAt: new Date(Date.now() + 60_000),
      revoked: null,
    };
    const revoke = wrapRevokeEndpoint(
      endpoint(() => null),
      RESOURCES,
    );
    const current = adapter([[liveRefresh]]);
    await withAdapter(current, async () => {
      await expect(
        revoke(context({ body: { client_id: 'client_1', token: 'live-refresh' } })),
      ).resolves.toBeNull();
    });
    expect(current.findMany).toHaveBeenCalledTimes(1);
    expect(live.revokeGrant).toHaveBeenCalledWith(current, 'grant_1', expect.any(Date));
  });

  it('fails closed when savepoint state disappears before JWT revocation storage', async () => {
    live.verifyRevocableJwt.mockResolvedValue({
      azp: 'client_1',
      exp: Math.floor(Date.now() / 1_000) + 60,
    });
    const raw = endpoint(async () => {
      await savepointState.set(null);
      return null;
    });
    const revoke = wrapRevokeEndpoint(raw, RESOURCES);
    await withAdapter(adapter([[], []]), async () => {
      await expect(
        revoke(context({ body: { client_id: 'client_1', token: 'access-token' } })),
      ).rejects.toMatchObject({ body: expect.objectContaining({ error: 'server_error' }) });
    });
  });
});

describe('OAuth introspection endpoint wrapper', () => {
  it('requires savepoint state after authenticating the client identifier', async () => {
    const introspect = wrapIntrospectionEndpoint(
      endpoint(() => ({ active: false })),
      RESOURCES,
    );
    await withAdapter(
      adapter(),
      async () => {
        await expect(introspect(context({ body: { token: 'token' } }))).rejects.toMatchObject({
          body: expect.objectContaining({ error: 'server_error' }),
        });
      },
      null,
    );
  });

  it('preserves provider input across absent and incompatible JWT plugin hooks', async () => {
    const contexts = [
      {},
      { getPlugin: () => null },
      { getPlugin: () => ({}) },
      { getPlugin: () => ({ endpoints: {} }) },
      { getPlugin: () => ({ endpoints: { getJwks: 42 } }) },
    ];
    for (const providerContext of contexts) {
      const raw = vi.fn(endpoint(() => ({ active: false })));
      const introspect = wrapIntrospectionEndpoint(raw, RESOURCES);
      await withAdapter(adapter(), async () => {
        await expect(introspect(context({ body: {}, context: providerContext }))).resolves.toEqual({
          active: false,
        });
      });
      expect(raw).toHaveBeenCalledTimes(1);
    }
  });

  it('adapts the JWT JWKS hook without changing other provider lookups', async () => {
    const getJwks = vi.fn(async () => ({ keys: [] }));
    const otherPlugin = { id: 'other' };
    const getPlugin = vi.fn((id: string) =>
      id === 'jwt' ? { id: 'jwt', endpoints: { getJwks } } : otherPlugin,
    );
    const raw = endpoint(async (input) => {
      const nestedGetPlugin = (input['context'] as Record<string, unknown>)['getPlugin'] as (
        id: string,
      ) => { endpoints?: { getJwks?: (value: Record<string, unknown>) => Promise<unknown> } };
      const jwt = nestedGetPlugin('jwt');
      await jwt.endpoints?.getJwks?.({ marker: true });
      expect(nestedGetPlugin('other')).toBe(otherPlugin);
      return { active: false };
    });
    const introspect = wrapIntrospectionEndpoint(raw, RESOURCES);
    await withAdapter(adapter(), async () => {
      await expect(introspect(context({ body: {}, context: { getPlugin } }))).resolves.toEqual({
        active: false,
      });
    });
    expect(getJwks).toHaveBeenCalledWith(
      expect.objectContaining({ marker: true, asResponse: false, returnHeaders: true }),
    );
  });
});
