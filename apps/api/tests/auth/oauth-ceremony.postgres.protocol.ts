import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';

import { expect } from 'vitest';

import {
  isConfidentialClient,
  jsonRequest,
  origin,
  redirectTarget,
  request,
  sessionCookies,
  type AccessClaims,
  type ConfidentialRegisteredClient,
  type IssuedTokens,
  type RegisteredClient,
} from './oauth-ceremony.postgres.runtime';

export async function authorizationCode(
  client: RegisteredClient,
  resource: string,
  state: string,
  expectConsent: boolean,
  cookies = sessionCookies,
): Promise<{ readonly code: string; readonly verifier: string }> {
  const verifier = `postgres-oauth-verifier-${state}-000000000000000000000000000000`;
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: client.clientId,
    redirect_uri: 'http://127.0.0.1/callback',
    scope: 'work:read offline_access',
    resource,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  });
  const authorize = await request(
    `/api/auth/oauth2/authorize?${query.toString()}`,
    { headers: { accept: 'text/html' } },
    cookies,
  );
  const location = await redirectTarget(authorize);
  let callback = location;
  if (location.pathname === '/oauth/authorize') {
    expect(expectConsent).toBe(true);
    const consent = await jsonRequest(
      '/api/auth/oauth2/consent',
      { accept: true, oauth_query: location.search.slice(1) },
      cookies,
    );
    const text = await consent.text();
    expect(consent.status, text).toBe(200);
    const consentBody = JSON.parse(text) as { url?: unknown };
    expect(consentBody.url).toEqual(expect.any(String));
    callback = new URL(consentBody.url as string);
  } else {
    expect(expectConsent).toBe(false);
  }
  expect(callback.origin).toBe('http://127.0.0.1');
  expect(callback.pathname).toBe('/callback');
  expect(callback.searchParams.get('state')).toBe(state);
  const code = callback.searchParams.get('code');
  expect(code).toEqual(expect.any(String));
  return { code: code ?? '', verifier };
}

export async function exchangeCode(
  client: RegisteredClient,
  ceremony: { readonly code: string; readonly verifier: string },
  resource: string,
): Promise<IssuedTokens> {
  const response = await exchangeCodeResponse(client, ceremony, resource);
  const text = await response.text();
  expect(response.status, text).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const body = JSON.parse(text) as {
    access_token?: unknown;
    refresh_token?: unknown;
    scope?: unknown;
  };
  expect(body.access_token).toEqual(expect.any(String));
  expect(body.refresh_token).toEqual(expect.any(String));
  return {
    accessToken: body.access_token as string,
    refreshToken: body.refresh_token as string,
    scope: body.scope as string,
  };
}

export async function exchangeCodeResponse(
  client: RegisteredClient,
  ceremony: { readonly code: string; readonly verifier: string },
  resource: string,
): Promise<Response> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: client.clientId,
    code: ceremony.code,
    code_verifier: ceremony.verifier,
    redirect_uri: 'http://127.0.0.1/callback',
    resource,
  });
  if (isConfidentialClient(client)) body.set('client_secret', client.clientSecret);
  return request('/api/auth/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
}

export function decodeAccessClaims(token: string): AccessClaims {
  const payload = token.split('.')[1];
  if (!payload) throw new Error('The provider returned a malformed access token.');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as AccessClaims;
}

export async function refreshTokens(
  client: RegisteredClient,
  refreshToken: string,
  resource: string,
  scope?: string,
): Promise<{ readonly response: Response; readonly tokens?: IssuedTokens }> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: client.clientId,
    refresh_token: refreshToken,
    resource,
  });
  if (isConfidentialClient(client)) body.set('client_secret', client.clientSecret);
  if (scope !== undefined) body.set('scope', scope);
  const response = await request('/api/auth/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!response.ok) return { response };
  const parsed = (await response.clone().json()) as {
    access_token: string;
    refresh_token: string;
    scope: string;
  };
  return {
    response,
    tokens: {
      accessToken: parsed.access_token,
      refreshToken: parsed.refresh_token,
      scope: parsed.scope,
    },
  };
}

export async function revokeToken(
  client: RegisteredClient,
  token: string,
  tokenTypeHint: 'access_token' | 'refresh_token',
): Promise<Response> {
  const body = new URLSearchParams({
    client_id: client.clientId,
    token,
    token_type_hint: tokenTypeHint,
  });
  if (isConfidentialClient(client)) body.set('client_secret', client.clientSecret);
  return request('/api/auth/oauth2/revoke', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
}

export async function introspectToken(
  client: ConfidentialRegisteredClient,
  token: string,
  tokenTypeHint: 'access_token' | 'refresh_token' = 'access_token',
): Promise<Response> {
  return request('/api/auth/oauth2/introspect', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      token,
      token_type_hint: tokenTypeHint,
    }),
  });
}

export async function signClaimlessMcpToken(
  clientId: string,
  subject: string,
  cutoff: Date,
): Promise<string> {
  const { db, jwks } = await import('@docket/db');
  const keyId = `postgres-legacy-${randomUUID()}`;
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  await db.insert(jwks).values({
    id: keyId,
    publicKey: JSON.stringify(publicKey.export({ format: 'jwk' })),
    privateKey: JSON.stringify(privateKey.export({ format: 'jwk' })),
    // Better Auth signs with the newest stored key. Keep this verification-only fixture older
    // than every provider-managed key so its deliberately unencrypted private half is never used.
    createdAt: new Date(0),
  });
  const issuedAt = Math.floor(cutoff.getTime() / 1000) - 1;
  const header = Buffer.from(JSON.stringify({ alg: 'EdDSA', kid: keyId })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      iss: `${origin}/api/auth`,
      aud: `${origin}/mcp`,
      azp: clientId,
      sub: subject,
      iat: issuedAt,
      exp: issuedAt + 14 * 60,
      scope: 'work:read offline_access',
      jti: randomUUID(),
    }),
  ).toString('base64url');
  const input = `${header}.${payload}`;
  return `${input}.${sign(null, Buffer.from(input), privateKey).toString('base64url')}`;
}

export async function initializeMcp(accessToken: string): Promise<Response> {
  return request('/mcp', {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: randomUUID(),
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'postgres-legacy-acceptance', version: '1.0.0' },
      },
    }),
  });
}

export async function readOrganizations(accessToken: string): Promise<Response> {
  return request('/v1/orgs', {
    headers: { accept: 'application/json', authorization: `Bearer ${accessToken}` },
  });
}
