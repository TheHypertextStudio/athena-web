import { describe, expect, it } from 'vitest';

import {
  authorizeOAuthBearerState,
  type OAuthBearerGrantState,
  type OAuthBearerLiveState,
  type OAuthBearerStateVerification,
} from '../src/oauth-bearer-state';
import { OAUTH_GRANT_CLAIM } from '../src/oauth-resource-contract';

const NOW = new Date('2026-09-20T00:00:00.000Z');
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);
const RESOURCE = 'https://api.clearthedocket.com/v1';
const ISSUER = 'https://api.clearthedocket.com/api/auth';

function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sub: 'user-1',
    azp: 'client-1',
    iss: ISSUER,
    aud: RESOURCE,
    iat: NOW_SECONDS - 60,
    exp: NOW_SECONDS + 600,
    scope: 'work:read work:write',
    [OAUTH_GRANT_CLAIM]: 'grant-1',
    jti: 'token-1',
    ...overrides,
  };
}

function state(
  overrides: Partial<OAuthBearerLiveState<string>> = {},
): OAuthBearerLiveState<string> {
  return {
    user: 'user',
    clientId: 'client-1',
    clientDisabled: false,
    clientSkipConsent: false,
    clientScopes: ['work:read', 'work:write'],
    clientLegacyBefore: null,
    grant: {
      id: 'grant-1',
      clientId: 'client-1',
      userId: 'user-1',
      consentId: 'consent-1',
      authorizationKind: 'consent',
      resourceUri: RESOURCE,
      expiresAt: new Date(NOW.getTime() + 60_000),
      revokedAt: null,
      legacyBefore: null,
    },
    consents: [{ id: 'consent-1', referenceId: null, scopes: ['work:read'] }],
    tokenRevoked: false,
    ...overrides,
  };
}

function requiredGrant(live: OAuthBearerLiveState<string> = state()): OAuthBearerGrantState {
  if (!live.grant) {
    throw new Error('Expected the fixture to contain a grant.');
  }
  return live.grant;
}

const verification: OAuthBearerStateVerification = {
  expectedResource: RESOURCE,
  issuer: ISSUER,
  now: NOW,
};

function rejects(
  token: Record<string, unknown>,
  live: OAuthBearerLiveState<string>,
  options: OAuthBearerStateVerification = verification,
): void {
  expect(() => authorizeOAuthBearerState(token, live, options)).toThrow('invalid_access_token');
}

describe('OAuth bearer live-state authorization', () => {
  it('returns only the scopes shared by the token, client, and consent', () => {
    expect(authorizeOAuthBearerState(claims(), state(), verification)).toMatchObject({
      userId: 'user-1',
      clientId: 'client-1',
      user: 'user',
      scopes: ['work:read'],
      grantedScopes: ['work:read'],
    });
  });

  it.each([
    ['missing subject', { sub: undefined }],
    ['empty client', { azp: '' }],
    ['missing issued time', { iat: undefined }],
    ['fractional expiry', { exp: NOW_SECONDS + 0.5 }],
    ['wrong issuer', { iss: 'https://issuer.example' }],
    ['wrong audience', { aud: 'https://api.clearthedocket.com/mcp' }],
    ['future issued time', { iat: NOW_SECONDS + 61 }],
    ['expired token', { exp: NOW_SECONDS }],
    ['inverted lifetime', { iat: NOW_SECONDS + 1, exp: NOW_SECONDS + 1 }],
  ])('rejects %s', (_label, override) => {
    rejects(claims(override), state());
  });

  it.each([
    ['revoked token', { tokenRevoked: true }],
    ['disabled client', { clientDisabled: true }],
    ['different live client', { clientId: 'client-2' }],
    ['missing grant', { grant: null }],
    ['revoked grant', { grant: { ...requiredGrant(), revokedAt: NOW } }],
    ['expired grant', { grant: { ...requiredGrant(), expiresAt: NOW } }],
    ['grant for another client', { grant: { ...requiredGrant(), clientId: 'client-2' } }],
    ['grant for another user', { grant: { ...requiredGrant(), userId: 'user-2' } }],
  ] satisfies readonly [string, Partial<OAuthBearerLiveState<string>>][])(
    'rejects %s',
    (_label, override) => {
      rejects(claims(), state(override));
    },
  );

  it.each([
    ['missing token id', { jti: undefined }, state(), verification],
    ['different grant claim', { [OAUTH_GRANT_CLAIM]: 'grant-2' }, state(), verification],
    [
      'different grant resource',
      {},
      state({ grant: { ...requiredGrant(), resourceUri: 'https://api.clearthedocket.com/mcp' } }),
      verification,
    ],
    [
      'unapproved trusted grant',
      {},
      state({ grant: { ...requiredGrant(), authorizationKind: 'trusted_mcp' } }),
      verification,
    ],
  ] satisfies readonly [
    string,
    Record<string, unknown>,
    OAuthBearerLiveState<string>,
    OAuthBearerStateVerification,
  ][])('%s is rejected', (_label, claimOverride, live, options) => {
    rejects(claims(claimOverride), live, options);
  });

  it('accepts a trusted MCP grant only for a skip-consent client on an allowed surface', () => {
    const live = state({
      clientSkipConsent: true,
      grant: { ...requiredGrant(), consentId: null, authorizationKind: 'trusted_mcp' },
      consents: [],
    });
    const options = { ...verification, allowTrustedMcp: true };
    expect(authorizeOAuthBearerState(claims(), live, options).scopes).toEqual([
      'work:read',
      'work:write',
    ]);
    rejects(claims(), state({ ...live, clientSkipConsent: false }), options);
  });

  it.each([
    ['missing consent', { consents: [] }],
    ['extra consent', { consents: [...state().consents, ...state().consents] }],
    [
      'wrong consent id',
      { consents: [{ id: 'consent-2', referenceId: null, scopes: ['work:read'] }] },
    ],
    [
      'referenced consent',
      { consents: [{ id: 'consent-1', referenceId: 'legacy', scopes: ['work:read'] }] },
    ],
    ['missing grant consent id', { grant: { ...requiredGrant(), consentId: null } }],
    ['unknown authorization kind', { grant: { ...requiredGrant(), authorizationKind: 'other' } }],
    ['no shared capability scope', { clientScopes: ['offline_access'] }],
  ] satisfies readonly [string, Partial<OAuthBearerLiveState<string>>][])(
    'rejects consent state with %s',
    (_label, override) => {
      rejects(claims(), state(override));
    },
  );

  it('accepts an eligible legacy MCP grant and rejects its cutoff boundaries', () => {
    const cutoff = new Date((NOW_SECONDS + 30) * 1000);
    const live = state({
      clientLegacyBefore: cutoff,
      grant: {
        ...requiredGrant(),
        resourceUri: null,
        legacyBefore: cutoff,
      },
    });
    const token = claims({ [OAUTH_GRANT_CLAIM]: undefined, jti: undefined });
    const options = { ...verification, allowLegacyMcp: true };
    expect(authorizeOAuthBearerState(token, live, options).scopes).toEqual(['work:read']);
    rejects(token, live, verification);
    rejects(token, state({ ...live, clientLegacyBefore: null }), options);
    rejects(
      token,
      state({ ...live, grant: { ...requiredGrant(live), legacyBefore: null } }),
      options,
    );
    rejects(
      token,
      state({
        ...live,
        grant: { ...requiredGrant(live), resourceUri: 'https://api.example.test/mcp' },
      }),
      options,
    );
    rejects(claims({ [OAUTH_GRANT_CLAIM]: undefined, iat: NOW_SECONDS + 31 }), live, options);
    rejects(claims({ [OAUTH_GRANT_CLAIM]: undefined, iat: NOW_SECONDS - 1_000 }), live, options);
  });

  it('rejects a token without a string scope claim', () => {
    rejects(claims({ scope: undefined }), state());
  });
});
