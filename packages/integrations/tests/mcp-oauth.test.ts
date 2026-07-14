import { beforeEach, describe, expect, it, vi } from 'vitest';

const { auth, refreshAuthorization } = vi.hoisted(() => ({
  auth: vi.fn(),
  refreshAuthorization: vi.fn(),
}));

vi.mock('@modelcontextprotocol/sdk/client/auth.js', () => ({ auth, refreshAuthorization }));

import {
  beginMcpOAuthAuthorization,
  completeMcpOAuthAuthorization,
  mcpOAuthTokenNeedsRefresh,
  mcpOAuthClientMetadata,
  refreshMcpOAuthCredential,
} from '../src/mcp-oauth';

describe('remote MCP OAuth', () => {
  beforeEach(() => {
    auth.mockReset();
    refreshAuthorization.mockReset();
  });

  it('hands CIMD, signed state, and the PKCE verifier to the official MCP client flow', async () => {
    auth.mockImplementation(
      async (provider: {
        saveCodeVerifier(value: string): void;
        redirectToAuthorization(url: URL): void;
      }) => {
        provider.saveCodeVerifier('pkce-verifier');
        provider.redirectToAuthorization(
          new URL('https://login.sunsama.com/authorize?state=signed-state'),
        );
      },
    );

    const begun = await beginMcpOAuthAuthorization({
      serverUrl: 'https://api.sunsama.com/mcp',
      redirectUrl: 'https://api.docket.test/internal/integrations/mcp/callback',
      clientMetadataUrl: 'https://api.docket.test/.well-known/mcp-client.json',
      state: 'signed-state',
    });

    expect(auth).toHaveBeenCalledWith(
      expect.objectContaining({
        clientMetadataUrl: 'https://api.docket.test/.well-known/mcp-client.json',
        state: expect.any(Function),
      }),
      { serverUrl: 'https://api.sunsama.com/mcp' },
    );
    expect(begun.authorizationUrl).toContain('https://login.sunsama.com/authorize');
    expect(begun.credential).toMatchObject({
      kind: 'mcp_oauth_pending',
      codeVerifier: 'pkce-verifier',
    });
  });

  it('retains the SDK-issued registration state and saves exchanged OAuth tokens', async () => {
    auth.mockImplementation(
      async (provider: {
        saveTokens(value: {
          access_token: string;
          token_type: string;
          refresh_token: string;
        }): void;
      }) => {
        provider.saveTokens({
          access_token: 'access',
          token_type: 'Bearer',
          refresh_token: 'refresh',
        });
      },
    );
    const credential = await completeMcpOAuthAuthorization({
      serverUrl: 'https://api.sunsama.com/mcp',
      redirectUrl: 'https://api.docket.test/internal/integrations/mcp/callback',
      authorizationCode: 'code',
      credential: { kind: 'mcp_oauth_pending', codeVerifier: 'pkce' },
    });
    expect(credential).toMatchObject({
      kind: 'mcp_oauth',
      tokens: { access_token: 'access', refresh_token: 'refresh' },
    });
  });

  it('publishes OAuth 2.1 public-client metadata for CIMD and DCR', () => {
    expect(mcpOAuthClientMetadata('https://api.docket.test/callback')).toEqual({
      client_name: 'Docket Athena',
      redirect_uris: ['https://api.docket.test/callback'],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    });
  });

  it('refreshes expiring approved credentials with the discovered resource audience', async () => {
    refreshAuthorization.mockResolvedValue({ access_token: 'fresh', token_type: 'Bearer' });
    const credential = {
      kind: 'mcp_oauth' as const,
      tokens: {
        access_token: 'stale',
        refresh_token: 'refresh',
        token_type: 'Bearer',
        expires_in: 60,
      },
      clientInformation: { client_id: 'https://api.docket.test/.well-known/mcp-client.json' },
      discoveryState: {
        authorizationServerUrl: 'https://auth.sunsama.test',
        resourceMetadata: { resource: 'https://api.sunsama.test/mcp' },
      },
      obtainedAt: new Date(Date.now() - 61_000).toISOString(),
    };
    expect(mcpOAuthTokenNeedsRefresh(credential)).toBe(true);

    const refreshed = await refreshMcpOAuthCredential(credential);

    expect(refreshed.tokens).toMatchObject({ access_token: 'fresh', refresh_token: 'refresh' });
    expect(refreshAuthorization).toHaveBeenCalledWith(
      'https://auth.sunsama.test',
      expect.objectContaining({
        refreshToken: 'refresh',
        resource: new URL('https://api.sunsama.test/mcp'),
      }),
    );
  });
});
