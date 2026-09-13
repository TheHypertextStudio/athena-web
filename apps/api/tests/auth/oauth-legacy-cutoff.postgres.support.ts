import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { expect } from 'vitest';

class CookieJar {
  readonly #values = new Map<string, string>();

  absorb(response: Response): void {
    for (const value of response.headers.getSetCookie()) {
      const pair = value.split(';', 1)[0] ?? '';
      const separator = pair.indexOf('=');
      if (separator <= 0) continue;
      const name = pair.slice(0, separator);
      const cookieValue = pair.slice(separator + 1);
      if (cookieValue) this.#values.set(name, cookieValue);
      else this.#values.delete(name);
    }
  }

  header(): string {
    return [...this.#values].map(([name, value]) => `${name}=${value}`).join('; ');
  }
}

interface RegisteredClient {
  readonly clientId: string;
}

/** Access and refresh credentials returned by a successful real provider exchange. */
export interface IssuedTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
}

async function request(
  origin: string,
  path: string,
  init: RequestInit = {},
  cookies?: CookieJar,
): Promise<Response> {
  const headers = new Headers(init.headers);
  const cookie = cookies?.header();
  if (cookie) headers.set('cookie', cookie);
  const response = await fetch(`${origin}${path}`, { ...init, headers, redirect: 'manual' });
  cookies?.absorb(response);
  return response;
}

async function jsonRequest(
  origin: string,
  path: string,
  body: unknown,
  cookies?: CookieJar,
): Promise<Response> {
  return request(
    origin,
    path,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify(body),
    },
    cookies,
  );
}

/** Compose the real Better Auth handler after migration without importing the API entrypoint. */
export async function composeOAuthHandler(): Promise<
  (request: IncomingMessage, response: ServerResponse) => void
> {
  const [{ getRequestListener }, { Hono }, { auth }] = await Promise.all([
    import('@hono/node-server'),
    import('hono'),
    import('@docket/auth'),
  ]);
  const root = new Hono();
  root.on(['POST', 'GET'], '/api/auth/*', (context) => auth.handler(context.req.raw));
  const listener = getRequestListener(root.fetch);
  return (incoming, outgoing) => {
    void listener(incoming, outgoing);
  };
}

async function signInFreshUser(
  origin: string,
): Promise<{ readonly cookies: CookieJar; readonly userId: string }> {
  const { db, user } = await import('@docket/db');
  const { generateRecoveryCodes } = await import('@docket/auth');
  const suffix = randomUUID();
  const email = `post-migration-oauth-${suffix}@example.test`;
  const [created] = await db
    .insert(user)
    .values({ name: 'Post-migration OAuth owner', email })
    .returning({ id: user.id });
  if (!created) throw new Error('The post-migration OAuth user was not created.');
  const codes = await generateRecoveryCodes(created.id);
  const code = codes[0];
  if (!code) throw new Error('The post-migration recovery code was not generated.');
  const cookies = new CookieJar();
  const challenge = await jsonRequest(
    origin,
    '/api/auth/two-factor/recovery-challenge',
    { email },
    cookies,
  );
  expect(challenge.status, await challenge.clone().text()).toBe(200);
  const verified = await jsonRequest(
    origin,
    '/api/auth/two-factor/verify-backup-code',
    { code },
    cookies,
  );
  expect(verified.status, await verified.clone().text()).toBe(200);
  expect(cookies.header()).toContain('better-auth.session_token=');
  return { cookies, userId: created.id };
}

async function registerFreshClient(origin: string): Promise<RegisteredClient> {
  const response = await jsonRequest(origin, '/api/auth/oauth2/register', {
    client_name: 'Post-migration OAuth client',
    redirect_uris: ['http://127.0.0.1/callback'],
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    type: 'native',
  });
  const text = await response.text();
  expect(response.status, text).toBe(200);
  const body = JSON.parse(text) as { client_id?: unknown; client_secret?: unknown };
  expect(body.client_id).toEqual(expect.any(String));
  expect(body.client_secret).toBeUndefined();
  return { clientId: body.client_id as string };
}

async function authorizationCode(
  origin: string,
  client: RegisteredClient,
  cookies: CookieJar,
): Promise<{ readonly code: string; readonly verifier: string }> {
  const verifier = 'post-migration-s256-verifier-000000000000000000000000000000';
  const state = `post-migration-${randomUUID()}`;
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: client.clientId,
    redirect_uri: 'http://127.0.0.1/callback',
    scope: 'work:read offline_access',
    resource: `${origin}/v1`,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    state,
  });
  const authorize = await request(
    origin,
    `/api/auth/oauth2/authorize?${query.toString()}`,
    { headers: { accept: 'text/html' } },
    cookies,
  );
  const authorizeBody = JSON.parse(await authorize.text()) as { url?: unknown };
  expect(authorize.status).toBe(200);
  expect(authorizeBody.url).toEqual(expect.any(String));
  const consentPage = new URL(authorizeBody.url as string, origin);
  expect(consentPage.pathname).toBe('/oauth/authorize');
  const consent = await jsonRequest(
    origin,
    '/api/auth/oauth2/consent',
    { accept: true, oauth_query: consentPage.search.slice(1) },
    cookies,
  );
  const consentText = await consent.text();
  expect(consent.status, consentText).toBe(200);
  const consentBody = JSON.parse(consentText) as { url?: unknown };
  expect(consentBody.url).toEqual(expect.any(String));
  const callback = new URL(consentBody.url as string);
  expect(callback.searchParams.get('state')).toBe(state);
  const code = callback.searchParams.get('code');
  expect(code).toEqual(expect.any(String));
  return { code: code ?? '', verifier };
}

async function exchangeCode(
  origin: string,
  client: RegisteredClient,
  ceremony: { readonly code: string; readonly verifier: string },
): Promise<IssuedTokens> {
  const response = await request(origin, '/api/auth/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: client.clientId,
      code: ceremony.code,
      code_verifier: ceremony.verifier,
      redirect_uri: 'http://127.0.0.1/callback',
      resource: `${origin}/v1`,
    }),
  });
  return issuedTokens(response);
}

async function issuedTokens(response: Response): Promise<IssuedTokens> {
  const text = await response.text();
  expect(response.status, text).toBe(200);
  const body = JSON.parse(text) as { access_token?: unknown; refresh_token?: unknown };
  expect(body.access_token).toEqual(expect.any(String));
  expect(body.refresh_token).toEqual(expect.any(String));
  return { accessToken: body.access_token as string, refreshToken: body.refresh_token as string };
}

/** Redeem one refresh credential that existed before the resource-grant migration. */
export async function renewLegacyRefresh(
  origin: string,
  clientId: string,
  refreshToken: string,
): Promise<IssuedTokens> {
  const response = await request(origin, '/api/auth/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: refreshToken,
      resource: `${origin}/mcp`,
    }),
  });
  return issuedTokens(response);
}

/** Complete a fresh DCR, human-consent, S256, and token ceremony after migration. */
export async function runFreshIssuance(origin: string): Promise<{
  readonly clientId: string;
  readonly tokens: IssuedTokens;
  readonly userId: string;
}> {
  const identity = await signInFreshUser(origin);
  const client = await registerFreshClient(origin);
  const ceremony = await authorizationCode(origin, client, identity.cookies);
  return {
    clientId: client.clientId,
    tokens: await exchangeCode(origin, client, ceremony),
    userId: identity.userId,
  };
}
