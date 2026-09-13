import { createHash, randomUUID } from 'node:crypto';

import { expect, it } from 'vitest';

import { API_VERSION } from '../../src/api-version';
import {
  orgId,
  origin,
  raceBehindClientLock,
  createRecoveryUser,
  registerConfidentialClient,
  registerPublicClient,
  required,
  request,
  sessionCookies,
  signInRecoveryUser,
  userId,
  type ConfidentialRegisteredClient,
  type IssuedTokens,
  type RegisteredClient,
} from './oauth-ceremony.postgres.runtime';
import {
  authorizationCode,
  decodeAccessClaims,
  exchangeCode,
  initializeMcp,
  introspectToken,
  readOrganizations,
  refreshTokens,
  revokeToken,
} from './oauth-ceremony.postgres.protocol';

interface RestCeremony {
  readonly client: RegisteredClient;
  readonly restResource: string;
  readonly mcpResource: string;
  readonly restTokens: IssuedTokens;
  readonly rotatedTokens: IssuedTokens;
}

async function issueRestCeremony(): Promise<RestCeremony> {
  const { db, oauthClient } = await import('@docket/db');
  const { eq } = await import('drizzle-orm');
  const client = await registerPublicClient();
  const [storedClient] = await db
    .select({ scopes: oauthClient.scopes })
    .from(oauthClient)
    .where(eq(oauthClient.clientId, client.clientId));
  expect(storedClient?.scopes).toEqual([
    'work:read',
    'work:write',
    'agents:run',
    'connectors:link',
    'offline_access',
  ]);
  const restResource = `${origin}/v1`;
  const mcpResource = `${origin}/mcp`;
  const restCode = await authorizationCode(client, restResource, 'rest-state', true);
  const restTokens = await exchangeCode(client, restCode, restResource);
  const restRead = await request('/v1/orgs', {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${restTokens.accessToken}`,
      origin: 'https://external.example',
    },
  });
  const restText = await restRead.text();
  expect(restRead.status, restText).toBe(200);
  expect(restRead.headers.get('docket-version')).toBe(API_VERSION);
  expect(restRead.headers.get('access-control-allow-origin')).toBe('*');
  expect(JSON.parse(restText)).toMatchObject({ items: [{ id: orgId }] });
  const initialClaims = decodeAccessClaims(restTokens.accessToken);
  expect(initialClaims).toMatchObject({ aud: restResource, azp: client.clientId, sub: userId });
  const rotated = await refreshTokens(client, restTokens.refreshToken, restResource);
  expect(rotated.response.status, await rotated.response.clone().text()).toBe(200);
  const rotatedTokens = required(rotated.tokens, 'The refresh response omitted credentials.');
  const rotatedClaims = decodeAccessClaims(rotatedTokens.accessToken);
  expect(rotatedClaims['https://clearthedocket.com/oauth/grant']).toBe(
    initialClaims['https://clearthedocket.com/oauth/grant'],
  );
  expect(rotatedClaims.jti).not.toBe(initialClaims.jti);
  return { client, restResource, mcpResource, restTokens, rotatedTokens };
}

async function issueSiblingCeremonies(fixture: RestCeremony): Promise<{
  readonly connectedRestTokens: IssuedTokens;
  readonly mcpTokens: IssuedTokens;
}> {
  expect((await initializeMcp(fixture.restTokens.accessToken)).status).toBe(401);
  const connectedCode = await authorizationCode(
    fixture.client,
    fixture.restResource,
    'connected-rest-state',
    false,
  );
  const connectedRestTokens = await exchangeCode(
    fixture.client,
    connectedCode,
    fixture.restResource,
  );
  const mcpCode = await authorizationCode(fixture.client, fixture.mcpResource, 'mcp-state', false);
  const mcpTokens = await exchangeCode(fixture.client, mcpCode, fixture.mcpResource);
  expect((await initializeMcp(mcpTokens.accessToken)).status).toBe(200);
  expect((await readOrganizations(mcpTokens.accessToken)).status).toBe(401);
  return { connectedRestTokens, mcpTokens };
}

async function assertCeremonyRevocation(
  fixture: RestCeremony,
  siblings: { readonly connectedRestTokens: IssuedTokens; readonly mcpTokens: IssuedTokens },
): Promise<void> {
  const exact = await revokeToken(
    fixture.client,
    fixture.rotatedTokens.accessToken,
    'access_token',
  );
  expect(exact.status, await exact.clone().text()).toBe(200);
  expect(exact.headers.get('cache-control')).toBe('no-store');
  expect((await readOrganizations(fixture.rotatedTokens.accessToken)).status).toBe(401);
  const successor = await refreshTokens(
    fixture.client,
    fixture.rotatedTokens.refreshToken,
    fixture.restResource,
  );
  expect(successor.response.status, await successor.response.clone().text()).toBe(200);
  const successorTokens = required(successor.tokens, 'The successor refresh omitted credentials.');
  const spent = await revokeToken(fixture.client, fixture.restTokens.refreshToken, 'refresh_token');
  expect(spent.status, await spent.clone().text()).toBe(200);
  expect((await readOrganizations(successorTokens.accessToken)).status).toBe(401);
  expect(
    (await refreshTokens(fixture.client, successorTokens.refreshToken, fixture.restResource))
      .response.status,
  ).toBe(400);
  expect((await readOrganizations(siblings.connectedRestTokens.accessToken)).status).toBe(200);
  expect((await initializeMcp(siblings.mcpTokens.accessToken)).status).toBe(200);
  expect(
    (await revokeToken(fixture.client, `unknown-${randomUUID()}`, 'refresh_token')).status,
  ).toBe(200);
  const revoke = await request(
    `/v1/me/connected-apps/${fixture.client.clientId}`,
    { method: 'DELETE', headers: { accept: 'application/json' } },
    sessionCookies,
  );
  expect(revoke.status, await revoke.clone().text()).toBe(200);
  expect(await revoke.json()).toEqual({ revoked: true });
  expect((await readOrganizations(siblings.connectedRestTokens.accessToken)).status).toBe(401);
  expect(
    (
      await refreshTokens(
        fixture.client,
        siblings.connectedRestTokens.refreshToken,
        fixture.restResource,
      )
    ).response.status,
  ).toBe(400);
  expect((await initializeMcp(siblings.mcpTokens.accessToken)).status).toBe(401);
}

it('binds each ceremony to one resource and revokes both through connected apps', async () => {
  const fixture = await issueRestCeremony();
  const siblings = await issueSiblingCeremonies(fixture);
  await assertCeremonyRevocation(fixture, siblings);
});

interface IntrospectionFixture {
  readonly client: ConfidentialRegisteredClient;
  readonly restResource: string;
  readonly mcpResource: string;
  readonly restTokens: IssuedTokens;
  readonly mcpTokens: IssuedTokens;
}

async function issueIntrospectionFixture(): Promise<IntrospectionFixture> {
  const client = await registerConfidentialClient();
  const restResource = `${origin}/v1`;
  const mcpResource = `${origin}/mcp`;
  const restCode = await authorizationCode(client, restResource, 'introspection-rest', true);
  const restTokens = await exchangeCode(client, restCode, restResource);
  const mcpCode = await authorizationCode(client, mcpResource, 'introspection-mcp', false);
  const mcpTokens = await exchangeCode(client, mcpCode, mcpResource);
  return { client, restResource, mcpResource, restTokens, mcpTokens };
}

async function assertActiveIntrospection(fixture: IntrospectionFixture): Promise<void> {
  const rest = await introspectToken(fixture.client, fixture.restTokens.accessToken);
  expect(rest.status, await rest.clone().text()).toBe(200);
  expect(await rest.json()).toMatchObject({
    active: true,
    aud: fixture.restResource,
    client_id: fixture.client.clientId,
    scope: 'work:read offline_access',
    sub: userId,
  });
  expect(rest.headers.get('cache-control')).toBe('no-store');
  expect(rest.headers.get('pragma')).toBe('no-cache');
  const refresh = await introspectToken(
    fixture.client,
    fixture.restTokens.refreshToken,
    'refresh_token',
  );
  expect(await refresh.json()).toMatchObject({ active: true, scope: 'work:read offline_access' });
  const mcp = await introspectToken(fixture.client, fixture.mcpTokens.accessToken);
  expect(await mcp.json()).toMatchObject({ active: true, aud: fixture.mcpResource });
  expect((await readOrganizations(fixture.restTokens.accessToken)).status).toBe(200);
  expect((await readOrganizations(fixture.mcpTokens.accessToken)).status).toBe(401);
  expect((await initializeMcp(fixture.mcpTokens.accessToken)).status).toBe(200);
  expect((await initializeMcp(fixture.restTokens.accessToken)).status).toBe(401);
  const otherClient = await registerConfidentialClient();
  expect(await (await introspectToken(otherClient, fixture.restTokens.accessToken)).json()).toEqual(
    {
      active: false,
    },
  );
}

async function assertStoredGrantRejections(fixture: IntrospectionFixture): Promise<void> {
  const { db, oauthJwtRevocation, oauthResourceGrant } = await import('@docket/db');
  const { eq } = await import('drizzle-orm');
  const claims = decodeAccessClaims(fixture.restTokens.accessToken);
  const grantId = claims['https://clearthedocket.com/oauth/grant'];
  const [grant] = await db
    .select({ createdAt: oauthResourceGrant.createdAt, expiresAt: oauthResourceGrant.expiresAt })
    .from(oauthResourceGrant)
    .where(eq(oauthResourceGrant.id, grantId));
  if (!grant) throw new Error('The REST introspection grant was not stored.');
  const digest = createHash('sha256').update(fixture.restTokens.accessToken).digest('base64url');
  await db.insert(oauthJwtRevocation).values({
    tokenDigest: digest,
    revokedAt: new Date(),
    expiresAt: new Date((claims.exp + 60) * 1_000),
  });
  expect(
    await (await introspectToken(fixture.client, fixture.restTokens.accessToken)).json(),
  ).toEqual({ active: false });
  await db.delete(oauthJwtRevocation).where(eq(oauthJwtRevocation.tokenDigest, digest));
  await db
    .update(oauthResourceGrant)
    .set({ resourceUri: fixture.mcpResource })
    .where(eq(oauthResourceGrant.id, grantId));
  expect(
    await (await introspectToken(fixture.client, fixture.restTokens.accessToken)).json(),
  ).toEqual({ active: false });
  await db
    .update(oauthResourceGrant)
    .set({
      resourceUri: fixture.restResource,
      createdAt: new Date(Date.now() - 2_000),
      expiresAt: new Date(Date.now() - 1_000),
    })
    .where(eq(oauthResourceGrant.id, grantId));
  expect(
    await (await introspectToken(fixture.client, fixture.restTokens.accessToken)).json(),
  ).toEqual({ active: false });
  await db.update(oauthResourceGrant).set(grant).where(eq(oauthResourceGrant.id, grantId));
}

async function assertLiveAuthorityRejections(fixture: IntrospectionFixture): Promise<void> {
  const { db, oauthClient, oauthConsent, oauthResourceGrant } = await import('@docket/db');
  const { eq } = await import('drizzle-orm');
  await db
    .update(oauthClient)
    .set({ scopes: ['offline_access'] })
    .where(eq(oauthClient.clientId, fixture.client.clientId));
  expect(
    await (await introspectToken(fixture.client, fixture.restTokens.accessToken)).json(),
  ).toEqual({ active: false });
  await db
    .update(oauthClient)
    .set({ scopes: ['work:read', 'offline_access'] })
    .where(eq(oauthClient.clientId, fixture.client.clientId));
  await db
    .update(oauthConsent)
    .set({ scopes: ['work:read'] })
    .where(eq(oauthConsent.clientId, fixture.client.clientId));
  expect(
    await (await introspectToken(fixture.client, fixture.restTokens.accessToken)).json(),
  ).toMatchObject({ active: true, scope: 'work:read' });
  expect(
    await (
      await introspectToken(fixture.client, fixture.restTokens.refreshToken, 'refresh_token')
    ).json(),
  ).toEqual({ active: false });
  await db
    .update(oauthClient)
    .set({ disabled: true })
    .where(eq(oauthClient.clientId, fixture.client.clientId));
  const disabledRest = await introspectToken(fixture.client, fixture.restTokens.accessToken);
  expect(disabledRest.status).toBe(400);
  expect(await disabledRest.json()).toMatchObject({ error: 'invalid_client' });
  const disabledMcp = await introspectToken(fixture.client, fixture.mcpTokens.accessToken);
  expect(disabledMcp.status).toBe(400);
  expect(await disabledMcp.json()).toMatchObject({ error: 'invalid_client' });
  expect((await readOrganizations(fixture.restTokens.accessToken)).status).toBe(401);
  expect((await initializeMcp(fixture.mcpTokens.accessToken)).status).toBe(401);
  await db
    .update(oauthClient)
    .set({ disabled: false })
    .where(eq(oauthClient.clientId, fixture.client.clientId));
  await db
    .update(oauthResourceGrant)
    .set({ revokedAt: new Date() })
    .where(eq(oauthResourceGrant.clientId, fixture.client.clientId));
  expect(
    await (await introspectToken(fixture.client, fixture.restTokens.accessToken)).json(),
  ).toEqual({ active: false });
}

it('keeps real issued-token introspection consistent with REST, MCP, and live consent', async () => {
  const fixture = await issueIntrospectionFixture();
  await assertActiveIntrospection(fixture);
  await assertStoredGrantRejections(fixture);
  await assertLiveAuthorityRejections(fixture);
});

it('makes a removed user inactive across REST, MCP, and introspection', async () => {
  const { db, user } = await import('@docket/db');
  const { eq } = await import('drizzle-orm');
  const identity = await createRecoveryUser('Removed OAuth subject');
  const cookies = await signInRecoveryUser(identity);
  const client = await registerConfidentialClient();
  const restResource = `${origin}/v1`;
  const mcpResource = `${origin}/mcp`;
  const restCode = await authorizationCode(
    client,
    restResource,
    'removed-user-rest',
    true,
    cookies,
  );
  const restTokens = await exchangeCode(client, restCode, restResource);
  const mcpCode = await authorizationCode(client, mcpResource, 'removed-user-mcp', false, cookies);
  const mcpTokens = await exchangeCode(client, mcpCode, mcpResource);
  await db.delete(user).where(eq(user.id, identity.userId));
  expect(await (await introspectToken(client, restTokens.accessToken)).json()).toEqual({
    active: false,
  });
  expect(await (await introspectToken(client, mcpTokens.accessToken)).json()).toEqual({
    active: false,
  });
  expect((await readOrganizations(restTokens.accessToken)).status).toBe(401);
  expect((await initializeMcp(mcpTokens.accessToken)).status).toBe(401);
});

it('keeps concurrent REST and MCP issuance state isolated', async () => {
  const { db, oauthRefreshToken } = await import('@docket/db');
  const { inArray } = await import('drizzle-orm');
  const client = await registerPublicClient();
  const restResource = `${origin}/v1`;
  const mcpResource = `${origin}/mcp`;
  const restCode = await authorizationCode(client, restResource, 'parallel-rest', true);
  const mcpCode = await authorizationCode(client, mcpResource, 'parallel-mcp', false);

  const [restTokens, mcpTokens] = await raceBehindClientLock(client.clientId, () => [
    exchangeCode(client, restCode, restResource),
    exchangeCode(client, mcpCode, mcpResource),
  ]);
  if (!restTokens || !mcpTokens) {
    throw new Error('Both concurrent authorization-code exchanges must return credentials.');
  }
  const restClaims = decodeAccessClaims(restTokens.accessToken);
  const mcpClaims = decodeAccessClaims(mcpTokens.accessToken);

  expect(restClaims.aud).toBe(restResource);
  expect(mcpClaims.aud).toBe(mcpResource);
  expect(restClaims['https://clearthedocket.com/oauth/grant']).not.toBe(
    mcpClaims['https://clearthedocket.com/oauth/grant'],
  );
  const restDigest = createHash('sha256').update(restTokens.refreshToken).digest('base64url');
  const mcpDigest = createHash('sha256').update(mcpTokens.refreshToken).digest('base64url');
  const storedRefreshes = await db
    .select({ grantId: oauthRefreshToken.docketGrantId, token: oauthRefreshToken.token })
    .from(oauthRefreshToken)
    .where(inArray(oauthRefreshToken.token, [restDigest, mcpDigest]));
  expect(new Map(storedRefreshes.map((row) => [row.token, row.grantId]))).toEqual(
    new Map([
      [restDigest, restClaims['https://clearthedocket.com/oauth/grant']],
      [mcpDigest, mcpClaims['https://clearthedocket.com/oauth/grant']],
    ]),
  );
  expect((await readOrganizations(restTokens.accessToken)).status).toBe(200);
  expect((await readOrganizations(mcpTokens.accessToken)).status).toBe(401);
});
