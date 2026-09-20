import { runWithRequestState } from '@better-auth/core/context';
import type { DBTransactionAdapter } from '@better-auth/core/db/adapter';
import { describe, expect, it, vi } from 'vitest';

import {
  assertReturnedAccess,
  bindReturnedRefresh,
  extendGrantDeadline,
  findRefreshSnapshot,
  grantAuthority,
  materializeCodeGrant,
  prepareAuthorizationCode,
  prepareRefresh,
} from '../src/oauth-provider-issuance';
import {
  type IssuanceState,
  type OAuthGrantRecord,
  type OAuthRefreshRecord,
  savepointState,
} from '../src/oauth-provider-types';
import { hashOAuthToken, OAUTH_GRANT_CLAIM } from '../src/oauth-resource-contract';

const MCP = 'https://api.clearthedocket.com/mcp';
const REST = 'https://api.clearthedocket.com/v1';
const RESOURCES = {
  issuer: 'https://api.clearthedocket.com/api/auth',
  mcpResource: MCP,
  restResource: REST,
};
const STATE: IssuanceState = {
  kind: 'refresh_token',
  clientId: 'client_1',
  userId: 'user_1',
  resource: MCP,
  grantId: 'grant_1',
};
const REFRESH: OAuthRefreshRecord = {
  id: 'refresh_1',
  token: 'stored-digest',
  clientId: 'client_1',
  userId: 'user_1',
  scopes: ['work:read', 'offline_access'],
  createdAt: new Date('2026-09-19T19:00:00.000Z'),
  expiresAt: new Date('2099-09-19T21:00:00.000Z'),
  revoked: null,
  referenceId: null,
  docketGrantId: 'grant_1',
};
const GRANT: OAuthGrantRecord = {
  id: 'grant_1',
  clientId: 'client_1',
  userId: 'user_1',
  consentId: null,
  authorizationKind: 'trusted_mcp',
  resourceUri: MCP,
  createdAt: new Date('2026-09-19T19:00:00.000Z'),
  expiresAt: new Date('2099-09-19T21:00:00.000Z'),
  revokedAt: null,
  legacyBefore: null,
};

function jwt(claims: Record<string, unknown>): string {
  return `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;
}

function adapter(findResults: unknown[][], updateResults: unknown[] = []): DBTransactionAdapter {
  const pendingFinds = [...findResults];
  const pendingUpdates = [...updateResults];
  return {
    findMany: vi.fn(async () => pendingFinds.shift() ?? []),
    update: vi.fn(async () => pendingUpdates.shift() ?? null),
  } as unknown as DBTransactionAdapter;
}

async function withClientLock<T>(callback: () => Promise<T>, lockClient = true): Promise<T> {
  return runWithRequestState(new WeakMap(), async () => {
    await savepointState.set({
      run: async (run) => run(adapter([])),
      lockClient: async () => lockClient,
      recordJwtRevocation: async () => undefined,
    });
    return callback();
  });
}

describe('OAuth credential issuance invariants', () => {
  it('binds an issued refresh token exactly once', async () => {
    await expect(
      bindReturnedRefresh(adapter([]), { access_token: 'access', scope: 'work:read' }, STATE),
    ).resolves.toBeNull();
    const token = 'refresh-token';
    const stored = { ...REFRESH, token: await hashOAuthToken(token), docketGrantId: null };
    await expect(
      bindReturnedRefresh(
        adapter([[stored]], [{ ...stored, docketGrantId: STATE.grantId }]),
        { access_token: 'access', refresh_token: token, scope: 'work:read offline_access' },
        STATE,
      ),
    ).resolves.toMatchObject({ docketGrantId: STATE.grantId });
  });

  it.each([
    ['client mismatch', { clientId: 'client_2' }],
    ['user mismatch', { userId: 'user_2' }],
    ['existing grant binding', { docketGrantId: 'grant_2' }],
    ['missing expiration', { expiresAt: null }],
    ['reference owner', { referenceId: 'organization_1' }],
    ['scope mismatch', { scopes: ['work:read'] }],
  ])('rejects a returned refresh with %s', async (_label, patch) => {
    const token = 'refresh-token';
    const stored = {
      ...REFRESH,
      token: await hashOAuthToken(token),
      docketGrantId: null,
      ...patch,
    };
    await expect(
      bindReturnedRefresh(
        adapter([[stored]]),
        { access_token: 'access', refresh_token: token, scope: 'work:read offline_access' },
        STATE,
      ),
    ).rejects.toMatchObject({ body: expect.objectContaining({ error: 'server_error' }) });
  });

  it('rejects a refresh row that disappears during binding', async () => {
    const token = 'refresh-token';
    const stored = { ...REFRESH, token: await hashOAuthToken(token), docketGrantId: null };
    await expect(
      bindReturnedRefresh(
        adapter([[stored]], [null]),
        { access_token: 'access', refresh_token: token, scope: 'work:read offline_access' },
        STATE,
      ),
    ).rejects.toMatchObject({ body: expect.objectContaining({ error: 'server_error' }) });
  });

  it('accepts only an access JWT bound to the reserved grant', () => {
    const claims = {
      aud: MCP,
      azp: 'client_1',
      sub: 'user_1',
      jti: 'jwt_1',
      [OAUTH_GRANT_CLAIM]: 'grant_1',
    };
    expect(assertReturnedAccess({ access_token: jwt(claims), scope: 'work:read' }, STATE)).toEqual(
      claims,
    );
    for (const patch of [
      { aud: REST },
      { azp: 'client_2' },
      { sub: 'user_2' },
      { [OAUTH_GRANT_CLAIM]: 'grant_2' },
      { jti: 42 },
      { jti: '' },
    ]) {
      expect(() =>
        assertReturnedAccess(
          { access_token: jwt({ ...claims, ...patch }), scope: 'work:read' },
          STATE,
        ),
      ).toThrow(
        expect.objectContaining({ body: expect.objectContaining({ error: 'server_error' }) }),
      );
    }
  });

  it('extends a grant through the latest credential deadline', async () => {
    const unchanged = { ...GRANT, expiresAt: new Date('2099-09-19T22:00:00.000Z') };
    await expect(
      extendGrantDeadline(adapter([[unchanged]]), STATE, { exp: 2_000_000_000 }, null),
    ).resolves.toBeUndefined();
    await expect(
      extendGrantDeadline(adapter([[GRANT]], [{ ...GRANT }]), STATE, { exp: 5_000_000_000 }, null),
    ).resolves.toBeUndefined();
  });

  it('rejects invalid or raced grant deadline updates', async () => {
    await expect(
      extendGrantDeadline(adapter([]), STATE, { exp: 'later' }, null),
    ).rejects.toMatchObject({
      body: expect.objectContaining({ error: 'server_error' }),
    });
    await expect(
      extendGrantDeadline(
        adapter([[GRANT]]),
        STATE,
        { exp: 5_000_000_000 },
        { ...REFRESH, expiresAt: null },
      ),
    ).rejects.toMatchObject({ body: expect.objectContaining({ error: 'server_error' }) });
    await expect(
      extendGrantDeadline(adapter([[GRANT]], [null]), STATE, { exp: 5_000_000_000 }, null),
    ).rejects.toMatchObject({ body: expect.objectContaining({ error: 'invalid_grant' }) });
  });

  it('materializes trusted and consent-backed code grants', async () => {
    const snapshot = {
      query: { client_id: 'client_1', resource: MCP, scope: 'work:read offline_access' },
      userId: 'user_1',
      sessionId: 'session_1',
    };
    const trusted = await materializeCodeGrant(adapter([]), STATE, {
      snapshot,
      client: { clientId: 'client_1', skipConsent: true },
      resources: RESOURCES,
      accessLifetimeSeconds: 900,
      refreshLifetimeSeconds: 3_600,
    });
    expect(trusted).toMatchObject({ authorizationKind: 'trusted_mcp', consentId: null });
    const consent = {
      id: 'consent_1',
      clientId: 'client_1',
      userId: 'user_1',
      referenceId: null,
      scopes: ['work:read', 'offline_access'],
    };
    await expect(
      materializeCodeGrant(adapter([[consent]]), STATE, {
        snapshot,
        client: { clientId: 'client_1', skipConsent: false },
        resources: RESOURCES,
        accessLifetimeSeconds: 900,
        refreshLifetimeSeconds: 3_600,
      }),
    ).resolves.toMatchObject({ authorizationKind: 'consent', consentId: 'consent_1' });
  });

  it('rejects invalid code-grant authority', async () => {
    const base = {
      query: { client_id: 'client_1', resource: MCP, scope: 'work:read' },
      userId: 'user_1',
      sessionId: 'session_1',
    };
    const context = {
      snapshot: base,
      client: { clientId: 'client_1', skipConsent: true },
      resources: RESOURCES,
      accessLifetimeSeconds: 900,
      refreshLifetimeSeconds: 3_600,
    };
    await expect(
      materializeCodeGrant(adapter([]), STATE, {
        ...context,
        snapshot: { ...base, referenceId: 'organization_1' },
      }),
    ).rejects.toMatchObject({ body: expect.objectContaining({ error: 'invalid_grant' }) });
    await expect(
      materializeCodeGrant(adapter([]), { ...STATE, resource: REST }, context),
    ).rejects.toMatchObject({ body: expect.objectContaining({ error: 'server_error' }) });
    await expect(
      materializeCodeGrant(adapter([]), STATE, {
        ...context,
        snapshot: { ...base, query: { ...base.query, scope: 'offline_access' } },
      }),
    ).rejects.toMatchObject({ body: expect.objectContaining({ error: 'invalid_scope' }) });
    const narrowConsent = {
      id: 'consent_1',
      clientId: 'client_1',
      userId: 'user_1',
      referenceId: null,
      scopes: ['work:read'],
    };
    await expect(
      materializeCodeGrant(adapter([[narrowConsent]]), STATE, {
        ...context,
        client: { clientId: 'client_1', skipConsent: false },
        snapshot: { ...base, query: { ...base.query, scope: 'work:read offline_access' } },
      }),
    ).rejects.toMatchObject({ body: expect.objectContaining({ error: 'invalid_scope' }) });
  });

  it('delegates missing, expired, and malformed authorization codes to the provider', async () => {
    await expect(
      prepareAuthorizationCode(
        adapter([]),
        { grant_type: 'authorization_code' },
        RESOURCES,
        3_600,
        900,
      ),
    ).rejects.toMatchObject({ body: expect.objectContaining({ error: 'invalid_request' }) });
    const body = { grant_type: 'authorization_code' as const, code: 'code' };
    await expect(
      prepareAuthorizationCode(adapter([]), body, RESOURCES, 3_600, 900),
    ).resolves.toMatchObject({ kind: 'delegate-authorization-code' });
    const expired = { identifier: 'id', value: '{}', expiresAt: new Date(0) };
    await expect(
      prepareAuthorizationCode(adapter([[expired]]), body, RESOURCES, 3_600, 900),
    ).resolves.toMatchObject({ kind: 'delegate-authorization-code' });
    const malformed = { identifier: 'id', value: '{', expiresAt: new Date('2099-01-01') };
    await expect(
      prepareAuthorizationCode(adapter([[malformed]]), body, RESOURCES, 3_600, 900),
    ).resolves.toMatchObject({ kind: 'delegate-authorization-code' });
    await expect(
      prepareAuthorizationCode(adapter([[expired, expired]]), body, RESOURCES, 3_600, 900),
    ).rejects.toMatchObject({ body: expect.objectContaining({ error: 'invalid_grant' }) });
  });

  it('propagates a code client-load failure instead of treating it as provider delegation', async () => {
    const body = { grant_type: 'authorization_code' as const, code: 'code' };
    const record = {
      identifier: 'id',
      value: JSON.stringify({
        type: 'authorization_code',
        query: { client_id: 'client_1', resource: MCP },
        userId: 'user_1',
        sessionId: 'session_1',
      }),
      expiresAt: new Date('2099-01-01'),
    };
    await expect(
      withClientLock(() =>
        prepareAuthorizationCode(adapter([[record], []]), body, RESOURCES, 3_600, 900),
      ),
    ).rejects.toMatchObject({ body: expect.objectContaining({ error: 'invalid_grant' }) });
  });

  it('retains an explicit resource for the final authorization-code comparison', async () => {
    const body = {
      grant_type: 'authorization_code' as const,
      code: 'code',
      resource: MCP,
    };
    const record = {
      identifier: 'id',
      value: JSON.stringify({
        type: 'authorization_code',
        query: { client_id: 'client_1', resource: MCP },
        userId: 'user_1',
        sessionId: 'session_1',
      }),
      expiresAt: new Date('2099-01-01'),
    };
    const client = { clientId: 'client_1', disabled: false, skipConsent: true };

    await expect(
      withClientLock(() =>
        prepareAuthorizationCode(adapter([[record], [client]]), body, RESOURCES, 3_600, 900),
      ),
    ).resolves.toMatchObject({
      kind: 'issue',
      codeGrant: { requestedResource: MCP },
    });

    const withoutRequestedResource = await withClientLock(() =>
      prepareAuthorizationCode(
        adapter([[record], [client]]),
        { grant_type: 'authorization_code', code: 'code' },
        RESOURCES,
        3_600,
        900,
      ),
    );
    expect(withoutRequestedResource).toMatchObject({ kind: 'issue' });
    if (withoutRequestedResource.kind !== 'issue') {
      throw new Error('Expected Docket to prepare the authorization code.');
    }
    expect(withoutRequestedResource.codeGrant).not.toHaveProperty('requestedResource');
  });

  it('resolves trusted and consent grant authority', async () => {
    await expect(
      grantAuthority(adapter([]), GRANT, { clientId: 'client_1', skipConsent: true, scopes: null }),
    ).resolves.toContain('work:read');
    await expect(
      grantAuthority(adapter([]), GRANT, { clientId: 'client_1', skipConsent: false }),
    ).rejects.toMatchObject({ body: expect.objectContaining({ error: 'invalid_grant' }) });
    const consentGrant = {
      ...GRANT,
      authorizationKind: 'consent' as const,
      consentId: 'consent_1',
    };
    const consent = {
      id: 'consent_1',
      clientId: 'client_1',
      userId: 'user_1',
      referenceId: null,
      scopes: ['work:read'],
    };
    await expect(
      grantAuthority(adapter([[consent]]), consentGrant, { clientId: 'client_1' }),
    ).resolves.toEqual(['work:read']);
    await expect(
      grantAuthority(adapter([[{ ...consent, id: 'consent_2' }]]), consentGrant, {
        clientId: 'client_1',
      }),
    ).rejects.toMatchObject({ body: expect.objectContaining({ error: 'invalid_grant' }) });
  });

  it('finds only one exact refresh digest', async () => {
    await expect(
      findRefreshSnapshot(adapter([]), { grant_type: 'refresh_token' }),
    ).resolves.toBeNull();
    await expect(
      findRefreshSnapshot(adapter([]), { grant_type: 'refresh_token', refresh_token: 'token' }),
    ).resolves.toBeNull();
    await expect(
      findRefreshSnapshot(adapter([[REFRESH, REFRESH]]), {
        grant_type: 'refresh_token',
        refresh_token: 'token',
      }),
    ).resolves.toBeNull();
    await expect(
      findRefreshSnapshot(adapter([[REFRESH]]), {
        grant_type: 'refresh_token',
        refresh_token: 'token',
      }),
    ).resolves.toMatchObject({ record: REFRESH });
  });

  it('rejects malformed and stale refresh families before rotation', async () => {
    const client = {
      clientId: 'client_1',
      skipConsent: true,
      scopes: ['work:read', 'offline_access'],
    };
    const body = { grant_type: 'refresh_token' as const, refresh_token: 'token' };
    for (const patch of [
      { expiresAt: null },
      { referenceId: 'organization_1' },
      { docketGrantId: null },
    ]) {
      await expect(
        withClientLock(() =>
          prepareRefresh(adapter([[client], [{ ...REFRESH, ...patch }]]), body, RESOURCES, {
            digest: 'digest',
            record: REFRESH,
          }),
        ),
      ).rejects.toMatchObject({ body: expect.objectContaining({ error: 'invalid_grant' }) });
    }
    await expect(
      withClientLock(() =>
        prepareRefresh(
          adapter([[client], [{ ...REFRESH, revoked: new Date() }]]),
          body,
          RESOURCES,
          { digest: 'digest', record: REFRESH },
        ),
      ),
    ).resolves.toMatchObject({ kind: 'stale-refresh' });
  });

  it('rejects revoked, expired, and under-authorized refresh grants', async () => {
    const body = { grant_type: 'refresh_token' as const, refresh_token: 'token' };
    const client = {
      clientId: 'client_1',
      skipConsent: true,
      scopes: ['work:read', 'offline_access'],
    };
    for (const grant of [
      { ...GRANT, revokedAt: new Date() },
      { ...GRANT, expiresAt: new Date(0) },
    ]) {
      await expect(
        withClientLock(() =>
          prepareRefresh(adapter([[client], [REFRESH], [grant]]), body, RESOURCES, {
            digest: 'digest',
            record: REFRESH,
          }),
        ),
      ).rejects.toMatchObject({ body: expect.objectContaining({ error: 'invalid_grant' }) });
    }
    await expect(
      withClientLock(() =>
        prepareRefresh(
          adapter([[{ ...client, scopes: ['work:read'] }], [REFRESH], [GRANT]]),
          body,
          RESOURCES,
          { digest: 'digest', record: REFRESH },
        ),
      ),
    ).rejects.toMatchObject({ body: expect.objectContaining({ error: 'invalid_grant' }) });
    await expect(
      withClientLock(() =>
        prepareRefresh(
          adapter([[client], [{ ...REFRESH, scopes: ['work:read'] }], [GRANT]]),
          body,
          RESOURCES,
          { digest: 'digest', record: REFRESH },
        ),
      ),
    ).rejects.toMatchObject({ body: expect.objectContaining({ error: 'invalid_grant' }) });
  });

  it('binds a legacy refresh grant to MCP exactly once', async () => {
    const body = { grant_type: 'refresh_token' as const, refresh_token: 'token' };
    const client = {
      clientId: 'client_1',
      skipConsent: true,
      scopes: ['work:read', 'offline_access'],
    };
    const legacyGrant = { ...GRANT, resourceUri: null, legacyBefore: new Date('2026-09-12') };
    await expect(
      withClientLock(() =>
        prepareRefresh(adapter([[client], [REFRESH], [legacyGrant]], [null]), body, RESOURCES, {
          digest: 'digest',
          record: REFRESH,
        }),
      ),
    ).rejects.toMatchObject({ body: expect.objectContaining({ error: 'invalid_grant' }) });
    await expect(
      withClientLock(() =>
        prepareRefresh(
          adapter([[client], [REFRESH], [legacyGrant]], [{ ...legacyGrant, resourceUri: MCP }]),
          body,
          RESOURCES,
          { digest: 'digest', record: REFRESH },
        ),
      ),
    ).resolves.toMatchObject({ kind: 'issue', state: { resource: MCP } });
  });
});
