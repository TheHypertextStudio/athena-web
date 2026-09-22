import { describe, expect, it, vi } from 'vitest';

import {
  OAUTH_GRANT_CLAIM,
  verifyOAuthBearerWith,
  type OAuthBearerDependencies,
  type OAuthBearerLiveState,
} from '../../src/auth/oauth-bearer';

const MCP = 'https://api.clearthedocket.com/mcp';
const REST = 'https://api.clearthedocket.com/v1';
const ISSUER = 'https://api.clearthedocket.com/api/auth';
const NOW = new Date('2026-09-12T12:00:00.000Z');

const USER = {
  id: 'user_1',
  name: 'Ada Lovelace',
  email: 'ada@example.test',
  emailVerified: true,
  image: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

function live(overrides: Partial<OAuthBearerLiveState> = {}): OAuthBearerLiveState {
  return {
    user: USER,
    clientId: 'client_1',
    clientName: 'Claude',
    clientDisabled: false,
    clientSkipConsent: false,
    clientScopes: ['work:read', 'work:write', 'offline_access'],
    clientLegacyBefore: null,
    grant: {
      id: 'grant_1',
      clientId: 'client_1',
      userId: USER.id,
      consentId: 'consent_1',
      authorizationKind: 'consent',
      resourceUri: REST,
      expiresAt: new Date('2026-10-12T12:00:00.000Z'),
      revokedAt: null,
      legacyBefore: null,
    },
    consents: [{ id: 'consent_1', referenceId: null, scopes: ['work:read'] }],
    tokenRevoked: false,
    ...overrides,
  };
}

function dependencies(
  claims: Record<string, unknown>,
  state: OAuthBearerLiveState | null = live(),
): OAuthBearerDependencies {
  return {
    verifyToken: vi.fn(async () => claims),
    loadLiveState: vi.fn(async () => state),
  };
}

function currentClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sub: USER.id,
    azp: 'client_1',
    iss: ISSUER,
    aud: REST,
    iat: Math.floor(NOW.getTime() / 1000) - 60,
    exp: Math.floor(NOW.getTime() / 1000) + 600,
    scope: 'work:read work:write offline_access',
    jti: 'jwt_1',
    [OAUTH_GRANT_CLAIM]: 'grant_1',
    ...overrides,
  };
}

function liveGrant(): NonNullable<OAuthBearerLiveState['grant']> {
  const grant = live().grant;
  if (!grant) throw new Error('The bearer test fixture omitted its grant.');
  return grant;
}

describe('verifyOAuthBearerWith', () => {
  it('accepts only a scalar exact audience and intersects token, client, consent, and known scopes', async () => {
    const principal = await verifyOAuthBearerWith(
      'token',
      { expectedResource: REST, issuer: ISSUER, now: NOW },
      dependencies(currentClaims()),
    );

    expect(principal).toEqual({
      kind: 'oauth',
      userId: USER.id,
      user: USER,
      clientId: 'client_1',
      clientName: 'Claude',
      scopes: ['work:read'],
    });
  });

  it.each([
    ['a one-member audience array', [REST]],
    ['an audience array containing REST', [REST, MCP]],
    ['the MCP audience', MCP],
    ['a trailing-slash alias', `${REST}/`],
  ])('rejects %s on the REST resource', async (_case, aud) => {
    await expect(
      verifyOAuthBearerWith(
        'token',
        { expectedResource: REST, issuer: ISSUER, now: NOW },
        dependencies(currentClaims({ aud })),
      ),
    ).rejects.toThrow('invalid_access_token');
  });

  it.each([
    ['a disabled client', { clientDisabled: true }],
    ['a revoked JWT', { tokenRevoked: true }],
    ['a revoked resource grant', { grant: { ...liveGrant(), revokedAt: NOW } }],
    ['a removed consent', { consents: [] }],
    [
      'a recreated consent',
      { consents: [{ id: 'consent_2', referenceId: null, scopes: ['work:read'] }] },
    ],
    [
      'mixed human and reference-scoped consent',
      {
        consents: [
          { id: 'consent_1', referenceId: null, scopes: ['work:read'] },
          { id: 'consent_reference', referenceId: 'workspace_1', scopes: ['work:read'] },
        ],
      },
    ],
  ])('rejects live-state failure: %s', async (_case, override) => {
    await expect(
      verifyOAuthBearerWith(
        'token',
        { expectedResource: REST, issuer: ISSUER, now: NOW },
        dependencies(currentClaims(), live(override as Partial<OAuthBearerLiveState>)),
      ),
    ).rejects.toThrow('invalid_access_token');
  });

  it('applies reduced consent immediately', async () => {
    const principal = await verifyOAuthBearerWith(
      'token',
      { expectedResource: REST, issuer: ISSUER, now: NOW },
      dependencies(
        currentClaims(),
        live({ consents: [{ id: 'consent_1', referenceId: null, scopes: ['work:write'] }] }),
      ),
    );

    expect(principal.scopes).toEqual(['work:write']);
  });

  it('never treats offline_access as a resource permission', async () => {
    await expect(
      verifyOAuthBearerWith(
        'token',
        { expectedResource: REST, issuer: ISSUER, now: NOW },
        dependencies(
          currentClaims({ scope: 'offline_access' }),
          live({ consents: [{ id: 'consent_1', referenceId: null, scopes: ['offline_access'] }] }),
        ),
      ),
    ).rejects.toThrow('invalid_access_token');
  });

  it('rejects grant-less tokens on REST even when the client has a legacy cutoff', async () => {
    const claims = currentClaims();
    Reflect.deleteProperty(claims, OAUTH_GRANT_CLAIM);

    await expect(
      verifyOAuthBearerWith(
        'token',
        { expectedResource: REST, issuer: ISSUER, now: NOW },
        dependencies(
          claims,
          live({
            clientLegacyBefore: NOW,
            grant: { ...liveGrant(), legacyBefore: NOW, resourceUri: null },
          }),
        ),
      ),
    ).rejects.toThrow('invalid_access_token');
  });

  it('accepts a renewed grant-claimed MCP token after a legacy grant gains its exact resource', async () => {
    const principal = await verifyOAuthBearerWith(
      'renewed-token',
      {
        expectedResource: MCP,
        issuer: ISSUER,
        now: NOW,
        allowLegacyMcp: true,
        allowTrustedMcp: true,
      },
      dependencies(
        currentClaims({ aud: MCP }),
        live({
          clientLegacyBefore: new Date('2026-09-12T11:30:00.000Z'),
          grant: {
            ...liveGrant(),
            resourceUri: MCP,
            legacyBefore: new Date('2026-09-12T11:30:00.000Z'),
          },
        }),
      ),
    );

    expect(principal.userId).toBe(USER.id);
  });

  it('keeps an unexpired pre-cutover MCP token valid after its sibling refresh binds the grant', async () => {
    const claims = currentClaims({
      aud: MCP,
      iat: Math.floor(new Date('2026-09-12T11:29:00.000Z').getTime() / 1000),
      exp: Math.floor(new Date('2026-09-12T11:39:00.000Z').getTime() / 1000),
    });
    Reflect.deleteProperty(claims, OAUTH_GRANT_CLAIM);
    Reflect.deleteProperty(claims, 'jti');

    const principal = await verifyOAuthBearerWith(
      'held-legacy-token',
      {
        expectedResource: MCP,
        issuer: ISSUER,
        now: new Date('2026-09-12T11:35:00.000Z'),
        allowLegacyMcp: true,
        allowTrustedMcp: true,
      },
      dependencies(
        claims,
        live({
          clientLegacyBefore: new Date('2026-09-12T11:30:00.000Z'),
          grant: {
            ...liveGrant(),
            resourceUri: MCP,
            legacyBefore: new Date('2026-09-12T11:30:00.000Z'),
          },
        }),
      ),
    );

    expect(principal.userId).toBe(USER.id);
  });

  it('materializes a missing trusted MCP legacy grant once and rechecks its durable state', async () => {
    const claims = currentClaims({
      aud: MCP,
      iat: Math.floor(new Date('2026-09-12T11:29:00.000Z').getTime() / 1000),
      exp: Math.floor(new Date('2026-09-12T11:39:00.000Z').getTime() / 1000),
    });
    Reflect.deleteProperty(claims, OAUTH_GRANT_CLAIM);
    Reflect.deleteProperty(claims, 'jti');
    const durable = live({
      clientSkipConsent: true,
      clientLegacyBefore: new Date('2026-09-12T11:30:00.000Z'),
      grant: {
        ...liveGrant(),
        consentId: null,
        authorizationKind: 'trusted_mcp',
        resourceUri: MCP,
        legacyBefore: new Date('2026-09-12T11:30:00.000Z'),
      },
      consents: [],
    });
    const ensureLegacyGrant = vi.fn(async () => true);
    const loadLiveState = vi
      .fn<OAuthBearerDependencies['loadLiveState']>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(durable);

    const principal = await verifyOAuthBearerWith(
      'legacy-trusted-token',
      {
        expectedResource: MCP,
        issuer: ISSUER,
        now: new Date('2026-09-12T11:35:00.000Z'),
        allowLegacyMcp: true,
        allowTrustedMcp: true,
      },
      {
        verifyToken: vi.fn(async () => claims),
        loadLiveState,
        ensureLegacyGrant,
      },
    );

    expect(ensureLegacyGrant).toHaveBeenCalledOnce();
    expect(loadLiveState).toHaveBeenCalledTimes(2);
    expect(principal.scopes).toEqual(['work:read', 'work:write']);
  });
});
