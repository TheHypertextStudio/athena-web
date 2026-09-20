import { runWithRequestState } from '@better-auth/core/context';
import type * as BetterAuthContextModule from '@better-auth/core/context';
import type { DBTransactionAdapter } from '@better-auth/core/db/adapter';
import type * as BetterAuthApiModule from 'better-auth/api';
import { describe, expect, it, beforeEach, vi } from 'vitest';

const core = vi.hoisted(() => ({ adapter: undefined as DBTransactionAdapter | undefined }));
const issuance = vi.hoisted(() => ({
  assertReturnedAccess: vi.fn(() => ({ exp: 2_000_000_000 })),
  bindReturnedRefresh: vi.fn(async () => null),
  extendGrantDeadline: vi.fn(async () => undefined),
  findRefreshSnapshot: vi.fn(),
  materializeCodeGrant: vi.fn(async () => ({ id: 'grant_1' })),
  prepareAuthorizationCode: vi.fn(),
  prepareRefresh: vi.fn(),
}));
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

vi.mock('../src/oauth-provider-issuance', () => issuance);

vi.mock('../src/oauth-provider-live-state', () => ({
  clientIdFromRequest: () => live.clientId,
  liveIntrospectionResult: live.liveIntrospectionResult,
  presentedRevocationToken: live.presentedRevocationToken,
  revokeGrant: live.revokeGrant,
  verifyRevocableJwt: live.verifyRevocableJwt,
}));

import { wrapTokenEndpoint } from '../src/oauth-provider-token-endpoints';
import {
  savepointState,
  type ProviderEndpoint,
  type SavepointHandle,
} from '../src/oauth-provider-types';

const MCP = 'https://api.clearthedocket.com/mcp';
const REST = 'https://api.clearthedocket.com/v1';
const RESOURCES = {
  issuer: 'https://api.clearthedocket.com/api/auth',
  mcpResource: MCP,
  restResource: REST,
};

function endpoint(
  implementation: (input: Record<string, unknown>) => unknown,
  path = '/provider',
): ProviderEndpoint {
  return Object.assign(async (input: Record<string, unknown>) => implementation(input), {
    path,
    options: {},
  }) as unknown as ProviderEndpoint;
}

function adapter(findResults: unknown[][] = []) {
  const finds = [...findResults];
  return {
    findMany: vi.fn(async () => finds.shift() ?? []),
    create: vi.fn(async (input) => input.data),
    deleteMany: vi.fn(async () => 1),
  } as unknown as DBTransactionAdapter;
}

function context(
  input: {
    body?: Record<string, unknown>;
    context?: Record<string, unknown>;
  } = {},
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
  issuance.assertReturnedAccess.mockReturnValue({ exp: 2_000_000_000 });
  issuance.bindReturnedRefresh.mockResolvedValue(null);
  issuance.extendGrantDeadline.mockResolvedValue(undefined);
  issuance.materializeCodeGrant.mockResolvedValue({ id: 'grant_1' });
  live.liveIntrospectionResult.mockImplementation(async (_adapter, _body, response) => response);
  live.presentedRevocationToken.mockImplementation((body) => body.token ?? 'token');
  live.revokeGrant.mockResolvedValue(undefined);
  live.verifyRevocableJwt.mockResolvedValue(null);
});

describe('OAuth token endpoint wrapper', () => {
  it('delegates an unknown refresh credential to the installed provider', async () => {
    issuance.findRefreshSnapshot.mockResolvedValue(null);
    const raw = vi.fn(endpoint(() => ({ access_token: 'provider' })));
    const token = wrapTokenEndpoint(
      raw,
      endpoint(() => null),
      RESOURCES,
      900,
      3_600,
    );

    await withAdapter(adapter(), async () => {
      await expect(
        token(
          context({
            body: { grant_type: 'refresh_token', refresh_token: 'unknown' },
          }),
        ),
      ).resolves.toEqual({ access_token: 'provider' });
    });
    expect(raw).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      name: 'missing verification identifier',
      prepared: {
        kind: 'delegate-authorization-code',
        body: { grant_type: 'authorization_code', code: 'code' },
        verificationIdentifier: '',
      },
    },
    {
      name: 'missing code grant',
      prepared: {
        kind: 'issue',
        body: { grant_type: 'authorization_code', code: 'code' },
        state: {
          kind: 'authorization_code',
          clientId: 'client_1',
          userId: 'user_1',
          resource: MCP,
          grantId: 'grant_1',
          verificationIdentifier: 'code:1',
        },
      },
    },
  ])('fails closed for an authorization code with $name', async ({ prepared }) => {
    issuance.prepareAuthorizationCode.mockResolvedValue(prepared);
    const token = wrapTokenEndpoint(
      endpoint(() => null),
      endpoint(() => null),
      RESOURCES,
      900,
      3_600,
    );
    await withAdapter(adapter(), async () => {
      await expect(
        token(
          context({
            body: { grant_type: 'authorization_code', code: 'code' },
          }),
        ),
      ).rejects.toMatchObject({ body: expect.objectContaining({ error: 'server_error' }) });
    });
  });

  it('requires a savepoint for delegated authorization-code validation', async () => {
    issuance.prepareAuthorizationCode.mockResolvedValue({
      kind: 'delegate-authorization-code',
      body: { grant_type: 'authorization_code', code: 'code' },
      verificationIdentifier: 'code:1',
    });
    const token = wrapTokenEndpoint(
      endpoint(() => null),
      endpoint(() => null),
      RESOURCES,
      900,
      3_600,
    );
    await withAdapter(
      adapter(),
      async () => {
        await expect(
          token(
            context({
              body: { grant_type: 'authorization_code', code: 'code' },
            }),
          ),
        ).rejects.toMatchObject({ body: expect.objectContaining({ error: 'server_error' }) });
      },
      null,
    );
  });

  it('returns the installed provider response for a delegated authorization code', async () => {
    issuance.prepareAuthorizationCode.mockResolvedValue({
      kind: 'delegate-authorization-code',
      body: { grant_type: 'authorization_code', code: 'code' },
      verificationIdentifier: 'code:1',
    });
    const token = wrapTokenEndpoint(
      endpoint(() => ({ error: 'provider-owned-result' })),
      endpoint(() => null),
      RESOURCES,
      900,
      3_600,
    );
    await withAdapter(adapter(), async () => {
      await expect(
        token(
          context({
            body: { grant_type: 'authorization_code', code: 'code' },
          }),
        ),
      ).resolves.toEqual({ error: 'provider-owned-result' });
    });
  });

  it('rejects malformed prepared token responses before grant settlement', async () => {
    issuance.findRefreshSnapshot.mockResolvedValue({
      digest: 'digest',
      record: { clientId: 'client_1' },
    });
    issuance.prepareRefresh.mockResolvedValue({
      kind: 'issue',
      body: { grant_type: 'refresh_token', refresh_token: 'refresh' },
      state: {
        kind: 'refresh_token',
        clientId: 'client_1',
        userId: 'user_1',
        resource: MCP,
        grantId: 'grant_1',
      },
    });
    const token = wrapTokenEndpoint(
      endpoint(() => ({ scope: 'work:read' })),
      endpoint(() => null),
      RESOURCES,
      900,
      3_600,
    );
    await withAdapter(adapter(), async () => {
      await expect(
        token(
          context({
            body: { grant_type: 'refresh_token', refresh_token: 'refresh' },
          }),
        ),
      ).rejects.toMatchObject({ body: expect.objectContaining({ error: 'server_error' }) });
    });
  });

  it.each([
    { name: 'owned family', nextClientId: 'client_1', grantId: 'grant_1', revokes: true },
    { name: 'changed client', nextClientId: 'client_2', grantId: 'grant_1', revokes: false },
    { name: 'unbound family', nextClientId: 'client_1', grantId: null, revokes: false },
  ])('rejects a stale refresh from an $name', async ({ nextClientId, grantId, revokes }) => {
    issuance.findRefreshSnapshot.mockResolvedValue({
      digest: 'digest',
      record: { clientId: 'client_1' },
    });
    issuance.prepareRefresh.mockImplementation(async () => {
      live.clientId = nextClientId;
      return {
        kind: 'stale-refresh',
        refresh: { clientId: 'client_1', docketGrantId: grantId },
      };
    });
    const raw = vi.fn(endpoint(() => ({ access_token: 'unreachable' })));
    const token = wrapTokenEndpoint(
      raw,
      endpoint(() => null),
      RESOURCES,
      900,
      3_600,
    );
    await withAdapter(adapter(), async () => {
      await expect(
        token(
          context({
            body: { grant_type: 'refresh_token', refresh_token: 'refresh' },
          }),
        ),
      ).rejects.toMatchObject({ body: expect.objectContaining({ error: 'invalid_grant' }) });
    });
    expect(live.revokeGrant).toHaveBeenCalledTimes(revokes ? 1 : 0);
    expect(raw).not.toHaveBeenCalled();
  });

  it('fails closed when a consumed delegated code throws a non-Error value', async () => {
    issuance.prepareAuthorizationCode.mockResolvedValue({
      kind: 'delegate-authorization-code',
      body: { grant_type: 'authorization_code', code: 'code' },
      verificationIdentifier: 'code:1',
    });
    const providerFailure = vi.fn().mockRejectedValue('provider-string-failure');
    const token = wrapTokenEndpoint(
      endpoint(providerFailure),
      endpoint(() => null),
      RESOURCES,
      900,
      3_600,
    );
    await withAdapter(adapter([[]]), async () => {
      await expect(
        token(
          context({
            body: { grant_type: 'authorization_code', code: 'code' },
          }),
        ),
      ).rejects.toMatchObject({ body: expect.objectContaining({ error: 'server_error' }) });
    });
  });
});
