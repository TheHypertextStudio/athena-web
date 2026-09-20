import type * as OAuthProviderModule from '@better-auth/oauth-provider';
import type * as BetterAuthApiModule from 'better-auth/api';
import { describe, expect, it, vi } from 'vitest';

const providerState = vi.hoisted(() => vi.fn());
const genericState = vi.hoisted(() => vi.fn());

vi.mock('@better-auth/oauth-provider', async (importOriginal) => ({
  ...(await importOriginal<typeof OAuthProviderModule>()),
  getOAuthProviderState: providerState,
}));

vi.mock('better-auth/api', async (importOriginal) => ({
  ...(await importOriginal<typeof BetterAuthApiModule>()),
  getOAuthState: genericState,
}));

import { currentAuthorizationRequest } from '../src/oauth-provider-authorization-state';

const RESOURCES = {
  issuer: 'https://api.clearthedocket.com/api/auth',
  mcpResource: 'https://api.clearthedocket.com/mcp',
  restResource: 'https://api.clearthedocket.com/v1',
};

describe('OAuth authorization request state fallback', () => {
  it('uses generic state only when provider state has no query', async () => {
    providerState.mockResolvedValueOnce(null);
    genericState.mockResolvedValueOnce({
      query: `client_id=generic&resource=${encodeURIComponent(RESOURCES.restResource)}`,
    });

    await expect(currentAuthorizationRequest(RESOURCES)).resolves.toEqual({
      request: { clientId: 'generic', resource: RESOURCES.restResource },
      rawQuery: `client_id=generic&resource=${encodeURIComponent(RESOURCES.restResource)}`,
    });
  });

  it('defaults an absent provider and generic query to the MCP request', async () => {
    providerState.mockResolvedValueOnce({});
    genericState.mockResolvedValueOnce({ query: 42 });

    await expect(currentAuthorizationRequest(RESOURCES)).resolves.toEqual({
      request: { clientId: '', resource: RESOURCES.mcpResource },
      rawQuery: '',
    });
  });
});
