/**
 * Unit tests for the Slack (redirect-connect) branch of the public-config availability helpers.
 *
 * @remarks
 * Slack has no Better Auth social grant — the server advertises it directly in
 * `PublicConfigOut.connectors` when the shared Slack app's credentials are configured. These
 * tests pin that `connectorOAuthConfigured`/`connectorAvailable` read that list (never the
 * `oauthProviders` social mapping, which would misroute Slack to `google`), and that local mock
 * mode keeps every provider connectable.
 */
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

describe('connectorOAuthConfigured (slack)', () => {
  it('is true when the server advertises the slack connector', () => {
    expect(connectorOAuthConfigured(config({ connectors: ['slack'] }), 'slack')).toBe(true);
  });

  it('is false when slack is not configured — even with Google OAuth present', () => {
    // Without the redirect-provider branch, slack would map to the `google` social grant and
    // falsely read as configured here.
    expect(
      connectorOAuthConfigured(
        config({ oauthProviders: ['google'], connectors: ['drive', 'gmail'] }),
        'slack',
      ),
    ).toBe(false);
  });

  it('still resolves social-funded connectors through their social grant', () => {
    expect(connectorOAuthConfigured(config({ oauthProviders: ['google'] }), 'gtasks')).toBe(true);
    expect(connectorOAuthConfigured(config({}), 'gtasks')).toBe(false);
  });
});

describe('connectorAvailable (slack)', () => {
  it('follows the advertised connectors in production', () => {
    expect(connectorAvailable(config({ connectors: ['slack'] }), 'slack')).toBe(true);
    expect(connectorAvailable(config({}), 'slack')).toBe(false);
  });

  it('is always available in local mock mode', () => {
    expect(connectorAvailable(config({ appMode: 'local' }), 'slack')).toBe(true);
  });
});
