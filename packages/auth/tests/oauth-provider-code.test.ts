import { createHash } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { sweepOAuthLifecycle } from '../src/oauth-lifecycle';

import {
  authRequest,
  exchangeStoredCode,
  formRequest,
  issueTrustedAuthorizationCode,
  registerConfidentialClient,
  seedConsentRefresh,
  seedStoredAuthorizationCode,
  seedTrustedRefresh,
  signInWithRecoveryCode,
} from './oauth-provider-handler.support';

describe('Docket OAuth provider handler preservation', () => {
  it.each([
    ['equal', 'http://localhost:4000/mcp'],
    ['different', 'http://localhost:4000/v1'],
  ])('rejects %s repeated token resources before consuming a code', async (_label, repeated) => {
    const { db, oauthResourceGrant, verification } = await import('@docket/db');
    const fixture = await seedStoredAuthorizationCode(`repeated-code-resource-${_label}`);
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: fixture.clientId,
      code: fixture.code,
      code_verifier: fixture.verifier,
      redirect_uri: 'http://127.0.0.1/callback',
      resource: 'http://localhost:4000/mcp',
    });
    body.append('resource', repeated);

    const response = await authRequest('/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_request' });
    await expect(
      db.select().from(verification).where(eq(verification.identifier, fixture.identifier)),
    ).resolves.toHaveLength(1);
    await expect(
      db.select().from(oauthResourceGrant).where(eq(oauthResourceGrant.clientId, fixture.clientId)),
    ).resolves.toHaveLength(0);
  });

  it.each([
    ['equal', 'http://localhost:4000/mcp'],
    ['different', 'http://localhost:4000/v1'],
  ])(
    'rejects %s repeated token resources before rotating a refresh token',
    async (_label, repeated) => {
      const { db, oauthRefreshToken, oauthResourceGrant } = await import('@docket/db');
      const fixture = await seedTrustedRefresh();
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: fixture.clientId,
        refresh_token: fixture.refreshToken,
        resource: 'http://localhost:4000/mcp',
      });
      body.append('resource', repeated);

      const response = await authRequest('/oauth2/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: 'invalid_request' });
      const [grant] = await db
        .select({ revokedAt: oauthResourceGrant.revokedAt })
        .from(oauthResourceGrant)
        .where(eq(oauthResourceGrant.id, fixture.grantId));
      expect(grant?.revokedAt).toBeNull();
      const [refresh] = await db
        .select({ revoked: oauthRefreshToken.revoked })
        .from(oauthRefreshToken)
        .where(eq(oauthRefreshToken.clientId, fixture.clientId));
      expect(refresh?.revoked).toBeNull();
    },
  );

  it('commits an authorization code before returning a navigation redirect', async () => {
    const { cookie } = await signInWithRecoveryCode();
    const { clientId, code, verifier } = await issueTrustedAuthorizationCode(cookie);

    const exchange = await formRequest('/oauth2/token', {
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      code_verifier: verifier,
      redirect_uri: 'http://127.0.0.1/callback',
      resource: 'http://localhost:4000/mcp',
    });
    expect(exchange.status, await exchange.clone().text()).toBe(200);
  });

  it('preserves the provider status when an authorization code is replayed', async () => {
    const { cookie } = await signInWithRecoveryCode();
    const { clientId, code, verifier } = await issueTrustedAuthorizationCode(cookie);
    const exchange = () =>
      formRequest('/oauth2/token', {
        grant_type: 'authorization_code',
        client_id: clientId,
        code,
        code_verifier: verifier,
        redirect_uri: 'http://127.0.0.1/callback',
        resource: 'http://localhost:4000/mcp',
      });

    const first = await exchange();
    expect(first.status, await first.clone().text()).toBe(200);
    const replay = await exchange();
    expect(replay.status).toBe(401);
    expect(await replay.json()).toMatchObject({ error: 'invalid_grant' });
    expect(replay.headers.get('cache-control')).toBe('no-store');
    expect(replay.headers.get('pragma')).toBe('no-cache');
  });

  it('consumes a code when the provider rejects its disabled client', async () => {
    const { db, oauthClient, verification } = await import('@docket/db');
    const { cookie } = await signInWithRecoveryCode();
    const fixture = await issueTrustedAuthorizationCode(cookie);
    const identifier = createHash('sha256').update(fixture.code).digest('base64url');
    await db
      .update(oauthClient)
      .set({ disabled: true })
      .where(eq(oauthClient.clientId, fixture.clientId));

    const disabled = await formRequest('/oauth2/token', {
      grant_type: 'authorization_code',
      client_id: fixture.clientId,
      code: fixture.code,
      code_verifier: fixture.verifier,
      redirect_uri: 'http://127.0.0.1/callback',
      resource: 'http://localhost:4000/mcp',
    });
    expect(disabled.status).toBe(400);
    expect(await disabled.json()).toMatchObject({ error: 'invalid_client' });
    await expect(
      db.select().from(verification).where(eq(verification.identifier, identifier)),
    ).resolves.toHaveLength(0);

    await db
      .update(oauthClient)
      .set({ disabled: false })
      .where(eq(oauthClient.clientId, fixture.clientId));
    const replay = await formRequest('/oauth2/token', {
      grant_type: 'authorization_code',
      client_id: fixture.clientId,
      code: fixture.code,
      code_verifier: fixture.verifier,
      redirect_uri: 'http://127.0.0.1/callback',
      resource: 'http://localhost:4000/mcp',
    });
    expect(replay.status).toBe(401);
    expect(await replay.json()).toMatchObject({ error: 'invalid_grant' });
  });

  it('preserves malformed-code status and one-use consumption from the provider', async () => {
    const { db, verification } = await import('@docket/db');
    const { cookie } = await signInWithRecoveryCode();
    const fixture = await issueTrustedAuthorizationCode(cookie);
    const identifier = createHash('sha256').update(fixture.code).digest('base64url');
    await db
      .update(verification)
      .set({ value: '{not-json' })
      .where(eq(verification.identifier, identifier));

    const response = await formRequest('/oauth2/token', {
      grant_type: 'authorization_code',
      client_id: fixture.clientId,
      code: fixture.code,
      code_verifier: fixture.verifier,
      redirect_uri: 'http://127.0.0.1/callback',
      resource: 'http://localhost:4000/mcp',
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: 'invalid_grant' });
    await expect(
      db.select().from(verification).where(eq(verification.identifier, identifier)),
    ).resolves.toHaveLength(0);
  });

  it.each([
    ['missing', undefined],
    ['unknown', 'https://wrong.example/v1'],
    ['non-string', ['http://localhost:4000/mcp']],
  ] as const)(
    'rejects a %s stored resource binding before credential creation',
    async (_label, resource) => {
      const { db, oauthAccessToken, oauthRefreshToken, oauthResourceGrant, verification } =
        await import('@docket/db');
      const fixture = await seedStoredAuthorizationCode(`stored-resource-${_label}`);
      const [stored] = await db
        .select({ value: verification.value })
        .from(verification)
        .where(eq(verification.identifier, fixture.identifier));
      if (!stored) throw new Error('Authorization code verification state was not stored.');
      const value = JSON.parse(stored.value) as {
        query: Record<string, unknown>;
      };
      if (resource === undefined) delete value.query['resource'];
      else value.query['resource'] = resource;
      await db
        .update(verification)
        .set({ value: JSON.stringify(value) })
        .where(eq(verification.identifier, fixture.identifier));

      const response = await formRequest('/oauth2/token', {
        grant_type: 'authorization_code',
        client_id: fixture.clientId,
        code: fixture.code,
        code_verifier: fixture.verifier,
        redirect_uri: 'http://127.0.0.1/callback',
        resource: 'http://localhost:4000/mcp',
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: 'invalid_grant' });
      await expect(
        db.select().from(verification).where(eq(verification.identifier, fixture.identifier)),
      ).resolves.toHaveLength(1);
      await expect(
        db
          .select()
          .from(oauthResourceGrant)
          .where(eq(oauthResourceGrant.clientId, fixture.clientId)),
      ).resolves.toHaveLength(0);
      await expect(
        db.select().from(oauthRefreshToken).where(eq(oauthRefreshToken.clientId, fixture.clientId)),
      ).resolves.toHaveLength(0);
      await expect(
        db.select().from(oauthAccessToken).where(eq(oauthAccessToken.clientId, fixture.clientId)),
      ).resolves.toHaveLength(0);
    },
  );

  it('fails closed when more than one verification row names an authorization code', async () => {
    const { db, oauthAccessToken, oauthRefreshToken, oauthResourceGrant, verification } =
      await import('@docket/db');
    const { cookie } = await signInWithRecoveryCode();
    const { clientId, code, verifier } = await issueTrustedAuthorizationCode(cookie);
    const identifier = createHash('sha256').update(code).digest('base64url');
    const [stored] = await db
      .select({ value: verification.value, expiresAt: verification.expiresAt })
      .from(verification)
      .where(eq(verification.identifier, identifier));
    if (!stored) throw new Error('Authorization code verification state was not stored.');
    await db.insert(verification).values({ identifier, ...stored });

    const response = await formRequest('/oauth2/token', {
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      code_verifier: verifier,
      redirect_uri: 'http://127.0.0.1/callback',
      resource: 'http://localhost:4000/mcp',
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_grant' });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('pragma')).toBe('no-cache');
    await expect(
      db.select().from(oauthResourceGrant).where(eq(oauthResourceGrant.clientId, clientId)),
    ).resolves.toHaveLength(0);
    await expect(
      db.select().from(oauthRefreshToken).where(eq(oauthRefreshToken.clientId, clientId)),
    ).resolves.toHaveLength(0);
    await expect(
      db.select().from(oauthAccessToken).where(eq(oauthAccessToken.clientId, clientId)),
    ).resolves.toHaveLength(0);
  });

  it('consumes an authorization code after a failed PKCE check', async () => {
    const { cookie } = await signInWithRecoveryCode();
    const { clientId, code, verifier } = await issueTrustedAuthorizationCode(cookie);
    const wrongVerifier = await formRequest('/oauth2/token', {
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      code_verifier: `${verifier}-wrong`,
      redirect_uri: 'http://127.0.0.1/callback',
      resource: 'http://localhost:4000/mcp',
    });
    expect(wrongVerifier.status).toBe(401);
    expect(await wrongVerifier.json()).toMatchObject({ error: 'invalid_request' });
    expect(wrongVerifier.headers.get('cache-control')).toBe('no-store');
    expect(wrongVerifier.headers.get('pragma')).toBe('no-cache');

    const retry = await formRequest('/oauth2/token', {
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      code_verifier: verifier,
      redirect_uri: 'http://127.0.0.1/callback',
      resource: 'http://localhost:4000/mcp',
    });
    expect(retry.status).toBe(401);
    expect(await retry.json()).toMatchObject({ error: 'invalid_grant' });
  });

  it('preserves PKCE failure precedence after Docket consent authority becomes stale', async () => {
    const { db, oauthClient } = await import('@docket/db');
    const { cookie } = await signInWithRecoveryCode();
    const { clientId, code, verifier } = await issueTrustedAuthorizationCode(cookie);
    await db
      .update(oauthClient)
      .set({ skipConsent: false })
      .where(eq(oauthClient.clientId, clientId));

    const wrongVerifier = await formRequest('/oauth2/token', {
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      code_verifier: `${verifier}-wrong`,
      redirect_uri: 'http://127.0.0.1/callback',
      resource: 'http://localhost:4000/mcp',
    });
    expect(wrongVerifier.status).toBe(401);
    expect(await wrongVerifier.json()).toMatchObject({ error: 'invalid_request' });

    const retry = await formRequest('/oauth2/token', {
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      code_verifier: verifier,
      redirect_uri: 'http://127.0.0.1/callback',
      resource: 'http://localhost:4000/mcp',
    });
    expect(retry.status).toBe(401);
    expect(await retry.json()).toMatchObject({ error: 'invalid_grant' });
  });

  it("preserves invalid_client before evaluating another client's stale grant", async () => {
    const { db, oauthResourceGrant } = await import('@docket/db');
    const owner = await signInWithRecoveryCode();
    const sourceClient = await registerConfidentialClient(owner.cookie);
    const otherClient = await registerConfidentialClient(owner.cookie);
    const credential = await seedConsentRefresh({
      clientId: sourceClient.clientId,
      userId: owner.userId,
      resourceUri: 'http://localhost:4000/mcp',
    });
    await db
      .update(oauthResourceGrant)
      .set({ revokedAt: new Date() })
      .where(eq(oauthResourceGrant.id, credential.grantId));

    const response = await formRequest('/oauth2/token', {
      grant_type: 'refresh_token',
      client_id: otherClient.clientId,
      client_secret: otherClient.clientSecret,
      refresh_token: credential.refreshToken,
      resource: 'http://localhost:4000/mcp',
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_client' });
  });

  it('rejects reference-scoped authorization state before creating Docket credentials', async () => {
    const { db, oauthAccessToken, oauthRefreshToken, oauthResourceGrant, verification } =
      await import('@docket/db');
    const { cookie } = await signInWithRecoveryCode();
    const { clientId, code, verifier } = await issueTrustedAuthorizationCode(cookie);
    const identifier = createHash('sha256').update(code).digest('base64url');
    const [stored] = await db
      .select({ value: verification.value })
      .from(verification)
      .where(eq(verification.identifier, identifier));
    if (!stored) throw new Error('Authorization code verification state was not stored.');
    await db
      .update(verification)
      .set({ value: JSON.stringify({ ...JSON.parse(stored.value), referenceId: 'workspace_1' }) })
      .where(eq(verification.identifier, identifier));

    const response = await formRequest('/oauth2/token', {
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      code_verifier: verifier,
      redirect_uri: 'http://127.0.0.1/callback',
      resource: 'http://localhost:4000/mcp',
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_grant' });
    await expect(
      db.select().from(oauthResourceGrant).where(eq(oauthResourceGrant.clientId, clientId)),
    ).resolves.toHaveLength(0);
    await expect(
      db.select().from(oauthRefreshToken).where(eq(oauthRefreshToken.clientId, clientId)),
    ).resolves.toHaveLength(0);
    await expect(
      db.select().from(oauthAccessToken).where(eq(oauthAccessToken.clientId, clientId)),
    ).resolves.toHaveLength(0);
  });

  it('retains a code grant only through the credentials that were issued', async () => {
    const { db, oauthRefreshToken, oauthResourceGrant, verification } = await import('@docket/db');
    const fixture = await seedStoredAuthorizationCode('access-only-deadline');
    const [stored] = await db
      .select({ value: verification.value })
      .from(verification)
      .where(eq(verification.identifier, fixture.identifier));
    if (!stored) throw new Error('Authorization code verification state was not stored.');
    const value = JSON.parse(stored.value) as { query: { scope: string } };
    value.query.scope = 'work:read';
    await db
      .update(verification)
      .set({ value: JSON.stringify(value) })
      .where(eq(verification.identifier, fixture.identifier));

    const startedAt = Date.now();
    const response = await exchangeStoredCode(
      async (request) => (await import('../src/index')).auth.handler(request),
      fixture,
    );
    const token = (await response.json()) as { refresh_token?: string };
    expect(response.status).toBe(200);
    expect(token.refresh_token).toBeUndefined();
    const [grant] = await db
      .select({ expiresAt: oauthResourceGrant.expiresAt })
      .from(oauthResourceGrant)
      .where(eq(oauthResourceGrant.clientId, fixture.clientId));
    expect(grant?.expiresAt.getTime()).toBeGreaterThan(startedAt + 950_000);
    expect(grant?.expiresAt.getTime()).toBeLessThan(startedAt + 975_000);
    await expect(
      db.select().from(oauthRefreshToken).where(eq(oauthRefreshToken.clientId, fixture.clientId)),
    ).resolves.toHaveLength(0);
  });

  it('retains a grant through the greatest issued credential expiry plus tolerance', async () => {
    const { db, oauthRefreshToken, oauthResourceGrant } = await import('@docket/db');
    const fixture = await seedStoredAuthorizationCode('refresh-deadline');

    const response = await exchangeStoredCode(
      async (request) => (await import('../src/index')).auth.handler(request),
      fixture,
    );
    const text = await response.text();
    expect(response.status, text).toBe(200);
    const token = JSON.parse(text) as { access_token: string; refresh_token: string };
    const encodedPayload = token.access_token.split('.')[1];
    if (!encodedPayload) throw new Error('The provider returned a malformed JWT.');
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as {
      exp: number;
    };
    const [refresh] = await db
      .select({ expiresAt: oauthRefreshToken.expiresAt })
      .from(oauthRefreshToken)
      .where(eq(oauthRefreshToken.clientId, fixture.clientId));
    const [grant] = await db
      .select({ id: oauthResourceGrant.id, expiresAt: oauthResourceGrant.expiresAt })
      .from(oauthResourceGrant)
      .where(eq(oauthResourceGrant.clientId, fixture.clientId));
    if (!refresh?.expiresAt || !grant)
      throw new Error('The provider did not bind issued credentials.');
    const accessDeadline = payload.exp * 1_000 + 60_000;
    const refreshDeadline = refresh.expiresAt.getTime() + 60_000;
    expect(grant.expiresAt.getTime()).toBe(Math.max(accessDeadline, refreshDeadline));

    await sweepOAuthLifecycle(new Date(grant.expiresAt.getTime() - 1), 1_000);
    await expect(
      db.select().from(oauthResourceGrant).where(eq(oauthResourceGrant.id, grant.id)),
    ).resolves.toHaveLength(1);
    await sweepOAuthLifecycle(grant.expiresAt, 1_000);
    await expect(
      db.select().from(oauthResourceGrant).where(eq(oauthResourceGrant.id, grant.id)),
    ).resolves.toHaveLength(0);
  });
});
