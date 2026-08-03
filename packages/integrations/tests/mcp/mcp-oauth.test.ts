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
  parseMcpOAuthCredential,
  refreshMcpOAuthCredential,
} from '../../src/mcp-oauth';

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
      { serverUrl: 'https://api.sunsama.com/mcp', fetchFn: expect.any(Function) },
    );
    expect(begun.authorizationUrl).toContain('https://login.sunsama.com/authorize');
    expect(begun.credential).toMatchObject({
      kind: 'mcp_oauth_pending',
      codeVerifier: 'pkce-verifier',
    });
  });

  it('omits clientMetadataUrl from the provider when none is configured', async () => {
    auth.mockImplementation(
      async (provider: {
        saveCodeVerifier(value: string): void;
        redirectToAuthorization(url: URL): void;
      }) => {
        provider.saveCodeVerifier('pkce-verifier');
        provider.redirectToAuthorization(new URL('https://login.sunsama.com/authorize'));
      },
    );
    await beginMcpOAuthAuthorization({
      serverUrl: 'https://api.sunsama.com/mcp',
      redirectUrl: 'https://api.docket.test/internal/integrations/mcp/callback',
      state: 'signed-state',
    });
    const [provider] = auth.mock.calls[0] as [Record<string, unknown>];
    expect(provider).not.toHaveProperty('clientMetadataUrl');
  });

  it("the begin provider's codeVerifier getter throws before saveCodeVerifier and returns after", async () => {
    let saved: string | undefined;
    auth.mockImplementation(
      async (provider: {
        codeVerifier(): string;
        saveCodeVerifier(value: string): void;
        redirectToAuthorization(url: URL): void;
      }) => {
        expect(() => provider.codeVerifier()).toThrow(/code verifier was not created/);
        provider.saveCodeVerifier('pkce-verifier');
        saved = provider.codeVerifier();
        provider.redirectToAuthorization(new URL('https://login.sunsama.com/authorize'));
      },
    );
    await beginMcpOAuthAuthorization({
      serverUrl: 'https://api.sunsama.com/mcp',
      redirectUrl: 'https://cb',
      state: 's',
    });
    expect(saved).toBe('pkce-verifier');
  });

  it("exercises the begin provider's full callback surface (saveTokens is a documented no-op — begin never exchanges a code)", async () => {
    auth.mockImplementation(
      async (provider: {
        saveTokens(value: unknown): void;
        saveCodeVerifier(value: string): void;
        redirectToAuthorization(url: URL): void;
      }) => {
        // A documented no-op in this flow — begin never exchanges a code, so nothing reads the
        // saved tokens; calling it here only proves it doesn't throw.
        provider.saveTokens({ access_token: 'x', token_type: 'Bearer' });
        provider.saveCodeVerifier('pkce-verifier');
        provider.redirectToAuthorization(new URL('https://login.sunsama.com/authorize'));
      },
    );
    await beginMcpOAuthAuthorization({
      serverUrl: 'https://api.sunsama.com/mcp',
      redirectUrl: 'https://cb',
      state: 's',
    });
  });

  it('throws when the SDK completes without ever starting a redirect', async () => {
    auth.mockImplementation(async () => undefined);
    await expect(
      beginMcpOAuthAuthorization({
        serverUrl: 'https://api.sunsama.com/mcp',
        redirectUrl: 'https://cb',
        state: 's',
      }),
    ).rejects.toThrow(/did not start an OAuth redirect/);
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

  it("exercises the complete provider's full callback surface, including the discovery-state re-save path", async () => {
    auth.mockImplementation(
      async (provider: {
        clientInformation(): unknown;
        saveClientInformation(value: unknown): void;
        tokens(): unknown;
        saveTokens(value: unknown): void;
        redirectToAuthorization(url: URL): void;
        saveCodeVerifier(value: string): void;
        discoveryState(): unknown;
        saveDiscoveryState(value: unknown): void;
      }) => {
        expect(provider.tokens()).toBeUndefined();
        // Both are no-ops on this path (a redirect/verifier only matter for `begin`); calling
        // them here only proves they don't throw when the SDK happens to invoke them anyway.
        provider.redirectToAuthorization(new URL('https://x'));
        provider.saveCodeVerifier('unused');
        provider.saveClientInformation({ client_id: 'reissued-client' });
        provider.saveDiscoveryState({ authorizationServerUrl: 'https://auth.sunsama.test' });
        expect(provider.discoveryState()).toEqual({
          authorizationServerUrl: 'https://auth.sunsama.test',
        });
        provider.saveTokens({ access_token: 'access', token_type: 'Bearer' });
      },
    );
    const credential = await completeMcpOAuthAuthorization({
      serverUrl: 'https://api.sunsama.com/mcp',
      redirectUrl: 'https://cb',
      authorizationCode: 'code',
      credential: { kind: 'mcp_oauth_pending', codeVerifier: 'pkce' },
    });
    expect(credential.clientInformation).toEqual({ client_id: 'reissued-client' });
    expect(credential.discoveryState).toEqual({
      authorizationServerUrl: 'https://auth.sunsama.test',
    });
  });

  it('throws when the SDK completes the code exchange without saving tokens', async () => {
    auth.mockImplementation(async () => undefined);
    await expect(
      completeMcpOAuthAuthorization({
        serverUrl: 'https://api.sunsama.com/mcp',
        redirectUrl: 'https://cb',
        authorizationCode: 'code',
        credential: { kind: 'mcp_oauth_pending', codeVerifier: 'pkce' },
      }),
    ).rejects.toThrow(/did not return an access token/);
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
        fetchFn: expect.any(Function),
      }),
    );
  });

  it('refreshes without a resource param when discoveryState carries no resourceMetadata', async () => {
    refreshAuthorization.mockResolvedValue({ access_token: 'fresh', token_type: 'Bearer' });
    const credential = {
      kind: 'mcp_oauth' as const,
      tokens: { access_token: 'stale', refresh_token: 'refresh', token_type: 'Bearer' },
      clientInformation: { client_id: 'x' },
      discoveryState: { authorizationServerUrl: 'https://auth.sunsama.test' },
      obtainedAt: new Date().toISOString(),
    };
    await refreshMcpOAuthCredential(credential);
    const [, options] = refreshAuthorization.mock.calls[0] as [string, Record<string, unknown>];
    expect(options).not.toHaveProperty('resource');
  });

  it('preserves the prior refresh token when the provider omits one on rotation', async () => {
    refreshAuthorization.mockResolvedValue({ access_token: 'fresh', token_type: 'Bearer' });
    const credential = {
      kind: 'mcp_oauth' as const,
      tokens: { access_token: 'stale', refresh_token: 'original-refresh', token_type: 'Bearer' },
      clientInformation: { client_id: 'x' },
      discoveryState: { authorizationServerUrl: 'https://auth.sunsama.test' },
      obtainedAt: new Date().toISOString(),
    };
    const refreshed = await refreshMcpOAuthCredential(credential);
    expect(refreshed.tokens.refresh_token).toBe('original-refresh');
  });

  it.each([
    ['no refresh_token', { access_token: 'a', token_type: 'Bearer' }, { client_id: 'x' }, {}],
    [
      'no clientInformation',
      { access_token: 'a', refresh_token: 'r', token_type: 'Bearer' },
      undefined,
      {},
    ],
    [
      'no discoveryState',
      { access_token: 'a', refresh_token: 'r', token_type: 'Bearer' },
      { client_id: 'x' },
      undefined,
    ],
  ])(
    'refuses to refresh when %s is missing',
    async (_label, tokens, clientInformation, discoveryState) => {
      await expect(
        refreshMcpOAuthCredential({
          kind: 'mcp_oauth',
          tokens,
          clientInformation,
          discoveryState,
          obtainedAt: new Date().toISOString(),
        } as never),
      ).rejects.toThrow(/needs to be re-authorized/);
    },
  );
});

describe('mcpOAuthTokenNeedsRefresh', () => {
  it('is false immediately when the credential carries no expires_in (never expires)', () => {
    expect(
      mcpOAuthTokenNeedsRefresh({
        kind: 'mcp_oauth',
        tokens: { access_token: 'a', token_type: 'Bearer' },
        obtainedAt: new Date().toISOString(),
      }),
    ).toBe(false);
  });

  it('is true when obtainedAt is unparseable (fails closed)', () => {
    expect(
      mcpOAuthTokenNeedsRefresh({
        kind: 'mcp_oauth',
        tokens: { access_token: 'a', token_type: 'Bearer', expires_in: 3600 },
        obtainedAt: 'not-a-date',
      }),
    ).toBe(true);
  });

  it('is false when well within the token lifetime, using the default nowMs', () => {
    expect(
      mcpOAuthTokenNeedsRefresh({
        kind: 'mcp_oauth',
        tokens: { access_token: 'a', token_type: 'Bearer', expires_in: 3600 },
        obtainedAt: new Date().toISOString(),
      }),
    ).toBe(false);
  });
});

describe('parseMcpOAuthCredential', () => {
  it('parses an approved credential', () => {
    const raw = JSON.stringify({
      kind: 'mcp_oauth',
      tokens: { access_token: 'a', token_type: 'Bearer' },
      obtainedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(parseMcpOAuthCredential(raw)).toMatchObject({ kind: 'mcp_oauth' });
  });

  it('parses a pending credential', () => {
    const raw = JSON.stringify({ kind: 'mcp_oauth_pending', codeVerifier: 'v' });
    expect(parseMcpOAuthCredential(raw)).toMatchObject({ kind: 'mcp_oauth_pending' });
  });

  it('returns null for well-formed JSON with an unrecognized kind', () => {
    expect(parseMcpOAuthCredential(JSON.stringify({ kind: 'legacy_bearer' }))).toBeNull();
  });

  it('returns null for unparseable JSON (a legacy plain-text bearer credential)', () => {
    expect(parseMcpOAuthCredential('not-json-at-all')).toBeNull();
  });
});
