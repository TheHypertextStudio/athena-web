import { describe, expect, it } from 'vitest';

import {
  exactResource,
  hasCapability,
  isNavigationRedirect,
  isProviderMissingIntrospectionToken,
  isProviderTokenFailureAfterAuthentication,
  oauthError,
  oauthServerError,
  providerErrorHeader,
  scopesFrom,
} from '../src/oauth-provider-types';

const resources = {
  issuer: 'https://api.clearthedocket.com/api/auth',
  mcpResource: 'https://api.clearthedocket.com/mcp',
  restResource: 'https://api.clearthedocket.com/v1',
};

describe('OAuth provider protocol helpers', () => {
  it('reads provider headers from Headers and plain records only', () => {
    expect(providerErrorHeader({ headers: new Headers({ Location: '/next' }) }, 'location')).toBe(
      '/next',
    );
    expect(providerErrorHeader({ headers: { location: '/plain' } }, 'location')).toBe('/plain');
    expect(providerErrorHeader({ headers: { location: 42 } }, 'location')).toBeNull();
    expect(providerErrorHeader({ headers: [] }, 'location')).toBeNull();
    expect(providerErrorHeader({}, 'location')).toBeNull();
  });

  it('recognizes only complete navigation redirects', () => {
    const redirect = Object.assign(new Error('redirect'), {
      status: 'FOUND',
      statusCode: 302,
      headers: { location: '/consent' },
    });
    expect(isNavigationRedirect(redirect)).toBe(true);
    expect(
      isNavigationRedirect({
        status: redirect.status,
        statusCode: redirect.statusCode,
        headers: redirect.headers,
      }),
    ).toBe(false);
    expect(isNavigationRedirect(Object.assign(new Error(), redirect, { statusCode: 400 }))).toBe(
      false,
    );
    expect(isNavigationRedirect(Object.assign(new Error(), redirect, { headers: {} }))).toBe(false);
  });

  it('recognizes provider token lookup failures without accepting adjacent errors', () => {
    expect(
      isProviderTokenFailureAfterAuthentication({
        statusCode: 400,
        body: { error: 'invalid_request' },
      }),
    ).toBe(true);
    expect(isProviderTokenFailureAfterAuthentication(null)).toBe(false);
    expect(isProviderTokenFailureAfterAuthentication({ statusCode: 401 })).toBe(false);
    expect(
      isProviderMissingIntrospectionToken({ statusCode: 400, body: { error: 'invalid_token' } }),
    ).toBe(true);
    expect(isProviderMissingIntrospectionToken(undefined)).toBe(false);
    expect(isProviderMissingIntrospectionToken({ statusCode: 400, body: {} })).toBe(false);
  });

  it('normalizes scope values and detects resource capabilities', () => {
    expect(scopesFrom(undefined)).toEqual([]);
    expect(scopesFrom(' work:read   offline_access ')).toEqual(['work:read', 'offline_access']);
    expect(hasCapability(['offline_access'])).toBe(false);
    expect(hasCapability(['offline_access', 'work:read'])).toBe(true);
  });

  it('maps exact resource failures to stable OAuth errors', () => {
    expect(exactResource(undefined, resources.restResource, resources)).toBe(
      resources.restResource,
    );
    expect(() => exactResource(resources.mcpResource, resources.restResource, resources)).toThrow();
    expect(() => exactResource(undefined, 'https://invalid.example', resources)).toThrow();
  });

  it('throws stable client and server OAuth failures', () => {
    for (const code of [
      'invalid_grant',
      'invalid_request',
      'invalid_scope',
      'invalid_target',
      'unauthorized_client',
    ] as const) {
      expect(() => oauthError(code)).toThrow();
    }
    expect(() => oauthServerError()).toThrow();
  });
});
