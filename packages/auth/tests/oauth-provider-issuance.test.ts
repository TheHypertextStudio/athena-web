import { describe, expect, it, vi } from 'vitest';

import {
  assertReturnedAccess,
  bindReturnedRefresh,
  extendGrantDeadline,
  findRefreshSnapshot,
  grantAuthority,
  materializeCodeGrant,
} from '../src/oauth-provider-issuance';
import { OAUTH_GRANT_CLAIM } from '../src/oauth-resource-contract';
import type { IssuanceState, OAuthGrantRecord, TokenResponse } from '../src/oauth-provider-types';

const resources = {
  issuer: 'https://api.clearthedocket.com/api/auth',
  mcpResource: 'https://api.clearthedocket.com/mcp',
  restResource: 'https://api.clearthedocket.com/v1',
};

const state: IssuanceState = {
  kind: 'authorization_code',
  clientId: 'client-1',
  userId: 'user-1',
  resource: resources.restResource,
  grantId: 'grant-1',
  verificationIdentifier: 'verification-1',
  verificationSnapshot: {
    query: { client_id: 'client-1', resource: resources.restResource },
    userId: 'user-1',
    sessionId: 'session-1',
  },
};

function jwt(payload: Record<string, unknown>): string {
  return `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
}

function response(payload: Record<string, unknown>, refreshToken?: string): TokenResponse {
  return {
    access_token: jwt(payload),
    scope: 'work:read',
    ...(refreshToken ? { refresh_token: refreshToken } : {}),
  };
}

function adapter(
  options: {
    readonly rows?: readonly unknown[];
    readonly rowQueue?: readonly (readonly unknown[])[];
    readonly updated?: unknown;
  } = {},
) {
  const queue = [...(options.rowQueue ?? [])];
  return {
    findMany: vi.fn().mockImplementation(async () => queue.shift() ?? options.rows ?? []),
    update: vi.fn().mockResolvedValue(options.updated ?? null),
  } as never;
}

function grant(overrides: Partial<OAuthGrantRecord> = {}): OAuthGrantRecord {
  return {
    id: 'grant-1',
    clientId: 'client-1',
    userId: 'user-1',
    consentId: 'consent-1',
    authorizationKind: 'consent',
    resourceUri: resources.restResource,
    createdAt: new Date('2026-09-20T00:00:00.000Z'),
    expiresAt: new Date('2026-09-20T00:10:00.000Z'),
    revokedAt: null,
    legacyBefore: null,
    ...overrides,
  };
}

describe('OAuth credential issuance invariants', () => {
  it('accepts only the access JWT reserved for the issuance state', () => {
    const valid = {
      aud: state.resource,
      azp: state.clientId,
      sub: state.userId,
      [OAUTH_GRANT_CLAIM]: state.grantId,
      jti: 'token-1',
      exp: 1_800_000_000,
    };
    expect(assertReturnedAccess(response(valid), state)).toEqual(valid);
    for (const invalid of [
      { ...valid, aud: 'other' },
      { ...valid, azp: 'other' },
      { ...valid, sub: 'other' },
      { ...valid, [OAUTH_GRANT_CLAIM]: 'other' },
      { ...valid, jti: undefined },
      { ...valid, jti: '' },
    ]) {
      expect(() => assertReturnedAccess(response(invalid), state)).toThrow();
    }
  });

  it('returns null without a refresh token and binds one valid provider refresh record', async () => {
    await expect(bindReturnedRefresh(adapter(), response({}), state)).resolves.toBeNull();
    const refresh = {
      id: 'refresh-1',
      token: 'digest',
      clientId: state.clientId,
      userId: state.userId,
      scopes: ['work:read'],
      docketGrantId: null,
      expiresAt: new Date('2026-09-20T01:00:00.000Z'),
      referenceId: null,
      revoked: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const validAdapter = adapter({ rows: [refresh], updated: refresh });
    await expect(
      bindReturnedRefresh(validAdapter, response({}, 'refresh-value'), state),
    ).resolves.toMatchObject({ docketGrantId: state.grantId });
    await expect(
      bindReturnedRefresh(
        adapter({ rows: [{ ...refresh, clientId: 'other' }] }),
        response({}, 'refresh-value'),
        state,
      ),
    ).rejects.toBeDefined();
    await expect(
      bindReturnedRefresh(
        adapter({ rows: [refresh], updated: null }),
        response({}, 'refresh-value'),
        state,
      ),
    ).rejects.toBeDefined();
  });

  it('extends a grant to the latest credential deadline and fails closed on invalid state', async () => {
    const current = grant();
    const unchanged = adapter({ rows: [current] });
    await expect(
      extendGrantDeadline(unchanged, state, { exp: 1_000 }, null),
    ).resolves.toBeUndefined();
    const extended = adapter({ rows: [current], updated: current });
    await expect(
      extendGrantDeadline(extended, state, { exp: 1_800_000_000 }, null),
    ).resolves.toBeUndefined();
    await expect(extendGrantDeadline(adapter(), state, { exp: 'bad' }, null)).rejects.toBeDefined();
    await expect(
      extendGrantDeadline(adapter({ rows: [current] }), state, { exp: 1_800_000_000 }, {
        expiresAt: null,
      } as never),
    ).rejects.toBeDefined();
    await expect(
      extendGrantDeadline(
        adapter({ rows: [current], updated: null }),
        state,
        { exp: 1_800_000_000 },
        null,
      ),
    ).rejects.toBeDefined();
  });

  it('materializes consent and trusted MCP grants from validated authorization state', async () => {
    const snapshot = {
      query: { client_id: 'client-1', resource: resources.restResource, scope: 'work:read' },
      userId: 'user-1',
      sessionId: 'session-1',
    };
    const consentAdapter = adapter({
      rows: [{ id: 'consent-1', referenceId: null, scopes: ['work:read'] }],
    });
    await expect(
      materializeCodeGrant(consentAdapter, state, {
        snapshot,
        client: { clientId: 'client-1' },
        resources,
        accessLifetimeSeconds: 900,
        refreshLifetimeSeconds: 3600,
      }),
    ).resolves.toMatchObject({ authorizationKind: 'consent', consentId: 'consent-1' });

    const mcpState = { ...state, resource: resources.mcpResource };
    await expect(
      materializeCodeGrant(adapter(), mcpState, {
        snapshot: { ...snapshot, query: { ...snapshot.query, resource: resources.mcpResource } },
        client: { clientId: 'client-1', skipConsent: true },
        resources,
        accessLifetimeSeconds: 900,
        refreshLifetimeSeconds: 3600,
      }),
    ).resolves.toMatchObject({ authorizationKind: 'trusted_mcp', consentId: null });

    await expect(
      materializeCodeGrant(adapter(), state, {
        snapshot: { ...snapshot, referenceId: 'legacy' },
        client: { clientId: 'client-1' },
        resources,
        accessLifetimeSeconds: 900,
        refreshLifetimeSeconds: 3600,
      }),
    ).rejects.toBeDefined();
    await expect(
      materializeCodeGrant(adapter(), state, {
        snapshot: { ...snapshot, query: { ...snapshot.query, scope: 'offline_access' } },
        client: { clientId: 'client-1' },
        resources,
        accessLifetimeSeconds: 900,
        refreshLifetimeSeconds: 3600,
      }),
    ).rejects.toBeDefined();
  });

  it('resolves current grant authority without allowing client or consent substitution', async () => {
    await expect(
      grantAuthority(adapter(), grant({ authorizationKind: 'trusted_mcp' }), {
        clientId: 'client-1',
        skipConsent: true,
        scopes: ['work:read'],
      }),
    ).resolves.toEqual(['work:read']);
    await expect(
      grantAuthority(adapter(), grant({ authorizationKind: 'trusted_mcp' }), {
        clientId: 'client-1',
        skipConsent: false,
      }),
    ).rejects.toBeDefined();
    await expect(
      grantAuthority(
        adapter({ rows: [{ id: 'consent-2', referenceId: null, scopes: ['work:read'] }] }),
        grant(),
        { clientId: 'client-1' },
      ),
    ).rejects.toBeDefined();
  });

  it('finds exactly one opaque refresh record', async () => {
    await expect(
      findRefreshSnapshot(adapter(), { grant_type: 'refresh_token' }),
    ).resolves.toBeNull();
    await expect(
      findRefreshSnapshot(adapter({ rows: [{ id: 'refresh-1' }] }), {
        grant_type: 'refresh_token',
        refresh_token: 'refresh-value',
      }),
    ).resolves.toMatchObject({ record: { id: 'refresh-1' } });
    await expect(
      findRefreshSnapshot(adapter({ rows: [{ id: 1 }, { id: 2 }] }), {
        grant_type: 'refresh_token',
        refresh_token: 'refresh-value',
      }),
    ).resolves.toBeNull();
  });
});
