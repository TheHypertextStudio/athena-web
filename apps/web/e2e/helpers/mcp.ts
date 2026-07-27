/**
 * MCP OAuth 2.1 helpers for the e2e flows — discovery, DCR, PKCE, browser consent,
 * token exchange, and raw Streamable HTTP JSON-RPC calls against `/mcp`.
 *
 * @remarks
 * Discovery, dynamic client registration, and token exchange run through the OFFICIAL
 * `@modelcontextprotocol/sdk` client functions (`discoverOAuthServerInfo`, `registerClient`,
 * `startAuthorization`, `exchangeAuthorization`) rather than hand-rolled `fetch`/request calls.
 * This is not cosmetic: a hand-rolled discovery helper that hits a known-good URL directly
 * proves nothing about whether a REAL client (Claude Desktop, claude.ai, Cursor, or this SDK
 * itself) can actually find that URL on its own. That gap shipped a production incident —
 * `/api/auth/.well-known/oauth-authorization-server` (bare root) worked, but the RFC 8414
 * path-aware location every spec-compliant client tries FIRST for an issuer with a path
 * (`/.well-known/oauth-authorization-server/api/auth`) 404'd, and no hand-rolled test caught
 * it because none of them walked the real discovery algorithm. See `mcp/server.ts`'s
 * `authorizationServerMetadata` remarks.
 *
 * The dev stack splits the browser origin ({@link ORIGIN}, `docket.localhost`) from the
 * API origin ({@link API_ORIGIN}, `api.docket.localhost`). Cookie-less OAuth machinery
 * (discovery, registration, token exchange, Bearer MCP calls) talks to the API origin
 * directly; the interactive authorize/consent leg navigates through the WEB origin's
 * `/api/auth` rewrite so the host-only session cookie minted by the passkey sign-up rides
 * along. In production AS + RS share the API origin and the cookie lives there, so real
 * clients follow the discovery metadata verbatim — this split is dev-only.
 */
import {
  discoverOAuthServerInfo,
  exchangeAuthorization,
  registerClient as sdkRegisterClient,
  startAuthorization,
} from '@modelcontextprotocol/sdk/client/auth.js';
import type { AuthorizationServerMetadata } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { APIRequestContext, Page } from '@playwright/test';

import { ORIGIN, TIMEOUTS } from './constants';
import { expect } from './fixtures';

/** The Hono API origin (`API_URL` in `.env.local`); the `/mcp` RS + OAuth AS live here. */
export const API_ORIGIN = process.env['API_URL'] ?? `https://api.${new URL(ORIGIN).hostname}`;

/** The MCP Streamable HTTP endpoint under test. */
export const MCP_URL = `${API_ORIGIN}/mcp`;

/** A redirect URI on the app origin; the route does not exist — the spec only reads the URL. */
export const REDIRECT_URI = `${ORIGIN}/e2e/oauth/callback`;

/**
 * The AS location + metadata document a real client walked away with, exactly as
 * {@link discoverOAuthServerInfo} returns it — nothing reshaped or renamed.
 */
export interface Discovery {
  readonly authorizationServerUrl: string;
  readonly metadata: AuthorizationServerMetadata;
}

/**
 * Walk the full discovery chain a real MCP client follows, via the official SDK: the
 * Protected Resource Metadata (RFC 9728) names the AS, then
 * {@link discoverOAuthServerInfo} tries every RFC 8414 / OIDC candidate location for that
 * AS's metadata document, in the SDK's own priority order — the same probing a real client
 * does, not a single known-good URL a test author happens to already know works.
 */
export async function discover(): Promise<Discovery> {
  const info = await discoverOAuthServerInfo(MCP_URL);
  expect(info.resourceMetadata?.resource, 'PRM must name this exact MCP resource').toBe(MCP_URL);
  expect(
    info.authorizationServerMetadata,
    'the official SDK must be able to discover AS metadata (RFC 8414) for this issuer via one of its standard well-known locations — the RS only advertises the issuer string, so the client is entirely on its own to find the document',
  ).toBeTruthy();
  const metadata = info.authorizationServerMetadata;
  if (!metadata) throw new Error('AS metadata discovery failed');
  expect(metadata.code_challenge_methods_supported).toContain('S256');
  return { authorizationServerUrl: info.authorizationServerUrl, metadata };
}

/** Dynamically register a public PKCE client (RFC 7591) via the SDK and return its `client_id`. */
export async function registerClient(discovery: Discovery, clientName: string): Promise<string> {
  const client = await sdkRegisterClient(discovery.authorizationServerUrl, {
    metadata: discovery.metadata,
    clientMetadata: {
      client_name: clientName,
      redirect_uris: [REDIRECT_URI],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    },
  });
  expect(client.client_id).toBeTruthy();
  // Registering WITHOUT a `scope` is what every real MCP client does, and the AS writes its
  // default onto the client row — which then caps every later authorize AND token exchange. If a
  // narrower default ever comes back, the client is pinned below these scopes permanently and no
  // step-up can rescue it, so assert the inherited ceiling here rather than downstream where it
  // surfaces as a confusing mid-flow `invalid_scope`.
  const inherited = (client.scope ?? '').split(' ').filter(Boolean);
  for (const scope of [
    'work:read',
    'work:write',
    'agents:run',
    'connectors:link',
    'offline_access',
  ]) {
    expect(inherited, `a client registering without \`scope\` must inherit ${scope}`).toContain(
      scope,
    );
  }
  return client.client_id;
}

/**
 * Run the interactive authorize + consent leg in the signed-in browser and return the
 * authorization code plus the PKCE verifier the SDK generated for it.
 *
 * @remarks
 * Navigates the authorize URL through the WEB origin's `/api/auth` rewrite (see module
 * remarks), approves on the consent screen, and captures the `code` from the redirect
 * back to {@link REDIRECT_URI} (a non-route — only its URL matters).
 */
export async function authorizeInBrowser(
  page: Page,
  discovery: Discovery,
  opts: { clientId: string; scope: string },
): Promise<{ code: string; codeVerifier: string }> {
  const { authorizationUrl, codeVerifier } = await startAuthorization(
    discovery.authorizationServerUrl,
    {
      metadata: discovery.metadata,
      clientInformation: { client_id: opts.clientId },
      redirectUrl: REDIRECT_URI,
      scope: opts.scope,
      // RFC 8707 resource indicator, which the MCP spec requires of clients. It is what binds
      // the access token's `aud` to this resource server; omit it and the AS mints an
      // audience-less token that the RS correctly refuses.
      resource: new URL(MCP_URL),
    },
  );
  const authorizePath = authorizationUrl.pathname + authorizationUrl.search;
  await page.goto(authorizePath);

  // A scope set not yet consented to lands on the consent screen; approve it.
  await expect(page.getByRole('button', { name: 'Authorize' })).toBeVisible({
    timeout: TIMEOUTS.ceremony,
  });
  await page.getByRole('button', { name: 'Authorize' }).click();

  await page.waitForURL(`${REDIRECT_URI}*`, { timeout: TIMEOUTS.ceremony });
  const redirected = new URL(page.url());
  expect(redirected.searchParams.get('error')).toBeNull();
  const code = redirected.searchParams.get('code');
  expect(code, 'authorize redirect must carry a code').toBeTruthy();
  if (!code) throw new Error('authorize redirect must carry a code');
  return { code, codeVerifier };
}

/** Exchange an authorization code for an access token (public client + PKCE), via the SDK. */
export async function exchangeCode(
  discovery: Discovery,
  opts: { clientId: string; code: string; codeVerifier: string },
): Promise<{ accessToken: string; scope: string; refreshToken: string | null }> {
  const tokens = await exchangeAuthorization(discovery.authorizationServerUrl, {
    metadata: discovery.metadata,
    clientInformation: { client_id: opts.clientId },
    authorizationCode: opts.code,
    codeVerifier: opts.codeVerifier,
    redirectUri: REDIRECT_URI,
    // Repeated at the token endpoint per RFC 8707 §2.2 — this is the request the AS actually
    // reads the audience from when stamping `aud`.
    resource: new URL(MCP_URL),
  });
  expect(tokens.access_token).toBeTruthy();
  return {
    accessToken: tokens.access_token,
    scope: tokens.scope ?? '',
    refreshToken: tokens.refresh_token ?? null,
  };
}

/** Register + authorize + exchange in one go; returns a Bearer token for `scope`. */
export async function mintToken(
  page: Page,
  discovery: Discovery,
  opts: { clientId: string; scope: string },
): Promise<string> {
  const { code, codeVerifier } = await authorizeInBrowser(page, discovery, opts);
  const { accessToken } = await exchangeCode(discovery, {
    clientId: opts.clientId,
    code,
    codeVerifier,
  });
  return accessToken;
}

/** The raw outcome of one `/mcp` POST: HTTP status/headers plus the JSON-RPC result. */
export interface McpResponse {
  status: number;
  wwwAuthenticate: string | null;
  /** The JSON-RPC `result` (or the Problem body on a non-2xx transport response). */
  body: unknown;
}

/**
 * Extract the JSON-RPC payload from a Streamable HTTP response body.
 *
 * @remarks
 * The stateless transport answers POSTs as an SSE stream (`event: message` frames); a
 * transport-level rejection is plain JSON. Both shapes reduce to "the last `data:` JSON".
 */
function parseStreamable(text: string, contentType: string): unknown {
  try {
    if (contentType.includes('text/event-stream')) {
      const datas = text
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim());
      const last = datas.at(-1);
      return last ? (JSON.parse(last) as unknown) : null;
    }
    return text ? (JSON.parse(text) as unknown) : null;
  } catch {
    // A non-JSON body (e.g. a proxy error page) — surface it raw so assertions on
    // `status` fail with the actual payload in view instead of a parse crash.
    return text;
  }
}

let rpcId = 0;

/** POST one JSON-RPC request to `/mcp` with a Bearer token and return the parsed outcome. */
export async function mcpCall(
  request: APIRequestContext,
  token: string | null,
  method: string,
  params: unknown,
): Promise<McpResponse> {
  // The dev API hot-reloads (tsx watch); a request landing mid-restart gets a 502/503
  // from the portless proxy. Retry those — they are never a real MCP outcome.
  for (let attempt = 0; ; attempt++) {
    const res = await request.post(MCP_URL, {
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      data: { jsonrpc: '2.0', id: (rpcId += 1), method, params },
    });
    if ((res.status() === 502 || res.status() === 503) && attempt < 5) {
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }
    const text = await res.text();
    return {
      status: res.status(),
      wwwAuthenticate: res.headers()['www-authenticate'] ?? null,
      body: parseStreamable(text, res.headers()['content-type'] ?? ''),
    };
  }
}

/** A `tools/call` over {@link mcpCall}; returns the tool's `structuredContent`, failing loudly. */
export async function mcpToolCall<T>(
  request: APIRequestContext,
  token: string,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const res = await mcpCall(request, token, 'tools/call', { name, arguments: args });
  expect(res.status, `${name} transport status`).toBe(200);
  const rpc = res.body as {
    result?: { isError?: boolean; structuredContent?: T; content?: { text?: string }[] };
  };
  expect(
    rpc.result?.isError,
    `${name} tool error: ${rpc.result?.content?.[0]?.text ?? ''}`,
  ).toBeFalsy();
  const structuredContent = rpc.result?.structuredContent;
  expect(structuredContent, `${name} must return structuredContent`).toBeTruthy();
  if (!structuredContent) throw new Error(`${name} must return structuredContent`);
  return structuredContent;
}

/** A `resources/read` over {@link mcpCall}; returns the (JSON-parsed) first contents entry. */
export async function mcpReadResource<T>(
  request: APIRequestContext,
  token: string,
  uri: string,
): Promise<T> {
  const res = await mcpCall(request, token, 'resources/read', { uri });
  expect(res.status, `resources/read ${uri} transport status`).toBe(200);
  const rpc = res.body as { result?: { contents?: { text?: string }[] }; error?: unknown };
  expect(rpc.error, `resources/read ${uri} rpc error`).toBeUndefined();
  const text = rpc.result?.contents?.[0]?.text;
  expect(text, `resources/read ${uri} must return contents`).toBeTruthy();
  if (!text) throw new Error(`resources/read ${uri} must return contents`);
  return JSON.parse(text) as T;
}
