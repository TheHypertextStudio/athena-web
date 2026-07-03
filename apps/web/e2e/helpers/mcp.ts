/**
 * MCP OAuth 2.1 helpers for the e2e flows — discovery, DCR, PKCE, browser consent,
 * token exchange, and raw Streamable HTTP JSON-RPC calls against `/mcp`.
 *
 * @remarks
 * The dev stack splits the browser origin ({@link ORIGIN}, `docket.localhost`) from the
 * API origin ({@link API_ORIGIN}, `api.docket.localhost`). Cookie-less OAuth machinery
 * (discovery, registration, token exchange, Bearer MCP calls) talks to the API origin via
 * Playwright request contexts; the interactive authorize/consent leg navigates through the
 * WEB origin's `/api/auth` rewrite so the host-only session cookie minted by the passkey
 * sign-up rides along. In production AS + RS share the API origin and the cookie lives
 * there, so real clients follow the discovery metadata verbatim — this split is dev-only.
 */
import { createHash, randomBytes } from 'node:crypto';

import type { APIRequestContext, Page } from '@playwright/test';

import { ORIGIN, TIMEOUTS } from './constants';
import { expect } from './fixtures';

/** The Hono API origin (`API_URL` in `.env.local`); the `/mcp` RS + OAuth AS live here. */
export const API_ORIGIN = process.env['API_URL'] ?? `https://api.${new URL(ORIGIN).hostname}`;

/** The MCP Streamable HTTP endpoint under test. */
export const MCP_URL = `${API_ORIGIN}/mcp`;

/** A redirect URI on the app origin; the route does not exist — the spec only reads the URL. */
export const REDIRECT_URI = `${ORIGIN}/e2e/oauth/callback`;

/** One PKCE S256 pair (RFC 7636). */
export interface Pkce {
  verifier: string;
  challenge: string;
}

/** Mint a PKCE verifier + S256 challenge. */
export function newPkce(): Pkce {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/** The AS endpoints the flows exercise, discovered via the RFC 9728 → RFC 8414 chain. */
export interface Discovery {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint: string;
}

/**
 * Walk the full discovery chain a real MCP client follows: the Protected Resource
 * Metadata names the AS, whose `/.well-known/oauth-authorization-server` 307-redirects
 * to the live OIDC configuration.
 */
export async function discover(request: APIRequestContext): Promise<Discovery> {
  const prmRes = await request.get(`${API_ORIGIN}/.well-known/oauth-protected-resource/mcp`);
  expect(prmRes.status(), 'PRM document must be served').toBe(200);
  const prm = (await prmRes.json()) as { resource: string; authorization_servers: string[] };
  expect(prm.resource).toBe(MCP_URL);
  const issuer = prm.authorization_servers[0];
  expect(issuer, 'PRM must name an authorization server').toBeTruthy();

  // Playwright follows the 307 to <issuer>/.well-known/openid-configuration.
  const asRes = await request.get(`${API_ORIGIN}/.well-known/oauth-authorization-server`);
  expect(
    asRes.status(),
    'AS discovery must resolve — is the MCP OAuth env (MCP_ISSUER_URL/MCP_RESOURCE_URL/OIDC_LOGIN_PAGE_URL) set for the dev stack?',
  ).toBe(200);
  const meta = (await asRes.json()) as {
    issuer: string;
    authorization_endpoint: string;
    token_endpoint: string;
    registration_endpoint: string;
    code_challenge_methods_supported?: string[];
  };
  expect(meta.code_challenge_methods_supported).toContain('S256');
  return {
    issuer: issuer!,
    authorizationEndpoint: meta.authorization_endpoint,
    tokenEndpoint: meta.token_endpoint,
    registrationEndpoint: meta.registration_endpoint,
  };
}

/** Dynamically register a public PKCE client (RFC 7591) and return its `client_id`. */
export async function registerClient(
  request: APIRequestContext,
  discovery: Discovery,
  clientName: string,
): Promise<string> {
  const res = await request.post(discovery.registrationEndpoint, {
    data: {
      client_name: clientName,
      redirect_uris: [REDIRECT_URI],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    },
  });
  expect(res.status(), 'dynamic client registration must succeed').toBe(201);
  const body = (await res.json()) as { client_id: string };
  expect(body.client_id).toBeTruthy();
  return body.client_id;
}

/**
 * Run the interactive authorize + consent leg in the signed-in browser and return the
 * authorization code.
 *
 * @remarks
 * Navigates the authorize URL through the WEB origin's `/api/auth` rewrite (see module
 * remarks), approves on the consent screen, and captures the `code` from the redirect
 * back to {@link REDIRECT_URI} (a non-route — only its URL matters).
 */
export async function authorizeInBrowser(
  page: Page,
  discovery: Discovery,
  opts: { clientId: string; scope: string; pkce: Pkce },
): Promise<string> {
  const authorizePath = new URL(discovery.authorizationEndpoint).pathname;
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: opts.clientId,
    redirect_uri: REDIRECT_URI,
    scope: opts.scope,
    state: randomBytes(8).toString('hex'),
    code_challenge: opts.pkce.challenge,
    code_challenge_method: 'S256',
  });
  await page.goto(`${authorizePath}?${params.toString()}`);

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
  return code!;
}

/** Exchange an authorization code for an access token (public client + PKCE). */
export async function exchangeCode(
  request: APIRequestContext,
  discovery: Discovery,
  opts: { clientId: string; code: string; pkce: Pkce },
): Promise<{ accessToken: string; scope: string }> {
  const res = await request.post(discovery.tokenEndpoint, {
    form: {
      grant_type: 'authorization_code',
      code: opts.code,
      redirect_uri: REDIRECT_URI,
      client_id: opts.clientId,
      code_verifier: opts.pkce.verifier,
    },
  });
  expect(res.status(), 'token exchange must succeed').toBe(200);
  const body = (await res.json()) as { access_token: string; scope?: string };
  expect(body.access_token).toBeTruthy();
  return { accessToken: body.access_token, scope: body.scope ?? '' };
}

/** Register + authorize + exchange in one go; returns a Bearer token for `scope`. */
export async function mintToken(
  page: Page,
  request: APIRequestContext,
  discovery: Discovery,
  opts: { clientId: string; scope: string },
): Promise<string> {
  const pkce = newPkce();
  const code = await authorizeInBrowser(page, discovery, { ...opts, pkce });
  const { accessToken } = await exchangeCode(request, discovery, {
    clientId: opts.clientId,
    code,
    pkce,
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
  return rpc.result!.structuredContent as T;
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
  return JSON.parse(text!) as T;
}
