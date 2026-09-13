import { createHash, randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { sweepOAuthLifecycle } from '../src/oauth-lifecycle';

import {
  authRequest,
  formRequest,
  registerConfidentialClient,
  seedConsentRefresh,
  seedTrustedRefresh,
  signInWithRecoveryCode,
} from './oauth-provider-handler.support';

describe('Docket OAuth provider handler preservation', () => {
  it.each([
    ['client_id', 'same-client'],
    ['client_id', 'different-client'],
    ['token', 'same-token'],
    ['token', 'different-token'],
    ['token_type_hint', 'refresh_token'],
    ['token_type_hint', 'access_token'],
  ])('rejects a repeated revocation %s before changing grant state', async (field, repeated) => {
    const { db, oauthResourceGrant } = await import('@docket/db');
    const fixture = await seedTrustedRefresh();
    const body = new URLSearchParams({
      client_id: fixture.clientId,
      token: fixture.refreshToken,
      token_type_hint: 'refresh_token',
    });
    const current = body.get(field) ?? '';
    body.append(field, repeated.startsWith('same-') ? current : repeated);

    const response = await authRequest('/oauth2/revoke', {
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
  });

  it.each([
    ['equal', true],
    ['different', false],
  ])(
    'rejects a repeated %s confidential client secret before revocation',
    async (_label, equal) => {
      const { db, oauthResourceGrant } = await import('@docket/db');
      const signedIn = await signInWithRecoveryCode();
      const client = await registerConfidentialClient(signedIn.cookie);
      const fixture = await seedConsentRefresh({
        clientId: client.clientId,
        userId: signedIn.userId,
        resourceUri: 'http://localhost:4000/mcp',
      });
      const body = new URLSearchParams({
        client_id: client.clientId,
        client_secret: client.clientSecret,
        token: fixture.refreshToken,
        token_type_hint: 'refresh_token',
      });
      body.append('client_secret', equal ? client.clientSecret : 'different-secret');

      const response = await authRequest('/oauth2/revoke', {
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
    },
  );

  it('reports a confidential JWT inactive immediately after exact revocation', async () => {
    const signedIn = await signInWithRecoveryCode();
    const client = await registerConfidentialClient(signedIn.cookie);
    const credential = await seedConsentRefresh({
      clientId: client.clientId,
      userId: signedIn.userId,
      resourceUri: 'http://localhost:4000/mcp',
    });
    const exchange = await formRequest('/oauth2/token', {
      grant_type: 'refresh_token',
      client_id: client.clientId,
      client_secret: client.clientSecret,
      refresh_token: credential.refreshToken,
      resource: 'http://localhost:4000/mcp',
    });
    const issued = (await exchange.json()) as { access_token: string };

    const active = await formRequest('/oauth2/introspect', {
      client_id: client.clientId,
      client_secret: client.clientSecret,
      token: issued.access_token,
      token_type_hint: 'access_token',
    });
    expect(active.status, await active.clone().text()).toBe(200);
    expect(await active.json()).toMatchObject({ active: true, client_id: client.clientId });

    const revoked = await formRequest('/oauth2/revoke', {
      client_id: client.clientId,
      client_secret: client.clientSecret,
      token: issued.access_token,
      token_type_hint: 'access_token',
    });
    expect(revoked.status, await revoked.clone().text()).toBe(200);
    const after = await formRequest('/oauth2/introspect', {
      client_id: client.clientId,
      client_secret: client.clientSecret,
      token: issued.access_token,
      token_type_hint: 'access_token',
    });
    expect(after.status, await after.clone().text()).toBe(200);
    expect(await after.json()).toEqual({ active: false });
  });

  it('retains an exact JWT revocation through token expiry plus clock tolerance', async () => {
    const { db, oauthJwtRevocation } = await import('@docket/db');
    const signedIn = await signInWithRecoveryCode();
    const client = await registerConfidentialClient(signedIn.cookie);
    const credential = await seedConsentRefresh({
      clientId: client.clientId,
      userId: signedIn.userId,
      resourceUri: 'http://localhost:4000/mcp',
    });
    const exchange = await formRequest('/oauth2/token', {
      grant_type: 'refresh_token',
      client_id: client.clientId,
      client_secret: client.clientSecret,
      refresh_token: credential.refreshToken,
      resource: 'http://localhost:4000/mcp',
    });
    const issued = z.object({ access_token: z.string() }).parse(await exchange.json());
    const encodedPayload = issued.access_token.split('.')[1];
    if (!encodedPayload) throw new Error('The provider returned a malformed JWT.');
    const { exp } = z
      .object({ exp: z.number().int().positive() })
      .parse(JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')));

    const revoked = await formRequest('/oauth2/revoke', {
      client_id: client.clientId,
      client_secret: client.clientSecret,
      token: issued.access_token,
      token_type_hint: 'access_token',
    });
    expect(revoked.status, await revoked.clone().text()).toBe(200);
    const digest = createHash('sha256').update(issued.access_token).digest('base64url');
    const deadline = new Date((exp + 60) * 1_000);
    const [stored] = await db
      .select({ expiresAt: oauthJwtRevocation.expiresAt })
      .from(oauthJwtRevocation)
      .where(eq(oauthJwtRevocation.tokenDigest, digest));
    expect(stored?.expiresAt).toEqual(deadline);

    await sweepOAuthLifecycle(new Date(deadline.getTime() - 1), 1_000);
    await expect(
      db.select().from(oauthJwtRevocation).where(eq(oauthJwtRevocation.tokenDigest, digest)),
    ).resolves.toHaveLength(1);
    await sweepOAuthLifecycle(deadline, 1_000);
    await expect(
      db.select().from(oauthJwtRevocation).where(eq(oauthJwtRevocation.tokenDigest, digest)),
    ).resolves.toHaveLength(0);
  });

  it('reports a refresh credential inactive after the subject is removed', async () => {
    const { db, oauthClient, user } = await import('@docket/db');
    const signedIn = await signInWithRecoveryCode();
    const client = await registerConfidentialClient(signedIn.cookie);
    const credential = await seedConsentRefresh({
      clientId: client.clientId,
      userId: signedIn.userId,
      resourceUri: 'http://localhost:4000/mcp',
    });
    await db
      .update(oauthClient)
      .set({ userId: null })
      .where(eq(oauthClient.clientId, client.clientId));
    await db.delete(user).where(eq(user.id, signedIn.userId));

    const response = await formRequest('/oauth2/introspect', {
      client_id: client.clientId,
      client_secret: client.clientSecret,
      token: credential.refreshToken,
      token_type_hint: 'refresh_token',
    });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toEqual({ active: false });
  });

  it('treats the RFC 7009 token type as a hint in both directions', async () => {
    const { db, jwks, oauthJwtRevocation, oauthResourceGrant } = await import('@docket/db');
    const refreshFixture = await seedTrustedRefresh();

    const refreshRevocation = await formRequest('/oauth2/revoke', {
      client_id: refreshFixture.clientId,
      token: refreshFixture.refreshToken,
      token_type_hint: 'access_token',
    });
    expect(refreshRevocation.status, await refreshRevocation.clone().text()).toBe(200);
    const [revokedGrant] = await db
      .select({ revokedAt: oauthResourceGrant.revokedAt })
      .from(oauthResourceGrant)
      .where(eq(oauthResourceGrant.id, refreshFixture.grantId));
    expect(revokedGrant?.revokedAt).toBeInstanceOf(Date);

    const accessFixture = await seedTrustedRefresh();
    const exchange = await formRequest('/oauth2/token', {
      grant_type: 'refresh_token',
      client_id: accessFixture.clientId,
      refresh_token: accessFixture.refreshToken,
      resource: 'http://localhost:4000/mcp',
    });
    const exchangeText = await exchange.text();
    expect(exchange.status, exchangeText).toBe(200);
    const { access_token: accessToken } = JSON.parse(exchangeText) as { access_token: string };
    expect(await db.select({ id: jwks.id }).from(jwks)).not.toEqual([]);

    const accessRevocation = await formRequest('/oauth2/revoke', {
      client_id: accessFixture.clientId,
      token: accessToken,
      token_type_hint: 'refresh_token',
    });
    expect(accessRevocation.status, await accessRevocation.clone().text()).toBe(200);
    const digest = createHash('sha256').update(accessToken).digest('base64url');
    const denylist = await db
      .select({ digest: oauthJwtRevocation.tokenDigest })
      .from(oauthJwtRevocation)
      .where(eq(oauthJwtRevocation.tokenDigest, digest));
    expect(denylist).toEqual([{ digest }]);
  });

  it('rejects a refresh token with a null storage expiry without crashing', async () => {
    const fixture = await seedTrustedRefresh(null);

    const response = await formRequest('/oauth2/token', {
      grant_type: 'refresh_token',
      client_id: fixture.clientId,
      refresh_token: fixture.refreshToken,
      resource: 'http://localhost:4000/mcp',
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_grant' });
  });

  it('preserves invalid_client when a refresh client is disabled', async () => {
    const { db, oauthClient } = await import('@docket/db');
    const fixture = await seedTrustedRefresh();
    await db
      .update(oauthClient)
      .set({ disabled: true })
      .where(eq(oauthClient.clientId, fixture.clientId));

    const response = await formRequest('/oauth2/token', {
      grant_type: 'refresh_token',
      client_id: fixture.clientId,
      refresh_token: fixture.refreshToken,
      resource: 'http://localhost:4000/mcp',
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_client' });
  });

  it('persists an explicit narrowed refresh scope without restoring renewal authority', async () => {
    const { db, oauthResourceGrant } = await import('@docket/db');
    const fixture = await seedTrustedRefresh();
    const narrowed = await formRequest('/oauth2/token', {
      grant_type: 'refresh_token',
      client_id: fixture.clientId,
      refresh_token: fixture.refreshToken,
      resource: 'http://localhost:4000/mcp',
      scope: 'work:read',
    });

    expect(narrowed.status, await narrowed.clone().text()).toBe(200);
    const narrowedBody = z
      .looseObject({ refresh_token: z.string().min(1), scope: z.literal('work:read') })
      .parse(await narrowed.json());

    const successorUse = await formRequest('/oauth2/token', {
      grant_type: 'refresh_token',
      client_id: fixture.clientId,
      refresh_token: narrowedBody.refresh_token,
      resource: 'http://localhost:4000/mcp',
    });
    expect(successorUse.status).toBe(400);
    expect(await successorUse.json()).toMatchObject({ error: 'invalid_grant' });

    const replay = await formRequest('/oauth2/token', {
      grant_type: 'refresh_token',
      client_id: fixture.clientId,
      refresh_token: fixture.refreshToken,
      resource: 'http://localhost:4000/mcp',
    });
    expect(replay.status).toBe(400);
    expect(await replay.json()).toMatchObject({ error: 'invalid_grant' });
    const [revokedGrant] = await db
      .select({ revokedAt: oauthResourceGrant.revokedAt })
      .from(oauthResourceGrant)
      .where(eq(oauthResourceGrant.id, fixture.grantId));
    expect(revokedGrant?.revokedAt).toBeInstanceOf(Date);
  });

  it('rolls back broad provider replay revocation before invalidating one exact grant family', async () => {
    const { db, oauthRefreshToken, oauthResourceGrant, session } = await import('@docket/db');
    const owner = await signInWithRecoveryCode();
    const client = await registerConfidentialClient(owner.cookie);
    const first = await seedConsentRefresh({
      clientId: client.clientId,
      userId: owner.userId,
      resourceUri: 'http://localhost:4000/mcp',
    });
    const [activeSession] = await db
      .select({ id: session.id })
      .from(session)
      .where(eq(session.userId, owner.userId))
      .limit(1);
    if (!activeSession) throw new Error('The replay fixture has no active session.');
    const siblingGrantId = `sibling-grant-${randomUUID()}`;
    const siblingRefresh = `sibling-refresh-${randomUUID()}`;
    await db.insert(oauthResourceGrant).values({
      id: siblingGrantId,
      clientId: client.clientId,
      userId: owner.userId,
      consentId: first.consentId,
      authorizationKind: 'consent',
      resourceUri: 'http://localhost:4000/mcp',
      expiresAt: new Date(Date.now() + 3_660_000),
    });
    await db.insert(oauthRefreshToken).values({
      token: createHash('sha256').update(siblingRefresh).digest('base64url'),
      clientId: client.clientId,
      userId: owner.userId,
      sessionId: activeSession.id,
      scopes: ['work:read', 'offline_access'],
      expiresAt: new Date(Date.now() + 3_600_000),
      docketGrantId: siblingGrantId,
    });

    const rotated = await formRequest('/oauth2/token', {
      grant_type: 'refresh_token',
      client_id: client.clientId,
      client_secret: client.clientSecret,
      refresh_token: first.refreshToken,
      resource: 'http://localhost:4000/mcp',
    });
    expect(rotated.status, await rotated.clone().text()).toBe(200);
    const replay = await formRequest('/oauth2/token', {
      grant_type: 'refresh_token',
      client_id: client.clientId,
      client_secret: client.clientSecret,
      refresh_token: first.refreshToken,
      resource: 'http://localhost:4000/mcp',
    });
    expect(replay.status).toBe(400);
    expect(await replay.json()).toMatchObject({ error: 'invalid_grant' });

    const grants = await db
      .select({ id: oauthResourceGrant.id, revokedAt: oauthResourceGrant.revokedAt })
      .from(oauthResourceGrant)
      .where(eq(oauthResourceGrant.clientId, client.clientId));
    expect(new Map(grants.map((grant) => [grant.id, grant.revokedAt]))).toEqual(
      new Map([
        [first.grantId, expect.any(Date)],
        [siblingGrantId, null],
      ]),
    );
    const siblingRows = await db
      .select({ revoked: oauthRefreshToken.revoked })
      .from(oauthRefreshToken)
      .where(eq(oauthRefreshToken.docketGrantId, siblingGrantId));
    expect(siblingRows).toEqual([{ revoked: null }]);
    const siblingUse = await formRequest('/oauth2/token', {
      grant_type: 'refresh_token',
      client_id: client.clientId,
      client_secret: client.clientSecret,
      refresh_token: siblingRefresh,
      resource: 'http://localhost:4000/mcp',
    });
    expect(siblingUse.status, await siblingUse.clone().text()).toBe(200);
  });

  it('does not revoke a replayed refresh family when client authentication fails', async () => {
    const { db, oauthClient, oauthResourceGrant } = await import('@docket/db');
    const fixture = await seedTrustedRefresh();
    const firstUse = await formRequest('/oauth2/token', {
      grant_type: 'refresh_token',
      client_id: fixture.clientId,
      refresh_token: fixture.refreshToken,
      resource: 'http://localhost:4000/mcp',
    });
    expect(firstUse.status, await firstUse.clone().text()).toBe(200);
    await db
      .update(oauthClient)
      .set({
        clientSecret: 'stored-secret-that-does-not-match',
        public: false,
        type: 'web',
        tokenEndpointAuthMethod: 'client_secret_post',
      })
      .where(eq(oauthClient.clientId, fixture.clientId));

    const replay = await formRequest('/oauth2/token', {
      grant_type: 'refresh_token',
      client_id: fixture.clientId,
      client_secret: 'wrong-secret',
      refresh_token: fixture.refreshToken,
      resource: 'http://localhost:4000/mcp',
    });
    expect(replay.status).toBe(401);
    expect(await replay.json()).toMatchObject({ error: 'invalid_client' });
    const [grant] = await db
      .select({ revokedAt: oauthResourceGrant.revokedAt })
      .from(oauthResourceGrant)
      .where(eq(oauthResourceGrant.id, fixture.grantId));
    expect(grant?.revokedAt).toBeNull();
  });
});
