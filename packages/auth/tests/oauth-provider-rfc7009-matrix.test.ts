import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';

import { eq, inArray } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import {
  authRequest,
  formRequest,
  registerConfidentialClient,
  seedConsentRefresh,
  seedTrustedRefresh,
  signInWithRecoveryCode,
} from './oauth-provider-handler.support';

const issuer = 'http://localhost:4000/api/auth';
const mcpResource = 'http://localhost:4000/mcp';
const grantClaim = 'https://clearthedocket.com/oauth/grant';
const createdKeyIds: string[] = [];

afterEach(async () => {
  if (createdKeyIds.length === 0) return;
  const { db, jwks } = await import('@docket/db');
  await db.delete(jwks).where(inArray(jwks.id, createdKeyIds.splice(0)));
});

async function signingKey() {
  const { db, jwks } = await import('@docket/db');
  const keyId = `rfc7009-${randomUUID()}`;
  createdKeyIds.push(keyId);
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  await db.insert(jwks).values({
    id: keyId,
    publicKey: JSON.stringify(publicKey.export({ format: 'jwk' })),
    privateKey: JSON.stringify(privateKey.export({ format: 'jwk' })),
    createdAt: new Date(0),
  });
  return { keyId, privateKey };
}

function signedToken(input: {
  readonly audience?: string;
  readonly azp: string;
  readonly expiresAt?: number;
  readonly grantId: string;
  readonly issuer?: string;
  readonly key: Awaited<ReturnType<typeof signingKey>>;
  readonly subject: string;
}): string {
  const now = Math.floor(Date.now() / 1_000);
  const header = Buffer.from(JSON.stringify({ alg: 'EdDSA', kid: input.key.keyId })).toString(
    'base64url',
  );
  const payload = Buffer.from(
    JSON.stringify({
      iss: input.issuer ?? issuer,
      aud: input.audience ?? mcpResource,
      azp: input.azp,
      sub: input.subject,
      iat: now - 10,
      exp: input.expiresAt ?? now + 600,
      scope: 'work:read offline_access',
      jti: randomUUID(),
      [grantClaim]: input.grantId,
    }),
  ).toString('base64url');
  const signingInput = `${header}.${payload}`;
  return `${signingInput}.${sign(null, Buffer.from(signingInput), input.key.privateKey).toString(
    'base64url',
  )}`;
}

async function revokePublic(
  clientId: string,
  token: string,
  hint?: 'access_token' | 'refresh_token',
): Promise<Response> {
  return formRequest('/oauth2/revoke', {
    client_id: clientId,
    token,
    ...(hint ? { token_type_hint: hint } : {}),
  });
}

describe('Docket RFC 7009 revocation matrix', () => {
  it('keeps public-client revocation opaque while persisting only an exact valid JWT digest', async () => {
    const { db, oauthJwtRevocation, oauthResourceGrant } = await import('@docket/db');
    const fixture = await seedTrustedRefresh();
    const other = await seedTrustedRefresh();
    const key = await signingKey();
    const now = Math.floor(Date.now() / 1_000);
    const valid = signedToken({
      azp: fixture.clientId,
      grantId: fixture.grantId,
      key,
      subject: fixture.userId,
    });
    const invalidTokens = [
      'not-a-jwt',
      `${valid.slice(0, valid.lastIndexOf('.') + 1)}bad-signature`,
      signedToken({
        azp: fixture.clientId,
        expiresAt: now - 1,
        grantId: fixture.grantId,
        key,
        subject: fixture.userId,
      }),
      signedToken({
        azp: fixture.clientId,
        grantId: fixture.grantId,
        issuer: 'https://wrong.example/api/auth',
        key,
        subject: fixture.userId,
      }),
      signedToken({
        audience: 'https://wrong.example/v1',
        azp: fixture.clientId,
        grantId: fixture.grantId,
        key,
        subject: fixture.userId,
      }),
    ];

    for (const token of invalidTokens) {
      const response = await revokePublic(fixture.clientId, token, 'access_token');
      expect(response.status, await response.clone().text()).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('pragma')).toBe('no-cache');
    }
    const wrongClient = await revokePublic(other.clientId, valid, 'access_token');
    expect(wrongClient.status, await wrongClient.clone().text()).toBe(200);
    const unknown = await revokePublic(fixture.clientId, `unknown-${randomUUID()}`);
    expect(unknown.status, await unknown.clone().text()).toBe(200);

    const first = await revokePublic(fixture.clientId, valid);
    const repeated = await revokePublic(fixture.clientId, valid, 'refresh_token');
    expect(first.status, await first.clone().text()).toBe(200);
    expect(repeated.status, await repeated.clone().text()).toBe(200);
    const allTokens = [valid, ...invalidTokens];
    const digests = allTokens.map((token) =>
      createHash('sha256').update(token).digest('base64url'),
    );
    const stored = await db
      .select({ tokenDigest: oauthJwtRevocation.tokenDigest })
      .from(oauthJwtRevocation)
      .where(inArray(oauthJwtRevocation.tokenDigest, digests));
    expect(stored).toEqual([{ tokenDigest: digests[0] }]);
    const [grant] = await db
      .select({ revokedAt: oauthResourceGrant.revokedAt })
      .from(oauthResourceGrant)
      .where(eq(oauthResourceGrant.id, fixture.grantId));
    expect(grant?.revokedAt).toBeNull();
  });

  it('accepts confidential HTTP Basic authentication without form credentials', async () => {
    const { db, oauthJwtRevocation } = await import('@docket/db');
    const owner = await signInWithRecoveryCode();
    const client = await registerConfidentialClient(owner.cookie);
    const credential = await seedConsentRefresh({
      clientId: client.clientId,
      userId: owner.userId,
      resourceUri: mcpResource,
    });
    const exchange = await formRequest('/oauth2/token', {
      grant_type: 'refresh_token',
      client_id: client.clientId,
      client_secret: client.clientSecret,
      refresh_token: credential.refreshToken,
      resource: mcpResource,
    });
    expect(exchange.status, await exchange.clone().text()).toBe(200);
    const issued = (await exchange.json()) as { access_token: string };
    const basic = Buffer.from(`${client.clientId}:${client.clientSecret}`).toString('base64');

    const revoked = await authRequest('/oauth2/revoke', {
      method: 'POST',
      headers: {
        authorization: `Basic ${basic}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ token: issued.access_token }),
    });

    expect(revoked.status, await revoked.clone().text()).toBe(200);
    const digest = createHash('sha256').update(issued.access_token).digest('base64url');
    await expect(
      db
        .select({ tokenDigest: oauthJwtRevocation.tokenDigest })
        .from(oauthJwtRevocation)
        .where(eq(oauthJwtRevocation.tokenDigest, digest)),
    ).resolves.toEqual([{ tokenDigest: digest }]);
  });

  it('revokes only a live refresh owned by the authenticated client', async () => {
    const { db, oauthRefreshToken, oauthResourceGrant } = await import('@docket/db');
    const fixture = await seedTrustedRefresh();
    const other = await seedTrustedRefresh();
    const expired = await seedTrustedRefresh(new Date(Date.now() - 1_000));
    const alreadyRevoked = await seedTrustedRefresh();
    const alreadyRevokedDigest = createHash('sha256')
      .update(alreadyRevoked.refreshToken)
      .digest('base64url');
    await db
      .update(oauthRefreshToken)
      .set({ revoked: new Date(Date.now() - 500) })
      .where(eq(oauthRefreshToken.token, alreadyRevokedDigest));

    for (const [clientId, token] of [
      [other.clientId, fixture.refreshToken],
      [expired.clientId, expired.refreshToken],
      [alreadyRevoked.clientId, alreadyRevoked.refreshToken],
    ] as const) {
      const response = await revokePublic(clientId, token, 'access_token');
      expect(response.status, await response.clone().text()).toBe(200);
    }
    const untouchedIds = [fixture.grantId, expired.grantId, alreadyRevoked.grantId];
    const untouched = await db
      .select({ id: oauthResourceGrant.id, revokedAt: oauthResourceGrant.revokedAt })
      .from(oauthResourceGrant)
      .where(inArray(oauthResourceGrant.id, untouchedIds));
    expect(untouched.map((row) => [row.id, row.revokedAt])).toEqual(
      expect.arrayContaining(untouchedIds.map((id) => [id, null])),
    );

    const first = await revokePublic(fixture.clientId, fixture.refreshToken, 'access_token');
    expect(first.status, await first.clone().text()).toBe(200);
    const [revoked] = await db
      .select({ revokedAt: oauthResourceGrant.revokedAt })
      .from(oauthResourceGrant)
      .where(eq(oauthResourceGrant.id, fixture.grantId));
    expect(revoked?.revokedAt).toBeInstanceOf(Date);
    const repeated = await revokePublic(fixture.clientId, fixture.refreshToken, 'refresh_token');
    expect(repeated.status, await repeated.clone().text()).toBe(200);
    const [afterRepeat] = await db
      .select({ revokedAt: oauthResourceGrant.revokedAt })
      .from(oauthResourceGrant)
      .where(eq(oauthResourceGrant.id, fixture.grantId));
    expect(afterRepeat?.revokedAt).toEqual(revoked?.revokedAt);
  });

  it('preserves client errors and lets HTTP Basic override conflicting form credentials', async () => {
    const { db, oauthClient, oauthResourceGrant } = await import('@docket/db');
    const owner = await signInWithRecoveryCode();
    const disabledClient = await registerConfidentialClient(owner.cookie);
    const disabledCredential = await seedConsentRefresh({
      clientId: disabledClient.clientId,
      userId: owner.userId,
      resourceUri: mcpResource,
    });
    await db
      .update(oauthClient)
      .set({ disabled: true })
      .where(eq(oauthClient.clientId, disabledClient.clientId));
    const disabled = await formRequest('/oauth2/revoke', {
      client_id: disabledClient.clientId,
      client_secret: disabledClient.clientSecret,
      token: disabledCredential.refreshToken,
    });
    expect(disabled.status, await disabled.clone().text()).toBe(400);
    expect(await disabled.json()).toMatchObject({ error: 'invalid_client' });
    const [disabledGrant] = await db
      .select({ revokedAt: oauthResourceGrant.revokedAt })
      .from(oauthResourceGrant)
      .where(eq(oauthResourceGrant.id, disabledCredential.grantId));
    expect(disabledGrant?.revokedAt).toBeNull();

    const unknown = await formRequest('/oauth2/revoke', {
      client_id: `missing-${randomUUID()}`,
      token: 'malformed-token',
    });
    expect(unknown.status, await unknown.clone().text()).toBe(400);
    expect(await unknown.json()).toMatchObject({ error: 'invalid_client' });

    const deletedClient = await registerConfidentialClient(owner.cookie);
    await db.delete(oauthClient).where(eq(oauthClient.clientId, deletedClient.clientId));
    const deleted = await formRequest('/oauth2/revoke', {
      client_id: deletedClient.clientId,
      client_secret: deletedClient.clientSecret,
      token: 'malformed-token',
    });
    expect(deleted.status, await deleted.clone().text()).toBe(400);
    expect(await deleted.json()).toMatchObject({ error: 'invalid_client' });

    const basicClient = await registerConfidentialClient(owner.cookie);
    const basicCredential = await seedConsentRefresh({
      clientId: basicClient.clientId,
      userId: owner.userId,
      resourceUri: mcpResource,
    });
    const formClient = await registerConfidentialClient(owner.cookie);
    const basic = Buffer.from(`${basicClient.clientId}:${basicClient.clientSecret}`).toString(
      'base64',
    );
    const conflicting = await authRequest('/oauth2/revoke', {
      method: 'POST',
      headers: {
        authorization: `Basic ${basic}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: formClient.clientId,
        client_secret: formClient.clientSecret,
        token: basicCredential.refreshToken,
      }),
    });
    expect(conflicting.status, await conflicting.clone().text()).toBe(200);
    const [basicGrant] = await db
      .select({ revokedAt: oauthResourceGrant.revokedAt })
      .from(oauthResourceGrant)
      .where(eq(oauthResourceGrant.id, basicCredential.grantId));
    expect(basicGrant?.revokedAt).toBeInstanceOf(Date);

    const protectedCredential = await seedConsentRefresh({
      clientId: formClient.clientId,
      userId: owner.userId,
      resourceUri: mcpResource,
    });
    const wrongBasic = Buffer.from(`${formClient.clientId}:wrong-secret`).toString('base64');
    const rejected = await authRequest('/oauth2/revoke', {
      method: 'POST',
      headers: {
        authorization: `Basic ${wrongBasic}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: formClient.clientId,
        client_secret: formClient.clientSecret,
        token: protectedCredential.refreshToken,
      }),
    });
    expect(rejected.status, await rejected.clone().text()).toBe(401);
    expect(await rejected.json()).toMatchObject({ error: 'invalid_client' });
    const [protectedGrant] = await db
      .select({ revokedAt: oauthResourceGrant.revokedAt })
      .from(oauthResourceGrant)
      .where(eq(oauthResourceGrant.id, protectedCredential.grantId));
    expect(protectedGrant?.revokedAt).toBeNull();
  });
});
