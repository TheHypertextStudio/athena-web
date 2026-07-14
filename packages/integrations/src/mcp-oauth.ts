/**
 * OAuth authorization primitives for remote MCP servers.
 *
 * @remarks
 * This deliberately delegates protocol details to the official MCP SDK. It therefore follows
 * current MCP authorization requirements: protected-resource discovery, authorization-server
 * discovery, PKCE, resource indicators, CIMD when offered, and dynamic registration fallback.
 */
import {
  auth,
  refreshAuthorization,
  type OAuthDiscoveryState,
} from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';

/** Persisted, encrypted state while an OAuth browser approval is in progress. */
export interface PendingMcpOAuthCredential {
  readonly kind: 'mcp_oauth_pending';
  readonly codeVerifier: string;
  readonly clientInformation?: OAuthClientInformationMixed;
  readonly discoveryState?: OAuthDiscoveryState;
}

/** Persisted, encrypted credential for an approved remote MCP connection. */
export interface McpOAuthCredential {
  readonly kind: 'mcp_oauth';
  readonly tokens: OAuthTokens;
  readonly clientInformation?: OAuthClientInformationMixed;
  readonly discoveryState?: OAuthDiscoveryState;
  /** When Docket received the token, used to refresh short-lived credentials before use. */
  readonly obtainedAt: string;
}

/** The values Docket needs to begin an MCP OAuth browser approval. */
export interface BeginMcpOAuthInput {
  readonly serverUrl: string;
  readonly redirectUrl: string;
  readonly clientMetadataUrl?: string;
  readonly state: string;
}

/** The authorization URL plus encrypted-at-rest state required by the callback. */
export interface BegunMcpOAuthAuthorization {
  readonly authorizationUrl: string;
  readonly credential: PendingMcpOAuthCredential;
}

/** Metadata published by Docket for both CIMD and dynamic client registration. */
export function mcpOAuthClientMetadata(redirectUrl: string): OAuthClientMetadata {
  return {
    client_name: 'Docket Athena',
    redirect_uris: [redirectUrl],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  };
}

/** Begin OAuth authorization with the official MCP SDK. */
export async function beginMcpOAuthAuthorization(
  input: BeginMcpOAuthInput,
): Promise<BegunMcpOAuthAuthorization> {
  let authorizationUrl: string | undefined;
  let codeVerifier: string | undefined;
  let clientInformation: OAuthClientInformationMixed | undefined;
  let discoveryState: OAuthDiscoveryState | undefined;
  const provider = {
    redirectUrl: input.redirectUrl,
    ...(input.clientMetadataUrl ? { clientMetadataUrl: input.clientMetadataUrl } : {}),
    clientMetadata: mcpOAuthClientMetadata(input.redirectUrl),
    state: () => input.state,
    clientInformation: () => clientInformation,
    saveClientInformation: (value: OAuthClientInformationMixed) => {
      clientInformation = value;
    },
    tokens: () => undefined,
    saveTokens: (_value: OAuthTokens) => undefined,
    redirectToAuthorization: (url: URL) => {
      authorizationUrl = url.toString();
    },
    saveCodeVerifier: (value: string) => {
      codeVerifier = value;
    },
    codeVerifier: () => {
      if (!codeVerifier) throw new Error('MCP OAuth code verifier was not created');
      return codeVerifier;
    },
    saveDiscoveryState: (value: OAuthDiscoveryState) => {
      discoveryState = value;
    },
  };
  await auth(provider, { serverUrl: input.serverUrl });
  if (!authorizationUrl || !codeVerifier)
    throw new Error('MCP server did not start an OAuth redirect');
  return {
    authorizationUrl,
    credential: {
      kind: 'mcp_oauth_pending',
      codeVerifier,
      ...(clientInformation ? { clientInformation } : {}),
      ...(discoveryState ? { discoveryState } : {}),
    },
  };
}

/** Complete a browser approval and return the encrypted-at-rest credential payload. */
export async function completeMcpOAuthAuthorization(input: {
  readonly serverUrl: string;
  readonly redirectUrl: string;
  readonly authorizationCode: string;
  readonly credential: PendingMcpOAuthCredential;
}): Promise<McpOAuthCredential> {
  let tokens: OAuthTokens | undefined;
  let clientInformation = input.credential.clientInformation;
  let discoveryState = input.credential.discoveryState;
  const provider = {
    redirectUrl: input.redirectUrl,
    clientMetadata: mcpOAuthClientMetadata(input.redirectUrl),
    clientInformation: () => clientInformation,
    saveClientInformation: (value: OAuthClientInformationMixed) => {
      clientInformation = value;
    },
    tokens: () => undefined,
    saveTokens: (value: OAuthTokens) => {
      tokens = value;
    },
    redirectToAuthorization: () => undefined,
    saveCodeVerifier: () => undefined,
    codeVerifier: () => input.credential.codeVerifier,
    discoveryState: () => discoveryState,
    saveDiscoveryState: (value: OAuthDiscoveryState) => {
      discoveryState = value;
    },
  };
  await auth(provider, { serverUrl: input.serverUrl, authorizationCode: input.authorizationCode });
  if (!tokens) throw new Error('MCP OAuth authorization did not return an access token');
  return {
    kind: 'mcp_oauth',
    tokens,
    ...(clientInformation ? { clientInformation } : {}),
    ...(discoveryState ? { discoveryState } : {}),
    obtainedAt: new Date().toISOString(),
  };
}

/** Refresh an approved connection when its token is nearing expiry. */
export async function refreshMcpOAuthCredential(
  credential: McpOAuthCredential,
): Promise<McpOAuthCredential> {
  if (
    !credential.tokens.refresh_token ||
    !credential.clientInformation ||
    !credential.discoveryState
  ) {
    throw new Error('MCP OAuth connection needs to be re-authorized');
  }
  const refreshedTokens = await refreshAuthorization(
    credential.discoveryState.authorizationServerUrl,
    {
      metadata: credential.discoveryState.authorizationServerMetadata,
      clientInformation: credential.clientInformation,
      refreshToken: credential.tokens.refresh_token,
      ...(credential.discoveryState.resourceMetadata
        ? { resource: new URL(credential.discoveryState.resourceMetadata.resource) }
        : {}),
    },
  );
  // The SDK preserves this already, but retain it here as a defense for OAuth servers that omit
  // the refresh token in a rotation response.
  const tokens = {
    ...refreshedTokens,
    refresh_token: refreshedTokens.refresh_token ?? credential.tokens.refresh_token,
  };
  return { ...credential, tokens, obtainedAt: new Date().toISOString() };
}

/** Whether a short-lived OAuth token should be refreshed before an agent uses it. */
export function mcpOAuthTokenNeedsRefresh(
  credential: McpOAuthCredential,
  nowMs: number = Date.now(),
): boolean {
  if (!credential.tokens.expires_in) return false;
  const obtainedAt = Date.parse(credential.obtainedAt);
  return (
    !Number.isFinite(obtainedAt) ||
    obtainedAt + credential.tokens.expires_in * 1_000 - 60_000 <= nowMs
  );
}

/** Decode an encrypted MCP OAuth credential without accepting arbitrary JSON as a token. */
export function parseMcpOAuthCredential(
  value: string,
): McpOAuthCredential | PendingMcpOAuthCredential | null {
  try {
    const parsed = JSON.parse(value) as { readonly kind?: string };
    if (parsed.kind === 'mcp_oauth' || parsed.kind === 'mcp_oauth_pending') {
      return parsed as McpOAuthCredential | PendingMcpOAuthCredential;
    }
  } catch {
    // Legacy bearer credentials are intentionally plain text and are handled by the caller.
  }
  return null;
}
