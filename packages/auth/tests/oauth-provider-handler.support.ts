import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import type { OAuthOptions } from '@better-auth/oauth-provider';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import type { BetterAuthOptions, BetterAuthPlugin } from '@better-auth/core';
import { betterAuth } from 'better-auth';
import { jwt } from 'better-auth/plugins';
import { beforeAll, expect } from 'vitest';

import {
  createDocketAuthDatabase,
  createDocketOAuthProvider,
} from '../src/oauth-resource-provider';

beforeAll(async () => {
  const { db } = await import('@docket/db');
  await migrate(db as never, {
    migrationsFolder: resolve(import.meta.dirname, '../../db/drizzle'),
  });
});

export async function authRequest(path: string, init?: RequestInit): Promise<Response> {
  const { auth } = await import('../src/index');
  return auth.handler(new Request(`http://localhost:4000/api/auth${path}`, init));
}

export async function seedTrustedRefresh(
  expiresAt: Date | null = new Date(Date.now() + 3_600_000),
) {
  const { db, oauthClient, oauthRefreshToken, oauthResourceGrant, session, user } =
    await import('@docket/db');
  const suffix = randomUUID();
  const clientId = `provider-client-${suffix}`;
  const refreshToken = `provider-refresh-${suffix}`;
  const [owner] = await db
    .insert(user)
    .values({ name: 'Provider owner', email: `provider-${suffix}@example.test` })
    .returning({ id: user.id });
  if (!owner) throw new Error('Failed to create the provider test user.');
  const [activeSession] = await db
    .insert(session)
    .values({
      token: `provider-session-${suffix}`,
      userId: owner.id,
      expiresAt: new Date(Date.now() + 3_600_000),
    })
    .returning({ id: session.id });
  if (!activeSession) throw new Error('Failed to create the provider test session.');
  await db.insert(oauthClient).values({
    clientId,
    redirectUris: ['http://127.0.0.1/callback'],
    public: true,
    type: 'public',
    requirePKCE: true,
    tokenEndpointAuthMethod: 'none',
    grantTypes: ['authorization_code', 'refresh_token'],
    responseTypes: ['code'],
    scopes: ['work:read', 'offline_access'],
    skipConsent: true,
  });
  const grantId = `provider-grant-${suffix}`;
  await db.insert(oauthResourceGrant).values({
    id: grantId,
    clientId,
    userId: owner.id,
    consentId: null,
    authorizationKind: 'trusted_mcp',
    resourceUri: 'http://localhost:4000/mcp',
    expiresAt: new Date(Date.now() + 3_660_000),
  });
  await db.insert(oauthRefreshToken).values({
    token: createHash('sha256').update(refreshToken).digest('base64url'),
    clientId,
    userId: owner.id,
    sessionId: activeSession.id,
    scopes: ['work:read', 'offline_access'],
    expiresAt,
    docketGrantId: grantId,
  });
  return { clientId, grantId, refreshToken, userId: owner.id };
}

export function formRequest(path: string, values: Record<string, string>): Promise<Response> {
  return authRequest(path, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(values),
  });
}

export function deferred<T = void>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

export async function signInWithRecoveryCode(): Promise<{ cookie: string; userId: string }> {
  const { auth, generateRecoveryCodes } = await import('../src/index');
  const { db, user } = await import('@docket/db');
  const suffix = randomUUID();
  const email = `authorize-${suffix}@example.test`;
  const [created] = await db
    .insert(user)
    .values({ name: 'Authorize owner', email })
    .returning({ id: user.id });
  if (!created) throw new Error('Failed to create the authorize test user.');
  const codes = await generateRecoveryCodes(created.id);
  const post = (path: string, body: unknown, cookie?: string) =>
    auth.handler(
      new Request(`http://localhost:4000/api/auth${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost:4000',
          ...(cookie ? { cookie } : {}),
        },
        body: JSON.stringify(body),
      }),
    );
  const armed = await post('/two-factor/recovery-challenge', { email });
  const challengeCookie = armed.headers
    .getSetCookie()
    .map((entry) => entry.split(';')[0])
    .join('; ');
  const verified = await post(
    '/two-factor/verify-backup-code',
    { code: codes[0] },
    challengeCookie,
  );
  const cookie = verified.headers
    .getSetCookie()
    .map((entry) => entry.split(';')[0])
    .join('; ');
  if (!cookie) throw new Error('Recovery-code sign-in did not issue a session cookie.');
  return { cookie, userId: created.id };
}

export async function registerConfidentialClient(cookie: string): Promise<{
  clientId: string;
  clientSecret: string;
}> {
  const response = await authRequest('/oauth2/register', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie,
      origin: 'http://localhost:4000',
    },
    body: JSON.stringify({
      client_name: 'Docket introspection acceptance client',
      redirect_uris: ['http://127.0.0.1/callback'],
      token_endpoint_auth_method: 'client_secret_post',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      type: 'web',
      scope: 'work:read offline_access',
    }),
  });
  const text = await response.text();
  expect(response.status, text).toBe(200);
  const parsed = JSON.parse(text) as { client_id?: unknown; client_secret?: unknown };
  expect(parsed.client_id).toEqual(expect.any(String));
  expect(parsed.client_secret).toEqual(expect.any(String));
  return {
    clientId: parsed.client_id as string,
    clientSecret: parsed.client_secret as string,
  };
}

export async function seedConsentRefresh(input: {
  clientId: string;
  userId: string;
  resourceUri: string | null;
  legacyBefore?: Date | null;
}): Promise<{ consentId: string; grantId: string; refreshToken: string }> {
  const { db, oauthConsent, oauthRefreshToken, oauthResourceGrant, session } =
    await import('@docket/db');
  const suffix = randomUUID();
  const refreshToken = `confidential-refresh-${suffix}`;
  const [activeSession] = await db
    .select({ id: session.id })
    .from(session)
    .where(eq(session.userId, input.userId))
    .limit(1);
  if (!activeSession) throw new Error('Failed to find the confidential client test session.');
  const consentId = `confidential-consent-${suffix}`;
  await db.insert(oauthConsent).values({
    id: consentId,
    clientId: input.clientId,
    userId: input.userId,
    scopes: ['work:read', 'offline_access'],
  });
  const grantId = `confidential-grant-${suffix}`;
  await db.insert(oauthResourceGrant).values({
    id: grantId,
    clientId: input.clientId,
    userId: input.userId,
    consentId,
    authorizationKind: 'consent',
    resourceUri: input.resourceUri,
    expiresAt: new Date(Date.now() + 3_660_000),
    legacyBefore: input.legacyBefore ?? null,
  });
  await db.insert(oauthRefreshToken).values({
    token: createHash('sha256').update(refreshToken).digest('base64url'),
    clientId: input.clientId,
    userId: input.userId,
    sessionId: activeSession.id,
    scopes: ['work:read', 'offline_access'],
    expiresAt: new Date(Date.now() + 3_600_000),
    docketGrantId: grantId,
  });
  return { consentId, grantId, refreshToken };
}

export async function issueTrustedAuthorizationCode(cookie: string): Promise<{
  clientId: string;
  code: string;
  verifier: string;
}> {
  const { db, oauthClient } = await import('@docket/db');
  const clientId = `authorization-code-${randomUUID()}`;
  await db.insert(oauthClient).values({
    clientId,
    redirectUris: ['http://127.0.0.1/callback'],
    public: true,
    type: 'public',
    requirePKCE: true,
    tokenEndpointAuthMethod: 'none',
    grantTypes: ['authorization_code', 'refresh_token'],
    responseTypes: ['code'],
    scopes: ['work:read', 'offline_access'],
    skipConsent: true,
  });
  const verifier = 'docket-provider-navigation-verifier-000000000000000000000000';
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: 'http://127.0.0.1/callback',
    scope: 'work:read offline_access',
    resource: 'http://localhost:4000/mcp',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'navigation-state',
  });
  const authorized = await authRequest(`/oauth2/authorize?${query.toString()}`, {
    headers: { accept: 'text/html', cookie },
  });
  expect(authorized.status).toBe(302);
  const code = new URL(authorized.headers.get('location') ?? '').searchParams.get('code');
  expect(code).toEqual(expect.any(String));
  return { clientId, code: code ?? '', verifier };
}

export async function seedStoredAuthorizationCode(label: string): Promise<{
  readonly clientId: string;
  readonly code: string;
  readonly verifier: string;
  readonly identifier: string;
  readonly suffix: string;
}> {
  const { db, oauthClient, session, user, verification } = await import('@docket/db');
  const suffix = randomUUID();
  const clientId = `${label}-client-${suffix}`;
  const code = `${label}-code-${suffix}`;
  const verifier = `${label}-verifier-000000000000000000000000000000`;
  const identifier = createHash('sha256').update(code).digest('base64url');
  const codeChallenge = createHash('sha256').update(verifier).digest('base64url');
  const [owner] = await db
    .insert(user)
    .values({ name: 'OAuth code owner', email: `${label}-${suffix}@example.test` })
    .returning({ id: user.id });
  if (!owner) throw new Error('Failed to create the authorization-code owner.');
  const [activeSession] = await db
    .insert(session)
    .values({
      token: `${label}-session-${suffix}`,
      userId: owner.id,
      expiresAt: new Date(Date.now() + 3_600_000),
    })
    .returning({ id: session.id });
  if (!activeSession) throw new Error('Failed to create the authorization-code session.');
  await db.insert(oauthClient).values({
    clientId,
    redirectUris: ['http://127.0.0.1/callback'],
    public: true,
    type: 'public',
    requirePKCE: true,
    tokenEndpointAuthMethod: 'none',
    grantTypes: ['authorization_code', 'refresh_token'],
    responseTypes: ['code'],
    scopes: ['work:read', 'offline_access'],
    skipConsent: true,
  });
  await db.insert(verification).values({
    identifier,
    expiresAt: new Date(Date.now() + 60_000),
    value: JSON.stringify({
      type: 'authorization_code',
      query: {
        response_type: 'code',
        client_id: clientId,
        redirect_uri: 'http://127.0.0.1/callback',
        scope: 'work:read offline_access',
        resource: 'http://localhost:4000/mcp',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      },
      userId: owner.id,
      sessionId: activeSession.id,
    }),
  });
  return { clientId, code, verifier, identifier, suffix };
}

export function isolatedProviderAuth(
  callbacks: {
    readonly generateRefreshToken: () => Promise<string>;
    readonly customAccessTokenClaims: () =>
      Promise<Record<string, unknown>> | Record<string, unknown>;
  },
  instrumentation: {
    readonly plugins?: readonly BetterAuthPlugin[];
    readonly providerOptions?: Partial<OAuthOptions<string[]>>;
    readonly rateLimit?: BetterAuthOptions['rateLimit'];
  } = {},
) {
  return betterAuth({
    baseURL: 'http://localhost:4000',
    secret: 'test-secret-at-least-32-characters-long',
    database: createDocketAuthDatabase(),
    ...(instrumentation.rateLimit ? { rateLimit: instrumentation.rateLimit } : {}),
    plugins: [
      ...(instrumentation.plugins ?? []),
      jwt({ jwt: { issuer: 'http://localhost:4000/api/auth' } }),
      createDocketOAuthProvider(
        {
          loginPage: 'http://localhost:3000/sign-in',
          consentPage: 'http://localhost:3000/oauth/authorize',
          scopes: ['work:read', 'offline_access'],
          grantTypes: ['authorization_code', 'refresh_token'],
          ...instrumentation.providerOptions,
          ...callbacks,
        },
        {
          issuer: 'http://localhost:4000/api/auth',
          mcpResource: 'http://localhost:4000/mcp',
          restResource: 'http://localhost:4000/v1',
        },
      ),
    ],
  });
}

export function exchangeStoredCode(
  handler: (request: Request) => Promise<Response>,
  fixture: { readonly clientId: string; readonly code: string; readonly verifier: string },
): Promise<Response> {
  return handler(
    new Request('http://localhost:4000/api/auth/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: fixture.clientId,
        code: fixture.code,
        code_verifier: fixture.verifier,
        redirect_uri: 'http://127.0.0.1/callback',
        resource: 'http://localhost:4000/mcp',
      }),
    }),
  );
}
