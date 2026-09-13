import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  authRequest,
  formRequest,
  registerConfidentialClient,
  seedConsentRefresh,
  signInWithRecoveryCode,
} from './oauth-provider-handler.support';

describe('Docket OAuth provider handler preservation', () => {
  it('preserves the installed provider validation when authorize omits client_id', async () => {
    const response = await authRequest(
      '/oauth2/authorize?response_type=code&redirect_uri=http%3A%2F%2F127.0.0.1%2Fcallback',
      { headers: { accept: 'application/json' } },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      message: '[query.client_id] Invalid input: expected string, received undefined',
      code: 'VALIDATION_ERROR',
    });
  });

  it('preserves unsupported_grant_type for a grant disabled by Docket', async () => {
    const response = await authRequest('/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: 'unused',
        client_secret: 'unused',
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'unsupported_grant_type' });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('pragma')).toBe('no-cache');
  });

  it('advertises only authorization-code and refresh grants', async () => {
    const response = await authRequest('/.well-known/oauth-authorization-server');

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      grant_types_supported: ['authorization_code', 'refresh_token'],
    });
  });

  it('marks introspection authentication failures as non-cacheable', async () => {
    const response = await authRequest('/oauth2/introspect', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: 'unknown' }),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: 'invalid_client' });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('pragma')).toBe('no-cache');
  });

  it('preserves client-authentication precedence when revocation receives an empty token', async () => {
    const response = await authRequest('/oauth2/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: '' }),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: 'invalid_client' });
  });

  it('authenticates confidential clients before inspecting empty or malformed revoke tokens', async () => {
    const { db, oauthJwtRevocation, oauthResourceGrant } = await import('@docket/db');
    const signedIn = await signInWithRecoveryCode();
    const client = await registerConfidentialClient(signedIn.cookie);
    const credential = await seedConsentRefresh({
      clientId: client.clientId,
      userId: signedIn.userId,
      resourceUri: 'http://localhost:4000/mcp',
    });
    const cases = [
      {
        name: 'form missing secret',
        headers: {},
        fields: { client_id: client.clientId },
        status: 400,
      },
      {
        name: 'form wrong secret',
        headers: {},
        fields: { client_id: client.clientId, client_secret: 'wrong-secret' },
        status: 401,
      },
      {
        name: 'Basic missing secret',
        headers: {
          authorization: `Basic ${Buffer.from(`${client.clientId}:`).toString('base64')}`,
        },
        fields: {},
        status: 400,
      },
      {
        name: 'Basic wrong secret',
        headers: {
          authorization: `Basic ${Buffer.from(`${client.clientId}:wrong-secret`).toString('base64')}`,
        },
        fields: {},
        status: 401,
      },
    ] as const;

    for (const clientCase of cases) {
      for (const token of ['', 'malformed-token']) {
        const response = await authRequest('/oauth2/revoke', {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            ...clientCase.headers,
          },
          body: new URLSearchParams({ ...clientCase.fields, token }),
        });
        expect(
          response.status,
          `${clientCase.name} with ${token ? 'malformed' : 'empty'} token: ${await response
            .clone()
            .text()}`,
        ).toBe(clientCase.status);
        expect(await response.json()).toMatchObject({ error: 'invalid_client' });
      }
    }

    const [grant] = await db
      .select({ revokedAt: oauthResourceGrant.revokedAt })
      .from(oauthResourceGrant)
      .where(eq(oauthResourceGrant.id, credential.grantId));
    expect(grant?.revokedAt).toBeNull();
    await expect(db.select().from(oauthJwtRevocation)).resolves.toHaveLength(0);
  });

  it.each([
    ['revoke', '/oauth2/revoke', 'Basic YQ=='],
    ['revoke', '/oauth2/revoke', 'Basic YTo='],
    ['introspection', '/oauth2/introspect', 'Basic YQ=='],
    ['introspection', '/oauth2/introspect', 'Basic YTo='],
  ])(
    'preserves malformed Basic client authentication on %s',
    async (_name, path, authorization) => {
      const response = await authRequest(path, {
        method: 'POST',
        headers: {
          authorization,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ token: 'unknown' }),
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: 'invalid_client' });
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('pragma')).toBe('no-cache');
    },
  );

  it.each([
    ['client_id', 'client-a'],
    ['client_id', 'client-b'],
    ['client_secret', 'secret-a'],
    ['client_secret', 'secret-b'],
    ['token', 'first'],
    ['token', 'second'],
    ['token_type_hint', 'access_token'],
    ['token_type_hint', 'refresh_token'],
  ])(
    'rejects a repeated introspection %s before authenticating a client',
    async (field, repeated) => {
      const body = new URLSearchParams({
        client_id: 'client-a',
        client_secret: 'secret-a',
        token: 'first',
        token_type_hint: 'access_token',
      });
      body.append(field, repeated);

      const response = await authRequest('/oauth2/introspect', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: 'invalid_request' });
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('pragma')).toBe('no-cache');
    },
  );

  it('preserves the provider token-type hint during introspection', async () => {
    const signedIn = await signInWithRecoveryCode();
    const client = await registerConfidentialClient(signedIn.cookie);
    const credential = await seedConsentRefresh({
      clientId: client.clientId,
      userId: signedIn.userId,
      resourceUri: 'http://localhost:4000/mcp',
    });

    const response = await formRequest('/oauth2/introspect', {
      client_id: client.clientId,
      client_secret: client.clientSecret,
      token: credential.refreshToken,
      token_type_hint: 'access_token',
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_request' });
  });

  it('preserves the provider error for an empty introspection token', async () => {
    const signedIn = await signInWithRecoveryCode();
    const client = await registerConfidentialClient(signedIn.cookie);

    const response = await formRequest('/oauth2/introspect', {
      client_id: client.clientId,
      client_secret: client.clientSecret,
      token: '',
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_request' });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('pragma')).toBe('no-cache');
  });

  it('applies live consent and offline-access checks to confidential refresh introspection', async () => {
    const { db, oauthClient, oauthConsent, oauthRefreshToken, oauthResourceGrant } =
      await import('@docket/db');
    const signedIn = await signInWithRecoveryCode();
    const client = await registerConfidentialClient(signedIn.cookie);
    const credential = await seedConsentRefresh({
      clientId: client.clientId,
      userId: signedIn.userId,
      resourceUri: 'http://localhost:4000/mcp',
    });

    const active = await formRequest('/oauth2/introspect', {
      client_id: client.clientId,
      client_secret: client.clientSecret,
      token: credential.refreshToken,
      token_type_hint: 'refresh_token',
    });
    expect(active.status, await active.clone().text()).toBe(200);
    expect(await active.json()).toMatchObject({
      active: true,
      client_id: client.clientId,
      scope: 'work:read offline_access',
    });

    const refreshDigest = createHash('sha256').update(credential.refreshToken).digest('base64url');
    await db
      .update(oauthRefreshToken)
      .set({ revoked: new Date() })
      .where(eq(oauthRefreshToken.token, refreshDigest));
    const revokedRefresh = await formRequest('/oauth2/introspect', {
      client_id: client.clientId,
      client_secret: client.clientSecret,
      token: credential.refreshToken,
      token_type_hint: 'refresh_token',
    });
    expect(revokedRefresh.status, await revokedRefresh.clone().text()).toBe(200);
    expect(await revokedRefresh.json()).toEqual({ active: false });
    await db
      .update(oauthRefreshToken)
      .set({ revoked: null })
      .where(eq(oauthRefreshToken.token, refreshDigest));

    await db
      .update(oauthConsent)
      .set({ scopes: ['work:read'] })
      .where(eq(oauthConsent.id, credential.consentId));

    const narrowed = await formRequest('/oauth2/introspect', {
      client_id: client.clientId,
      client_secret: client.clientSecret,
      token: credential.refreshToken,
      token_type_hint: 'refresh_token',
    });
    expect(narrowed.status, await narrowed.clone().text()).toBe(200);
    expect(await narrowed.json()).toEqual({ active: false });
    expect(narrowed.headers.get('cache-control')).toBe('no-store');
    expect(narrowed.headers.get('pragma')).toBe('no-cache');

    await db
      .update(oauthConsent)
      .set({ scopes: ['work:read', 'offline_access'] })
      .where(eq(oauthConsent.id, credential.consentId));
    await db
      .update(oauthClient)
      .set({ disabled: true })
      .where(eq(oauthClient.clientId, client.clientId));
    const disabled = await formRequest('/oauth2/introspect', {
      client_id: client.clientId,
      client_secret: client.clientSecret,
      token: credential.refreshToken,
      token_type_hint: 'refresh_token',
    });
    expect(disabled.status).toBe(400);
    expect(await disabled.json()).toMatchObject({ error: 'invalid_client' });

    await db
      .update(oauthClient)
      .set({ disabled: false })
      .where(eq(oauthClient.clientId, client.clientId));
    await db
      .update(oauthResourceGrant)
      .set({ createdAt: new Date(0), expiresAt: new Date(1_000) })
      .where(eq(oauthResourceGrant.id, credential.grantId));
    const expired = await formRequest('/oauth2/introspect', {
      client_id: client.clientId,
      client_secret: client.clientSecret,
      token: credential.refreshToken,
      token_type_hint: 'refresh_token',
    });
    expect(await expired.json()).toEqual({ active: false });

    await db
      .update(oauthResourceGrant)
      .set({ expiresAt: new Date(Date.now() + 3_600_000), revokedAt: new Date() })
      .where(eq(oauthResourceGrant.id, credential.grantId));
    const revoked = await formRequest('/oauth2/introspect', {
      client_id: client.clientId,
      client_secret: client.clientSecret,
      token: credential.refreshToken,
      token_type_hint: 'refresh_token',
    });
    expect(await revoked.json()).toEqual({ active: false });
  });

  it('resolves a migrated null-resource refresh only to the MCP resource', async () => {
    const signedIn = await signInWithRecoveryCode();
    const client = await registerConfidentialClient(signedIn.cookie);
    const credential = await seedConsentRefresh({
      clientId: client.clientId,
      userId: signedIn.userId,
      resourceUri: null,
      legacyBefore: new Date(Date.now() - 60_000),
    });

    const response = await formRequest('/oauth2/introspect', {
      client_id: client.clientId,
      client_secret: client.clientSecret,
      token: credential.refreshToken,
      token_type_hint: 'refresh_token',
    });

    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toMatchObject({
      active: true,
      client_id: client.clientId,
    });
  });

  it('reports reference-scoped refresh state inactive', async () => {
    const { db, oauthRefreshToken } = await import('@docket/db');
    const signedIn = await signInWithRecoveryCode();
    const client = await registerConfidentialClient(signedIn.cookie);
    const credential = await seedConsentRefresh({
      clientId: client.clientId,
      userId: signedIn.userId,
      resourceUri: 'http://localhost:4000/mcp',
    });
    const digest = createHash('sha256').update(credential.refreshToken).digest('base64url');
    await db
      .update(oauthRefreshToken)
      .set({ referenceId: 'workspace_1' })
      .where(eq(oauthRefreshToken.token, digest));

    const response = await formRequest('/oauth2/introspect', {
      client_id: client.clientId,
      client_secret: client.clientSecret,
      token: credential.refreshToken,
      token_type_hint: 'refresh_token',
    });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toEqual({ active: false });
  });

  it('materializes one trusted legacy grant and preserves its revocation tombstone', async () => {
    const { db, jwks, oauthClient, oauthResourceGrant } = await import('@docket/db');
    const owner = await signInWithRecoveryCode();
    const client = await registerConfidentialClient(owner.cookie);
    const cutoff = new Date();
    await db
      .update(oauthClient)
      .set({
        docketLegacyBefore: cutoff,
        docketLegacyTrusted: true,
        skipConsent: true,
      })
      .where(eq(oauthClient.clientId, client.clientId));
    const keyId = `legacy-introspection-key-${randomUUID()}`;
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    await db.insert(jwks).values({
      id: keyId,
      publicKey: JSON.stringify(publicKey.export({ format: 'jwk' })),
      privateKey: JSON.stringify(privateKey.export({ format: 'jwk' })),
      createdAt: new Date(),
    });
    const nowSeconds = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'EdDSA', kid: keyId })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        iss: 'http://localhost:4000/api/auth',
        aud: 'http://localhost:4000/mcp',
        azp: client.clientId,
        sub: owner.userId,
        iat: nowSeconds - 30,
        exp: nowSeconds + 10 * 60,
        scope: 'work:read offline_access',
        jti: randomUUID(),
      }),
    ).toString('base64url');
    const signingInput = `${header}.${payload}`;
    const token = `${signingInput}.${sign(null, Buffer.from(signingInput), privateKey).toString(
      'base64url',
    )}`;
    const introspect = () =>
      formRequest('/oauth2/introspect', {
        client_id: client.clientId,
        client_secret: client.clientSecret,
        token,
        token_type_hint: 'access_token',
      });

    const responses = [await introspect(), await introspect()];
    for (const response of responses) {
      expect(response.status, await response.clone().text()).toBe(200);
      expect(await response.json()).toMatchObject({
        active: true,
        aud: 'http://localhost:4000/mcp',
        client_id: client.clientId,
        scope: 'work:read offline_access',
        sub: owner.userId,
      });
    }
    const [grant] = await db
      .select({ id: oauthResourceGrant.id, revokedAt: oauthResourceGrant.revokedAt })
      .from(oauthResourceGrant)
      .where(eq(oauthResourceGrant.clientId, client.clientId));
    expect(grant).toMatchObject({ id: expect.any(String), revokedAt: null });
    expect(
      await db
        .select({ id: oauthResourceGrant.id })
        .from(oauthResourceGrant)
        .where(eq(oauthResourceGrant.clientId, client.clientId)),
    ).toHaveLength(1);

    await db
      .update(oauthResourceGrant)
      .set({ revokedAt: new Date() })
      .where(eq(oauthResourceGrant.id, grant?.id ?? ''));
    const revoked = await introspect();
    expect(revoked.status, await revoked.clone().text()).toBe(200);
    expect(await revoked.json()).toEqual({ active: false });
    expect(
      await db
        .select({ id: oauthResourceGrant.id, revokedAt: oauthResourceGrant.revokedAt })
        .from(oauthResourceGrant)
        .where(eq(oauthResourceGrant.clientId, client.clientId)),
    ).toEqual([{ id: grant?.id, revokedAt: expect.any(Date) }]);
  });
});
