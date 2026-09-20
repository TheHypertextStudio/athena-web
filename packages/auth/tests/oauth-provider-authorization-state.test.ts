import { describe, expect, it, vi } from 'vitest';

import {
  authorizationStateQuery,
  currentConsent,
  intersectScopes,
  loadOne,
  parseCurrentAuthorizationRequest,
  parseVerification,
  rejectRepeatedFields,
  requestedRefreshScopes,
} from '../src/oauth-provider-authorization-state';

const resources = {
  issuer: 'https://api.clearthedocket.com/api/auth',
  mcpResource: 'https://api.clearthedocket.com/mcp',
  restResource: 'https://api.clearthedocket.com/v1',
};

function verification(value: unknown) {
  return {
    identifier: 'code-1',
    value: typeof value === 'string' ? value : JSON.stringify(value),
    expiresAt: new Date('2026-09-20T00:10:00.000Z'),
  };
}

function adapterWith(rows: readonly unknown[]) {
  return { findMany: vi.fn().mockResolvedValue(rows) } as never;
}

describe('OAuth authorization state parsing', () => {
  it('parses every optional authorization-code field without defaulting the resource', () => {
    const value = {
      type: 'authorization_code',
      query: {
        client_id: 'client-1',
        resource: resources.restResource,
        scope: 'work:read',
        redirect_uri: 'https://client.example/callback',
        code_challenge: 'challenge',
        code_challenge_method: 'S256',
      },
      userId: 'user-1',
      sessionId: 'session-1',
      referenceId: null,
      authTime: 42,
    };
    expect(parseVerification(verification(value), resources)).toEqual({
      query: value.query,
      userId: 'user-1',
      sessionId: 'session-1',
      referenceId: null,
      authTime: 42,
    });
  });

  it('omits absent optional authorization-code fields', () => {
    expect(
      parseVerification(
        verification({
          type: 'authorization_code',
          query: { client_id: 'client-1', resource: resources.mcpResource },
          userId: 'user-1',
          sessionId: 'session-1',
        }),
        resources,
      ),
    ).toEqual({
      query: { client_id: 'client-1', resource: resources.mcpResource },
      userId: 'user-1',
      sessionId: 'session-1',
    });
  });

  it('rejects malformed, invalid, absent, and unsupported stored authorization resources', () => {
    expect(parseVerification(verification('{'), resources)).toBeNull();
    expect(parseVerification(verification({ type: 'other' }), resources)).toBeNull();
    const base = {
      type: 'authorization_code',
      userId: 'user-1',
      sessionId: 'session-1',
    };
    expect(() =>
      parseVerification(verification({ ...base, query: { client_id: 'client-1' } }), resources),
    ).toThrow();
    expect(() =>
      parseVerification(
        verification({
          ...base,
          query: { client_id: 'client-1', resource: 'https://api.example.test/v1' },
        }),
        resources,
      ),
    ).toThrow();
  });

  it('parses exact authorization resources and rejects repeated or unsupported values', () => {
    expect(parseCurrentAuthorizationRequest('client_id=client-1', resources)).toEqual({
      clientId: 'client-1',
      resource: resources.mcpResource,
    });
    expect(
      parseCurrentAuthorizationRequest(
        `client_id=client-1&resource=${encodeURIComponent(resources.restResource)}`,
        resources,
      ),
    ).toEqual({ clientId: 'client-1', resource: resources.restResource });
    expect(() => parseCurrentAuthorizationRequest('client_id=a&client_id=b', resources)).toThrow();
    expect(() =>
      parseCurrentAuthorizationRequest('resource=https%3A%2F%2Fexample.test', resources),
    ).toThrow();
  });

  it('reads a serialized query only from an object string field', () => {
    expect(authorizationStateQuery({ query: 'client_id=1' })).toBe('client_id=1');
    expect(authorizationStateQuery({ query: 1 })).toBeUndefined();
    expect(authorizationStateQuery(null)).toBeUndefined();
    expect(authorizationStateQuery('query')).toBeUndefined();
  });

  it('rejects absent and repeated singleton form fields', async () => {
    await expect(rejectRepeatedFields(undefined, ['client_id'])).rejects.toThrow();
    await expect(
      rejectRepeatedFields(
        new Request('https://api.example.test/token', {
          method: 'POST',
          body: 'client_id=a&client_id=b',
        }),
        ['client_id'],
      ),
    ).rejects.toThrow();
    await expect(
      rejectRepeatedFields(
        new Request('https://api.example.test/token', { method: 'POST', body: 'client_id=a' }),
        ['client_id'],
      ),
    ).resolves.toBeUndefined();
  });

  it('loads exactly one row and one unreferenced standing consent', async () => {
    await expect(loadOne(adapterWith([{ id: 'one' }]), 'model', [])).resolves.toEqual({
      id: 'one',
    });
    await expect(loadOne(adapterWith([]), 'model', [])).rejects.toThrow();
    await expect(loadOne(adapterWith([{ id: 1 }, { id: 2 }]), 'model', [])).rejects.toThrow();
    await expect(
      currentConsent(adapterWith([{ id: 'consent-1', referenceId: null }]), 'client-1', 'user-1'),
    ).resolves.toMatchObject({ id: 'consent-1' });
    await expect(currentConsent(adapterWith([]), 'client-1', 'user-1')).rejects.toThrow();
    await expect(
      currentConsent(
        adapterWith([{ id: 'consent-1', referenceId: 'legacy' }]),
        'client-1',
        'user-1',
      ),
    ).rejects.toThrow();
  });

  it('intersects scopes in source order and prevents refresh elevation or capability removal', () => {
    expect(
      intersectScopes(
        ['work:write', 'offline_access', 'work:read'],
        ['work:read', 'work:write'],
        ['work:read'],
      ),
    ).toEqual(['work:read']);
    expect(requestedRefreshScopes(['work:read', 'offline_access'], undefined)).toEqual([
      'work:read',
      'offline_access',
    ]);
    expect(requestedRefreshScopes(['work:read', 'offline_access'], 'work:read')).toEqual([
      'work:read',
    ]);
    expect(() => requestedRefreshScopes(['work:read'], 'work:write')).toThrow();
    expect(() =>
      requestedRefreshScopes(['work:read', 'offline_access'], 'offline_access'),
    ).toThrow();
  });
});
