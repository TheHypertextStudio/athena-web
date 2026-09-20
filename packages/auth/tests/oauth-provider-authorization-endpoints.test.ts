import { runWithRequestState } from '@better-auth/core/context';
import type * as BetterAuthContextModule from '@better-auth/core/context';
import type { DBTransactionAdapter } from '@better-auth/core/db/adapter';
import type * as OAuthProviderModule from '@better-auth/oauth-provider';
import { APIError } from 'better-auth/api';
import type * as BetterAuthApiModule from 'better-auth/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const core = vi.hoisted(() => ({
  adapter: undefined as DBTransactionAdapter | undefined,
  transactionSteps: [] as ('run' | 'skip' | 'throw')[],
}));
const providerState = vi.hoisted(() => vi.fn());

vi.mock('@better-auth/core/context', async (importOriginal) => ({
  ...(await importOriginal<typeof BetterAuthContextModule>()),
  getCurrentAdapter: async () => core.adapter,
  runWithAdapter: async (_adapter: unknown, callback: () => Promise<unknown>) => callback(),
  runWithTransaction: async (_adapter: unknown, callback: () => Promise<unknown>) => {
    const step = core.transactionSteps.shift() ?? 'run';
    if (step === 'throw') throw new Error('nested transaction failed');
    return step === 'skip' ? undefined : callback();
  },
}));

vi.mock('@better-auth/oauth-provider', async (importOriginal) => ({
  ...(await importOriginal<typeof OAuthProviderModule>()),
  getOAuthProviderState: providerState,
}));

vi.mock('better-auth/api', async (importOriginal) => {
  const actual = await importOriginal<typeof BetterAuthApiModule>();
  return {
    ...actual,
    createAuthEndpoint: (path: string, options: unknown, handler: (ctx: unknown) => unknown) =>
      Object.assign(handler, { path, options }),
  };
});

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

import {
  wrapAuthorizeEndpoint,
  wrapConsentEndpoint,
  wrapContinueEndpoint,
} from '../src/oauth-provider-authorization-endpoints';
import {
  heldClientLockState,
  savepointState,
  type ProviderEndpoint,
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
  } as unknown as DBTransactionAdapter;
}

function context(
  input: {
    query?: Record<string, unknown>;
    body?: Record<string, unknown>;
    baseURL?: unknown;
    headers?: unknown;
  } = {},
) {
  return {
    query: input.query ?? {},
    body: input.body,
    headers: input.headers,
    context: {
      options: {},
      adapter: core.adapter,
      ...(input.baseURL === undefined ? {} : { baseURL: input.baseURL }),
    },
  } as never;
}

function redirect(location: string): APIError {
  const error = new APIError('FOUND', { message: 'Continue.' });
  error.headers = { location };
  return error;
}

async function withTransaction<T>(
  currentAdapter: DBTransactionAdapter,
  callback: () => Promise<T>,
  options: { lockClient?: boolean; savepoint?: boolean } = {},
): Promise<T> {
  core.adapter = currentAdapter;
  return runWithRequestState(new WeakMap(), async () => {
    if (options.savepoint !== false) {
      await savepointState.set({
        run: async (run) => run(currentAdapter),
        lockClient: async () => options.lockClient ?? false,
        recordJwtRevocation: async () => undefined,
      });
    }
    return callback();
  });
}

beforeEach(() => {
  core.adapter = undefined;
  core.transactionSteps = [];
  providerState.mockReset();
});

describe('OAuth authorization endpoint wrappers', () => {
  it('rejects invalid resource shapes before provider dispatch', async () => {
    const raw = endpoint(() => 'unreachable');
    const authorize = wrapAuthorizeEndpoint(raw, RESOURCES);

    await withTransaction(adapter(), async () => {
      await expect(authorize(context({ query: {} }))).rejects.toMatchObject({
        body: expect.objectContaining({ error: 'invalid_request' }),
      });
      await expect(
        authorize(context({ query: { client_id: 42, resource: [MCP] } })),
      ).rejects.toMatchObject({
        body: expect.objectContaining({ error: 'invalid_request' }),
      });
    });
    expect(raw).not.toHaveProperty('mock');
  });

  it('uses a held client lock with exact row cardinality and an empty body', async () => {
    for (const rows of [[], [undefined], [{ clientId: 'client_1', disabled: true }]]) {
      const heldAdapter = adapter([rows]);
      const raw = vi.fn(endpoint((input) => input['body']));
      const authorize = wrapAuthorizeEndpoint(raw, RESOURCES);
      await runWithRequestState(new WeakMap(), async () => {
        await heldClientLockState.set({ clientId: 'client_1', adapter: heldAdapter });
        await expect(
          authorize(context({ query: { client_id: 'client_1', resource: MCP } })),
        ).resolves.toEqual({});
      });
      expect(raw).toHaveBeenCalledTimes(1);
    }
  });

  it('requires an active savepoint before taking the client lock', async () => {
    const authorize = wrapAuthorizeEndpoint(
      endpoint(() => null),
      RESOURCES,
    );
    await withTransaction(
      adapter(),
      () =>
        expect(
          authorize(context({ query: { client_id: 'client_1', resource: MCP } })),
        ).rejects.toMatchObject({ body: expect.objectContaining({ error: 'server_error' }) }),
      { savepoint: false },
    );
  });

  it('dispatches an enabled locked client after authorization revalidation', async () => {
    const raw = vi.fn(endpoint(() => ({ authorized: true })));
    const authorize = wrapAuthorizeEndpoint(raw, RESOURCES);
    const client = { clientId: 'client_1', disabled: false, skipConsent: true };
    await withTransaction(
      adapter([[client]]),
      async () => {
        await expect(
          authorize(context({ query: { client_id: 'client_1', resource: MCP } })),
        ).resolves.toEqual({ authorized: true });
      },
      { lockClient: true },
    );
    expect(raw).toHaveBeenCalledTimes(1);
  });

  it('commits navigation redirects and rethrows them after the client transaction', async () => {
    const navigation = redirect('/continue');
    const authorize = wrapAuthorizeEndpoint(
      endpoint(() => {
        throw navigation;
      }),
      RESOURCES,
    );
    await withTransaction(adapter(), async () => {
      await expect(
        authorize(
          context({
            query: { client_id: 'client_1', resource: MCP },
            body: { prompt: 'login' },
          }),
        ),
      ).rejects.toBe(navigation);
    });
  });

  it('probes consent with repeated query fields and then issues one code', async () => {
    providerState.mockResolvedValue({
      query: `client_id=client_1&resource=${encodeURIComponent(MCP)}&scope=one&scope=two&scope=three`,
    });
    const rawAuthorize = vi.fn(
      endpoint((input) => {
        expect((input['headers'] as Headers).get('accept')).toBe('application/json');
        expect(input['query']).toMatchObject({ scope: ['one', 'two', 'three'] });
        return { redirect: true, url: '/oauth/authorize' };
      }),
    );
    const rawConsent = endpoint(() => ({ redirect: true, url: '/callback?code=issued' }));
    const consent = wrapConsentEndpoint(rawConsent, rawAuthorize, RESOURCES, '/oauth/authorize');
    const client = { clientId: 'client_1', disabled: false, skipConsent: true };

    await withTransaction(
      adapter([[client]]),
      async () => {
        await expect(
          consent(
            context({
              body: { accept: true },
              baseURL: 'https://api.clearthedocket.com',
              headers: new Headers({ 'x-test': 'yes' }),
            }),
          ),
        ).resolves.toMatchObject({ redirect: true, url: '/callback?code=issued' });
      },
      { lockClient: true },
    );
    expect(rawAuthorize).toHaveBeenCalledTimes(1);
  });

  it('preserves a rejected consent request without probing authorization', async () => {
    const rawConsent = vi.fn(endpoint(() => ({ accepted: false })));
    const rawAuthorize = vi.fn(endpoint(() => ({ redirect: true, url: '/oauth/authorize' })));
    const consent = wrapConsentEndpoint(rawConsent, rawAuthorize, RESOURCES, '/oauth/authorize');

    await expect(consent(context({ body: { accept: false } }))).resolves.toEqual({
      accepted: false,
    });
    expect(rawAuthorize).not.toHaveBeenCalled();
  });

  it('replays provider probe results when consent mutation is not allowed', async () => {
    providerState.mockResolvedValue({
      query: `client_id=client_1&resource=${encodeURIComponent(MCP)}`,
    });
    for (const value of [
      null,
      { redirect: true, url: '/callback?error=denied' },
      { redirect: true, url: 42 },
    ]) {
      const consent = wrapConsentEndpoint(
        endpoint(() => ({ accepted: true })),
        endpoint(() => value),
        RESOURCES,
        '/oauth/authorize',
      );
      await withTransaction(adapter(), async () => {
        await expect(
          consent(context({ body: { accept: true }, baseURL: 'https://api.clearthedocket.com' })),
        ).resolves.toEqual(value);
      });
    }

    const providerFailure = new Error('provider failed before consent');
    const failedConsent = wrapConsentEndpoint(
      endpoint(() => null),
      endpoint(() => {
        throw providerFailure;
      }),
      RESOURCES,
      '/oauth/authorize',
    );
    await withTransaction(adapter(), async () => {
      await expect(
        failedConsent(
          context({ body: { accept: true }, baseURL: 'https://api.clearthedocket.com' }),
        ),
      ).rejects.toBe(providerFailure);
    });
  });

  it('allows a probe that already reaches an authorization code', async () => {
    providerState.mockResolvedValue({
      query: `client_id=client_1&resource=${encodeURIComponent(MCP)}`,
    });
    const consent = wrapConsentEndpoint(
      endpoint(() => ({ redirect: true, url: '/callback?code=issued' })),
      endpoint(() => ({ redirect: true, url: '/callback?code=probe' })),
      RESOURCES,
      '/oauth/authorize',
    );
    const client = { clientId: 'client_1', disabled: false, skipConsent: true };
    await withTransaction(
      adapter([[client]]),
      async () => {
        await expect(
          consent(
            context({
              body: { accept: true },
              baseURL: 'https://api.clearthedocket.com',
              headers: { accept: 'text/html' },
            }),
          ),
        ).resolves.toMatchObject({ url: '/callback?code=issued' });
      },
      { lockClient: true },
    );
  });

  it('fails closed when the nested consent probe loses transaction state', async () => {
    providerState.mockResolvedValue({
      query: `client_id=client_1&resource=${encodeURIComponent(MCP)}`,
    });
    const consent = wrapConsentEndpoint(
      endpoint(() => null),
      endpoint(() => ({ redirect: true, url: '/oauth/authorize' })),
      RESOURCES,
      '/oauth/authorize',
    );
    await runWithRequestState(new WeakMap(), async () => {
      await heldClientLockState.set({ clientId: 'client_1', adapter: adapter([[]]) });
      await expect(
        consent(context({ body: { accept: true }, baseURL: 'https://api.clearthedocket.com' })),
      ).rejects.toMatchObject({ body: expect.objectContaining({ error: 'server_error' }) });
    });
  });

  it.each([
    ['throw', 'nested transaction failed'],
    ['skip', undefined],
  ] as const)(
    'fails closed when the consent probe transaction returns %s',
    async (step, message) => {
      providerState.mockResolvedValue({
        query: `client_id=client_1&resource=${encodeURIComponent(MCP)}`,
      });
      const consent = wrapConsentEndpoint(
        endpoint(() => null),
        endpoint(() => ({ redirect: true, url: '/oauth/authorize' })),
        RESOURCES,
        '/oauth/authorize',
      );
      core.transactionSteps = ['run', step];
      await withTransaction(adapter(), async () => {
        const result = consent(
          context({
            body: { accept: true },
            baseURL: 'https://api.clearthedocket.com',
          }),
        );
        if (message) await expect(result).rejects.toThrow(message);
        else {
          await expect(result).rejects.toMatchObject({
            body: expect.objectContaining({ error: 'server_error' }),
          });
        }
      });
    },
  );

  it('accepts provider-thrown consent redirects and rejects disabled clients', async () => {
    providerState.mockResolvedValue({
      query: `client_id=client_1&resource=${encodeURIComponent(MCP)}`,
    });
    const consent = wrapConsentEndpoint(
      endpoint(() => ({ redirect: true, url: '/callback?code=issued' })),
      endpoint(() => {
        throw redirect('/oauth/authorize');
      }),
      RESOURCES,
      '/oauth/authorize',
    );
    await withTransaction(adapter(), async () => {
      await expect(
        consent(context({ body: { accept: true }, baseURL: 'https://api.clearthedocket.com' })),
      ).rejects.toMatchObject({ body: expect.objectContaining({ error: 'invalid_grant' }) });
    });
  });

  it('preserves provider code outcomes and rolls back non-code outcomes', async () => {
    providerState.mockResolvedValue({
      query: `client_id=client_1&resource=${encodeURIComponent(MCP)}`,
    });
    const client = { clientId: 'client_1', disabled: false, skipConsent: true };
    const scenarios = [
      {
        raw: endpoint(() => ({ redirect: true, url: '/callback' })),
        expected: { redirect: true, url: '/callback' },
      },
      {
        raw: endpoint(() => {
          throw new Error('consent failed');
        }),
        expectedError: 'consent failed',
      },
      {
        raw: endpoint(() => {
          throw redirect('/callback?code=issued');
        }),
        redirect: true,
      },
    ];
    for (const scenario of scenarios) {
      const consent = wrapConsentEndpoint(
        scenario.raw,
        endpoint(() => ({ redirect: true, url: '/oauth/authorize' })),
        RESOURCES,
        '/oauth/authorize',
      );
      await withTransaction(
        adapter([[client]]),
        async () => {
          const result = consent(
            context({
              body: { accept: true },
              baseURL: 'https://api.clearthedocket.com',
            }),
          );
          if (scenario.expectedError) await expect(result).rejects.toThrow(scenario.expectedError);
          else if (scenario.redirect)
            await expect(result).rejects.toMatchObject({ status: 'FOUND' });
          else await expect(result).resolves.toEqual(scenario.expected);
        },
        { lockClient: true },
      );
    }
  });

  it('requires a provider base URL before evaluating a consent redirect', async () => {
    providerState.mockResolvedValue({
      query: `client_id=client_1&resource=${encodeURIComponent(MCP)}`,
    });
    const consent = wrapConsentEndpoint(
      endpoint(() => null),
      endpoint(() => ({ redirect: true, url: '/oauth/authorize' })),
      RESOURCES,
      '/oauth/authorize',
    );
    await withTransaction(adapter(), async () => {
      await expect(consent(context({ body: { accept: true } }))).rejects.toMatchObject({
        body: expect.objectContaining({ error: 'server_error' }),
      });
    });
  });

  it('rechecks flagged continuations and preserves unflagged provider behavior', async () => {
    const raw = vi.fn(endpoint(() => ({ continued: true })));
    const continuation = wrapContinueEndpoint(raw, RESOURCES);
    await expect(continuation(context({ body: {} }))).resolves.toEqual({ continued: true });

    providerState.mockResolvedValue({
      query: `client_id=client_1&resource=${encodeURIComponent(MCP)}`,
    });
    await runWithRequestState(new WeakMap(), async () => {
      await heldClientLockState.set({ clientId: 'client_1', adapter: adapter([[]]) });
      await expect(continuation(context({ body: { selected: true } }))).resolves.toEqual({
        continued: true,
      });
    });
    await runWithRequestState(new WeakMap(), async () => {
      await heldClientLockState.set({
        clientId: 'client_1',
        adapter: adapter([[{ clientId: 'client_1', disabled: false, skipConsent: true }]]),
      });
      await expect(continuation(context({ body: { postLogin: true } }))).resolves.toEqual({
        continued: true,
      });
    });
  });
});
