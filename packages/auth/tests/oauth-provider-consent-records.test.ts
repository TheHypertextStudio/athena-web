import { createHash, randomUUID } from 'node:crypto';

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
  it('lets the owning user delete consent while disabled without reviving old grants', async () => {
    const { db, oauthClient, oauthConsent, oauthRefreshToken, oauthResourceGrant, session } =
      await import('@docket/db');
    const owner = await signInWithRecoveryCode();
    const client = await registerConfidentialClient(owner.cookie);
    const credential = await seedConsentRefresh({
      clientId: client.clientId,
      userId: owner.userId,
      resourceUri: 'http://localhost:4000/mcp',
    });
    const legacyBefore = new Date();
    const trustedGrantId = `provider-delete-trusted-grant-${randomUUID()}`;
    const trustedRefreshToken = `provider-delete-trusted-refresh-${randomUUID()}`;
    const [activeSession] = await db
      .select({ id: session.id })
      .from(session)
      .where(eq(session.userId, owner.userId))
      .limit(1);
    if (!activeSession) throw new Error('Failed to find the consent-delete session.');
    await db.insert(oauthResourceGrant).values({
      id: trustedGrantId,
      clientId: client.clientId,
      userId: owner.userId,
      consentId: null,
      authorizationKind: 'trusted_mcp',
      resourceUri: 'http://localhost:4000/mcp',
      legacyBefore,
      expiresAt: new Date(legacyBefore.getTime() + 16 * 60_000),
    });
    await db.insert(oauthRefreshToken).values({
      token: createHash('sha256').update(trustedRefreshToken).digest('base64url'),
      clientId: client.clientId,
      userId: owner.userId,
      sessionId: activeSession.id,
      scopes: ['work:read', 'offline_access'],
      expiresAt: new Date(Date.now() + 15 * 60_000),
      docketGrantId: trustedGrantId,
    });
    await db
      .update(oauthClient)
      .set({
        disabled: true,
        docketLegacyBefore: legacyBefore,
        docketLegacyTrusted: true,
        skipConsent: true,
      })
      .where(eq(oauthClient.clientId, client.clientId));

    const deleted = await authRequest('/oauth2/delete-consent', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: owner.cookie,
        origin: 'http://localhost:4000',
      },
      body: JSON.stringify({ id: credential.consentId }),
    });
    expect(deleted.status, await deleted.clone().text()).toBe(200);
    expect(
      await db
        .select({ id: oauthConsent.id })
        .from(oauthConsent)
        .where(eq(oauthConsent.id, credential.consentId)),
    ).toEqual([]);
    expect(
      await db
        .select({ id: oauthResourceGrant.id })
        .from(oauthResourceGrant)
        .where(eq(oauthResourceGrant.id, credential.grantId)),
    ).toEqual([]);
    expect(
      await db
        .select({ id: oauthRefreshToken.id })
        .from(oauthRefreshToken)
        .where(eq(oauthRefreshToken.docketGrantId, credential.grantId)),
    ).toEqual([]);
    expect(
      await db
        .select({ id: oauthResourceGrant.id, revokedAt: oauthResourceGrant.revokedAt })
        .from(oauthResourceGrant)
        .where(eq(oauthResourceGrant.id, trustedGrantId)),
    ).toEqual([{ id: trustedGrantId, revokedAt: expect.any(Date) }]);
    expect(
      await db
        .select({ revokedAt: oauthRefreshToken.revoked })
        .from(oauthRefreshToken)
        .where(eq(oauthRefreshToken.docketGrantId, trustedGrantId)),
    ).toEqual([{ revokedAt: expect.any(Date) }]);

    await db
      .update(oauthClient)
      .set({ disabled: false })
      .where(eq(oauthClient.clientId, client.clientId));
    const replay = await formRequest('/oauth2/token', {
      grant_type: 'refresh_token',
      client_id: client.clientId,
      client_secret: client.clientSecret,
      refresh_token: credential.refreshToken,
      resource: 'http://localhost:4000/mcp',
    });
    expect(replay.status).toBe(400);
    expect(await replay.json()).toMatchObject({ error: 'invalid_grant' });
    const trustedReplay = await formRequest('/oauth2/token', {
      grant_type: 'refresh_token',
      client_id: client.clientId,
      client_secret: client.clientSecret,
      refresh_token: trustedRefreshToken,
      resource: 'http://localhost:4000/mcp',
    });
    expect(trustedReplay.status).toBe(400);
    expect(await trustedReplay.json()).toMatchObject({ error: 'invalid_grant' });
    expect(
      await db
        .select({ id: oauthResourceGrant.id, revokedAt: oauthResourceGrant.revokedAt })
        .from(oauthResourceGrant)
        .where(eq(oauthResourceGrant.clientId, client.clientId)),
    ).toEqual([{ id: trustedGrantId, revokedAt: expect.any(Date) }]);
  });

  it('rolls back a consent deletion attempted by a different user', async () => {
    const { db, oauthConsent, oauthResourceGrant } = await import('@docket/db');
    const owner = await signInWithRecoveryCode();
    const attacker = await signInWithRecoveryCode();
    const client = await registerConfidentialClient(owner.cookie);
    const credential = await seedConsentRefresh({
      clientId: client.clientId,
      userId: owner.userId,
      resourceUri: 'http://localhost:4000/mcp',
    });

    const response = await authRequest('/oauth2/delete-consent', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: attacker.cookie,
        origin: 'http://localhost:4000',
      },
      body: JSON.stringify({ id: credential.consentId }),
    });
    expect(response.status).toBe(401);
    expect(
      await db
        .select({ id: oauthConsent.id })
        .from(oauthConsent)
        .where(eq(oauthConsent.id, credential.consentId)),
    ).toHaveLength(1);
    expect(
      await db
        .select({ id: oauthResourceGrant.id })
        .from(oauthResourceGrant)
        .where(eq(oauthResourceGrant.id, credential.grantId)),
    ).toHaveLength(1);
  });

  it.each(['update-consent', 'delete-consent'])(
    'preserves the provider response when %s receives an empty id',
    async (endpoint) => {
      const owner = await signInWithRecoveryCode();
      const response = await authRequest(`/oauth2/${endpoint}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: owner.cookie,
          origin: 'http://localhost:4000',
        },
        body: JSON.stringify(
          endpoint === 'update-consent'
            ? { id: '', update: { scopes: ['work:read'] } }
            : { id: '' },
        ),
      });

      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({
        error: 'not_found',
        error_description: 'missing id parameter',
      });
    },
  );
});
