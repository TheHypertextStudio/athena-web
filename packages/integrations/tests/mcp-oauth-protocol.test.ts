import { afterEach, describe, expect, it, vi } from 'vitest';

import { beginMcpOAuthAuthorization, completeMcpOAuthAuthorization } from '../src/mcp-oauth';

const SERVER = 'https://api.sunsama.test/mcp';
const AUTHORITY = 'https://auth.sunsama.test';
const CALLBACK = 'https://api.docket.test/internal/integrations/mcp/callback';
const CIMD = 'https://api.docket.test/.well-known/mcp-client.json';

/** Return one valid RFC 8414 response used by the MCP SDK's discovery implementation. */
function authorizationMetadata(overrides: Record<string, unknown> = {}): Response {
  return Response.json({
    issuer: AUTHORITY,
    authorization_endpoint: `${AUTHORITY}/authorize`,
    token_endpoint: `${AUTHORITY}/token`,
    response_types_supported: ['code'],
    code_challenge_methods_supported: ['S256'],
    ...overrides,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('remote MCP OAuth protocol behavior', () => {
  it('uses RFC 9728 discovery and current CIMD instead of dynamic registration when advertised', async () => {
    const fetch = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url === 'https://api.sunsama.test/.well-known/oauth-protected-resource/mcp') {
        return Response.json({
          resource: SERVER,
          authorization_servers: [AUTHORITY],
          scopes_supported: ['tasks.read', 'tasks.write'],
        });
      }
      if (url === 'https://auth.sunsama.test/.well-known/oauth-authorization-server') {
        return authorizationMetadata({ client_id_metadata_document_supported: true });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const begun = await beginMcpOAuthAuthorization(
      {
        serverUrl: SERVER,
        redirectUrl: CALLBACK,
        clientMetadataUrl: CIMD,
        state: 'signed-state',
      },
      fetch,
    );

    const authorization = new URL(begun.authorizationUrl);
    expect(authorization.origin).toBe(AUTHORITY);
    expect(authorization.searchParams.get('client_id')).toBe(CIMD);
    expect(authorization.searchParams.get('resource')).toBe(SERVER);
    expect(authorization.searchParams.get('state')).toBe('signed-state');
    expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('falls back to RFC 7591 dynamic client registration when CIMD is not advertised', async () => {
    const fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === 'https://api.sunsama.test/.well-known/oauth-protected-resource/mcp') {
        return Response.json({ resource: SERVER, authorization_servers: [AUTHORITY] });
      }
      if (url === 'https://auth.sunsama.test/.well-known/oauth-authorization-server') {
        return authorizationMetadata({ registration_endpoint: `${AUTHORITY}/register` });
      }
      if (url === 'https://auth.sunsama.test/register') {
        expect(init?.method).toBe('POST');
        return Response.json({
          client_id: 'registered-docket-client',
          redirect_uris: [CALLBACK],
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const begun = await beginMcpOAuthAuthorization(
      {
        serverUrl: SERVER,
        redirectUrl: CALLBACK,
        clientMetadataUrl: CIMD,
        state: 'signed-state',
      },
      fetch,
    );

    expect(new URL(begun.authorizationUrl).searchParams.get('client_id')).toBe(
      'registered-docket-client',
    );
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('exchanges the browser code with its persisted PKCE verifier and RFC 8707 resource', async () => {
    const fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === 'https://api.sunsama.test/.well-known/oauth-protected-resource/mcp') {
        return Response.json({ resource: SERVER, authorization_servers: [AUTHORITY] });
      }
      if (url === 'https://auth.sunsama.test/.well-known/oauth-authorization-server') {
        return authorizationMetadata({ client_id_metadata_document_supported: true });
      }
      if (url === 'https://auth.sunsama.test/token') {
        expect(init?.body).toBeInstanceOf(URLSearchParams);
        const params = init?.body as URLSearchParams;
        expect(params.get('grant_type')).toBe('authorization_code');
        expect(params.get('code')).toBe('approval-code');
        expect(params.get('resource')).toBe(SERVER);
        expect(params.get('code_verifier')).toBeTruthy();
        return Response.json({
          access_token: 'access',
          refresh_token: 'refresh',
          token_type: 'Bearer',
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const begun = await beginMcpOAuthAuthorization(
      {
        serverUrl: SERVER,
        redirectUrl: CALLBACK,
        clientMetadataUrl: CIMD,
        state: 'signed-state',
      },
      fetch,
    );
    const complete = await completeMcpOAuthAuthorization(
      {
        serverUrl: SERVER,
        redirectUrl: CALLBACK,
        authorizationCode: 'approval-code',
        credential: begun.credential,
      },
      fetch,
    );

    expect(complete.tokens).toMatchObject({ access_token: 'access', refresh_token: 'refresh' });
    expect(complete.obtainedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
