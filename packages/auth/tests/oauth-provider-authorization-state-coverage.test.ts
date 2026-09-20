import { runWithRequestState } from '@better-auth/core/context';
import type { DBTransactionAdapter } from '@better-auth/core/db/adapter';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  assertAuthorizationState,
  authorizationStateQuery,
  currentConsent,
  intersectScopes,
  loadOne,
  lockClient,
  parseCurrentAuthorizationRequest,
  parseVerification,
  rejectRepeatedFields,
  requestedRefreshScopes,
} from '../src/oauth-provider-authorization-state';
import { delegateTokenToProvider, savepointState } from '../src/oauth-provider-types';

const MCP = 'https://api.clearthedocket.com/mcp';
const REST = 'https://api.clearthedocket.com/v1';
const RESOURCES = {
  issuer: 'https://api.clearthedocket.com/api/auth',
  mcpResource: MCP,
  restResource: REST,
};

function verification(value: unknown) {
  return { identifier: 'code:1', value: JSON.stringify(value), expiresAt: new Date() };
}

function adapter(rows: unknown[]): DBTransactionAdapter {
  return { findMany: vi.fn(async () => rows) } as unknown as DBTransactionAdapter;
}

describe('OAuth authorization state', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses a complete verification snapshot without dropping optional values', () => {
    const value = {
      type: 'authorization_code',
      query: {
        client_id: 'client_1',
        resource: REST,
        scope: 'work:read',
        redirect_uri: 'https://client.example.test/callback',
        code_challenge: 'challenge',
        code_challenge_method: 'S256',
      },
      userId: 'user_1',
      sessionId: 'session_1',
      referenceId: null,
      authTime: 42,
    };

    expect(parseVerification(verification(value), RESOURCES)).toEqual({
      query: value.query,
      userId: 'user_1',
      sessionId: 'session_1',
      referenceId: null,
      authTime: 42,
    });
  });

  it('omits absent optional verification values', () => {
    expect(
      parseVerification(
        verification({
          type: 'authorization_code',
          query: { client_id: 'client_1', resource: MCP },
          userId: 'user_1',
          sessionId: 'session_1',
        }),
        RESOURCES,
      ),
    ).toEqual({
      query: { client_id: 'client_1', resource: MCP },
      userId: 'user_1',
      sessionId: 'session_1',
    });
  });

  it('rejects malformed, unbound, and unknown verification state', () => {
    expect(parseVerification(verification({ type: 'wrong' }), RESOURCES)).toBeNull();
    expect(() =>
      parseVerification(
        verification({
          type: 'authorization_code',
          query: { client_id: 'client_1' },
          userId: 'user_1',
          sessionId: 'session_1',
        }),
        RESOURCES,
      ),
    ).toThrow(
      expect.objectContaining({ body: expect.objectContaining({ error: 'invalid_grant' }) }),
    );
    expect(() =>
      parseVerification(
        verification({
          type: 'authorization_code',
          query: { client_id: 'client_1', resource: `${REST}/other` },
          userId: 'user_1',
          sessionId: 'session_1',
        }),
        RESOURCES,
      ),
    ).toThrow(
      expect.objectContaining({ body: expect.objectContaining({ error: 'invalid_grant' }) }),
    );
  });

  it('parses exact authorization queries and preserves the compatibility default', () => {
    expect(parseCurrentAuthorizationRequest('client_id=client_1', RESOURCES)).toEqual({
      clientId: 'client_1',
      resource: MCP,
    });
    expect(
      parseCurrentAuthorizationRequest(
        `client_id=client_1&resource=${encodeURIComponent(REST)}`,
        RESOURCES,
      ),
    ).toEqual({
      clientId: 'client_1',
      resource: REST,
    });
    expect(parseCurrentAuthorizationRequest('', RESOURCES)).toEqual({
      clientId: '',
      resource: MCP,
    });
    expect(() =>
      parseCurrentAuthorizationRequest('client_id=one&client_id=two', RESOURCES),
    ).toThrow(
      expect.objectContaining({ body: expect.objectContaining({ error: 'invalid_request' }) }),
    );
    expect(() =>
      parseCurrentAuthorizationRequest('client_id=one&resource=unknown', RESOURCES),
    ).toThrow(
      expect.objectContaining({ body: expect.objectContaining({ error: 'invalid_target' }) }),
    );
  });

  it.each([
    [null, undefined],
    [false, undefined],
    [{}, undefined],
    [{ query: 42 }, undefined],
    [{ query: 'client_id=client_1' }, 'client_id=client_1'],
  ])('reads an authorization query from %j', (value, expected) => {
    expect(authorizationStateQuery(value)).toBe(expected);
  });

  it('rejects absent, unreadable, and repeated singleton form fields', async () => {
    await expect(rejectRepeatedFields(undefined, ['token'])).rejects.toMatchObject({
      body: expect.objectContaining({ error: 'invalid_request' }),
    });
    await expect(
      rejectRepeatedFields(
        {
          clone: () => ({
            text: async () => {
              throw new Error('unreadable');
            },
          }),
        } as unknown as Request,
        ['token'],
      ),
    ).rejects.toMatchObject({ body: expect.objectContaining({ error: 'invalid_request' }) });
    await expect(
      rejectRepeatedFields(
        new Request('https://api.example.test', {
          method: 'POST',
          body: new URLSearchParams([
            ['token', 'one'],
            ['token', 'two'],
          ]),
        }),
        ['token'],
      ),
    ).rejects.toMatchObject({ body: expect.objectContaining({ error: 'invalid_request' }) });
    await expect(
      rejectRepeatedFields(
        new Request('https://api.example.test', {
          method: 'POST',
          body: new URLSearchParams({ token: 'one' }),
        }),
        ['token'],
      ),
    ).resolves.toBeUndefined();
  });

  it('rejects a non-string form entry from a hostile FormData implementation', async () => {
    vi.stubGlobal(
      'FormData',
      class {
        append() {
          return undefined;
        }
        getAll() {
          return [new Blob()];
        }
      },
    );
    await expect(
      rejectRepeatedFields(new Request('https://api.example.test', { method: 'POST' }), ['token']),
    ).rejects.toMatchObject({ body: expect.objectContaining({ error: 'invalid_request' }) });
  });

  it('loads exactly one provider row', async () => {
    await expect(loadOne<{ id: string }>(adapter([{ id: 'one' }]), 'model', [])).resolves.toEqual({
      id: 'one',
    });
    await expect(loadOne(adapter([]), 'model', [])).rejects.toMatchObject({
      body: expect.objectContaining({ error: 'invalid_grant' }),
    });
    await expect(loadOne(adapter([undefined]), 'model', [])).rejects.toMatchObject({
      body: expect.objectContaining({ error: 'invalid_grant' }),
    });
    await expect(
      loadOne(adapter([{ id: 'one' }, { id: 'two' }]), 'model', []),
    ).rejects.toMatchObject({
      body: expect.objectContaining({ error: 'invalid_grant' }),
    });
  });

  it('locks and reloads only one enabled client from request-local state', async () => {
    await runWithRequestState(new WeakMap(), async () => {
      await expect(lockClient(adapter([]), 'client_1')).rejects.toMatchObject({
        body: expect.objectContaining({ error: 'server_error' }),
      });
    });
    await runWithRequestState(new WeakMap(), async () => {
      await savepointState.set({
        run: async (callback) => callback(adapter([])),
        lockClient: async () => false,
        recordJwtRevocation: async () => undefined,
      });
      await expect(lockClient(adapter([]), 'client_1')).rejects.toBe(delegateTokenToProvider);
    });
    await runWithRequestState(new WeakMap(), async () => {
      await savepointState.set({
        run: async (callback) => callback(adapter([])),
        lockClient: async () => true,
        recordJwtRevocation: async () => undefined,
      });
      await expect(
        lockClient(adapter([{ clientId: 'client_1', disabled: true }]), 'client_1'),
      ).rejects.toBe(delegateTokenToProvider);
      await expect(
        lockClient(adapter([{ clientId: 'client_1', disabled: false }]), 'client_1'),
      ).resolves.toMatchObject({
        clientId: 'client_1',
      });
    });
  });

  it('requires one non-reference consent', async () => {
    const consent = {
      id: 'consent_1',
      clientId: 'client_1',
      userId: 'user_1',
      referenceId: null,
      scopes: ['work:read'],
    };
    await expect(currentConsent(adapter([consent]), 'client_1', 'user_1')).resolves.toEqual(
      consent,
    );
    await expect(currentConsent(adapter([]), 'client_1', 'user_1')).rejects.toMatchObject({
      body: expect.objectContaining({ error: 'invalid_grant' }),
    });
    await expect(
      currentConsent(
        adapter([{ ...consent, referenceId: 'organization_1' }]),
        'client_1',
        'user_1',
      ),
    ).rejects.toMatchObject({
      body: expect.objectContaining({ error: 'invalid_grant' }),
    });
    await expect(
      currentConsent(adapter([consent, consent]), 'client_1', 'user_1'),
    ).rejects.toMatchObject({
      body: expect.objectContaining({ error: 'invalid_grant' }),
    });
  });

  it('intersects source scopes in source order and rejects refresh elevation', () => {
    expect(
      intersectScopes(['agents:run', 'work:read'], ['work:read', 'agents:run'], ['agents:run']),
    ).toEqual(['agents:run']);
    expect(requestedRefreshScopes(['work:read', 'offline_access'], undefined)).toEqual([
      'work:read',
      'offline_access',
    ]);
    expect(requestedRefreshScopes(['work:read', 'offline_access'], 'work:read')).toEqual([
      'work:read',
    ]);
    expect(() => requestedRefreshScopes(['work:read'], 'agents:run')).toThrow(
      expect.objectContaining({ body: expect.objectContaining({ error: 'invalid_scope' }) }),
    );
    expect(() => requestedRefreshScopes(['work:read', 'offline_access'], 'offline_access')).toThrow(
      expect.objectContaining({ body: expect.objectContaining({ error: 'invalid_scope' }) }),
    );
  });

  it('rejects skip-consent clients for the REST resource', async () => {
    const client = { clientId: 'client_1', skipConsent: true };
    await expect(
      assertAuthorizationState(
        adapter([]),
        {} as never,
        client,
        { clientId: 'client_1', resource: REST },
        RESOURCES,
      ),
    ).rejects.toMatchObject({ body: expect.objectContaining({ error: 'unauthorized_client' }) });
    await expect(
      assertAuthorizationState(
        adapter([]),
        {} as never,
        client,
        { clientId: 'client_1', resource: MCP },
        RESOURCES,
      ),
    ).resolves.toBeUndefined();
  });
});
