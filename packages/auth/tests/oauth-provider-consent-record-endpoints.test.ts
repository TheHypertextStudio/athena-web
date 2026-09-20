import { runWithRequestState } from '@better-auth/core/context';
import type * as BetterAuthContextModule from '@better-auth/core/context';
import type { DBTransactionAdapter } from '@better-auth/core/db/adapter';
import type * as BetterAuthApiModule from 'better-auth/api';
import { describe, expect, it, vi } from 'vitest';

const core = vi.hoisted(() => ({ adapter: undefined as DBTransactionAdapter | undefined }));

vi.mock('@better-auth/core/context', async (importOriginal) => ({
  ...(await importOriginal<typeof BetterAuthContextModule>()),
  getCurrentAdapter: async () => core.adapter,
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
  ) => ({ ...ctx, body, context: { ...ctx.context, adapter } }),
}));

import { wrapConsentRecordEndpoint } from '../src/oauth-provider-authorization-endpoints';
import { savepointState, type ProviderEndpoint } from '../src/oauth-provider-types';

function endpoint(implementation: (input: Record<string, unknown>) => unknown): ProviderEndpoint {
  return Object.assign(async (input: Record<string, unknown>) => implementation(input), {
    path: '/consent-record',
    options: {},
  }) as unknown as ProviderEndpoint;
}

function adapter(findResults: unknown[][] = []) {
  const finds = [...findResults];
  return {
    findMany: vi.fn(async () => finds.shift() ?? []),
    updateMany: vi.fn(async () => 1),
    deleteMany: vi.fn(async () => 1),
    create: vi.fn(async (input) => input.data),
  } as unknown as DBTransactionAdapter;
}

function context(body: Record<string, unknown>) {
  return { body, context: { options: {} } } as never;
}

async function withTransaction<T>(
  current: DBTransactionAdapter,
  callback: () => Promise<T>,
  includeSavepoint = true,
): Promise<T> {
  core.adapter = current;
  return runWithRequestState(new WeakMap(), async () => {
    if (includeSavepoint) {
      await savepointState.set({
        run: async (run) => run(current),
        lockClient: async () => true,
        recordJwtRevocation: async () => undefined,
      });
    }
    return callback();
  });
}

function consentRecord(userId: string | null = 'user_1') {
  return { id: 'consent_1', clientId: 'client_1', userId, scopes: ['work:read'] };
}

describe('OAuth consent record wrapper', () => {
  it('preserves provider behavior for missing and concurrently deleted records', async () => {
    const raw = vi.fn(endpoint(() => ({ provider: true })));
    const wrapped = wrapConsentRecordEndpoint(raw, false);
    await expect(wrapped(context({}))).resolves.toEqual({ provider: true });
    await withTransaction(adapter([[]]), async () => {
      await expect(wrapped(context({ id: 'missing' }))).resolves.toEqual({ provider: true });
    });
    await withTransaction(adapter([[consentRecord()], []]), async () => {
      await expect(wrapped(context({ id: 'consent_1' }))).resolves.toEqual({ provider: true });
    });
    expect(raw).toHaveBeenCalledTimes(3);
  });

  it('requires a savepoint and one exact locked consent row', async () => {
    const wrapped = wrapConsentRecordEndpoint(
      endpoint(() => null),
      false,
    );
    await withTransaction(
      adapter([[consentRecord()]]),
      () =>
        expect(wrapped(context({ id: 'consent_1' }))).rejects.toMatchObject({
          body: expect.objectContaining({ error: 'server_error' }),
        }),
      false,
    );
    for (const locked of [[consentRecord(), consentRecord()], [undefined]]) {
      await withTransaction(adapter([[consentRecord()], locked]), async () => {
        await expect(wrapped(context({ id: 'consent_1' }))).rejects.toMatchObject({
          body: expect.objectContaining({ error: 'invalid_grant' }),
        });
      });
    }
  });

  it('updates a locked consent without revoking its credential family', async () => {
    const wrapped = wrapConsentRecordEndpoint(
      endpoint(() => ({ updated: true })),
      false,
    );
    const consent = consentRecord();
    const current = adapter([[consent], [consent], [{ clientId: 'client_1' }]]);
    await withTransaction(current, async () => {
      await expect(wrapped(context({ id: 'consent_1' }))).resolves.toEqual({ updated: true });
    });
    expect(current.updateMany).not.toHaveBeenCalled();
    expect(current.deleteMany).not.toHaveBeenCalled();
  });

  it('revokes deleted consent credentials and handles every legacy tombstone state', async () => {
    const wrapped = wrapConsentRecordEndpoint(
      endpoint(() => ({ deleted: true })),
      true,
    );
    const scenarios = [
      { consent: consentRecord(null), client: { clientId: 'client_1' }, legacy: [] },
      { consent: consentRecord(), client: { clientId: 'client_1' }, legacy: [] },
      {
        consent: consentRecord(),
        client: { clientId: 'client_1', docketLegacyTrusted: true, docketLegacyBefore: new Date() },
        legacy: [{ id: 'existing' }],
      },
      {
        consent: consentRecord(),
        client: {
          clientId: 'client_1',
          docketLegacyTrusted: true,
          docketLegacyBefore: new Date(0),
        },
        legacy: [],
      },
      {
        consent: consentRecord(),
        client: { clientId: 'client_1', docketLegacyTrusted: true, docketLegacyBefore: new Date() },
        legacy: [],
        creates: true,
      },
    ];
    for (const scenario of scenarios) {
      const current = adapter([
        [scenario.consent],
        [scenario.consent],
        [scenario.client],
        scenario.legacy,
      ]);
      await withTransaction(current, async () => {
        await expect(wrapped(context({ id: 'consent_1' }))).resolves.toEqual({ deleted: true });
      });
      if (scenario.consent.userId) {
        expect(current.updateMany).toHaveBeenCalledTimes(2);
        expect(current.deleteMany).toHaveBeenCalledTimes(1);
      }
      if (scenario.creates) expect(current.create).toHaveBeenCalledTimes(1);
    }
  });
});
