/** Unit tests for the active provider branches of the public-config availability helpers. */
import type { PublicConfigOut } from '@docket/types';
import { describe, expect, it } from 'vitest';

import { connectorAvailable, connectorOAuthConfigured } from '../../src/lib/public-config';

function config(overrides: Partial<PublicConfigOut>): PublicConfigOut {
  return {
    appMode: 'production',
    oauthProviders: [],
    connectors: [],
    mcpUrl: null,
    ...overrides,
  };
}

describe('connectorOAuthConfigured', () => {
  it('uses the Google social grant for active Google connectors', () => {
    expect(connectorOAuthConfigured(config({ oauthProviders: ['google'] }), 'gtasks')).toBe(true);
    expect(connectorOAuthConfigured(config({}), 'gtasks')).toBe(false);
  });

  it('uses each first-party social grant for its matching active connector', () => {
    expect(connectorOAuthConfigured(config({ oauthProviders: ['github'] }), 'github')).toBe(true);
    expect(connectorOAuthConfigured(config({ oauthProviders: ['linear'] }), 'linear')).toBe(true);
  });

  it('does not reactivate a retired connector advertised by stale server config', () => {
    expect(connectorOAuthConfigured(config({ connectors: ['slack'] }), 'slack')).toBe(false);
  });
});

describe('connectorAvailable', () => {
  it('follows the active connector social grant in production', () => {
    expect(connectorAvailable(config({ oauthProviders: ['github'] }), 'github')).toBe(true);
    expect(connectorAvailable(config({}), 'github')).toBe(false);
  });

  it('makes active connectors available in local mock mode', () => {
    expect(connectorAvailable(config({ appMode: 'local' }), 'github')).toBe(true);
  });
});
