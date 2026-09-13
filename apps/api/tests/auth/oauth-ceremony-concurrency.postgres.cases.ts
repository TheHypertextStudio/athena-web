import { createHash } from 'node:crypto';

import { expect, it } from 'vitest';

import {
  controlA,
  controlB,
  jsonRequest,
  origin,
  raceBehindClientLock,
  registerConfidentialClient,
  registerPublicClient,
  request,
  required,
  sessionCookies,
  setActiveOAuthAdapterTrace,
  userId,
  waitForBlockedBackends,
  type IssuedTokens,
  type OAuthAdapterTraceEntry,
} from './oauth-ceremony.postgres.runtime';
import {
  authorizationCode,
  decodeAccessClaims,
  exchangeCode,
  exchangeCodeResponse,
  initializeMcp,
  introspectToken,
  readOrganizations,
  refreshTokens,
  signClaimlessMcpToken,
} from './oauth-ceremony.postgres.protocol';

async function installTransactionTrace(): Promise<void> {
  await controlB`delete from jwks`;
  await controlB.unsafe(`
    create table docket_test_oauth_transaction_trace (
      event text not null, backend_pid integer not null, transaction_id bigint not null
    );
    create function docket_test_trace_oauth_write() returns trigger language plpgsql as $$
    begin
      insert into docket_test_oauth_transaction_trace(event, backend_pid, transaction_id)
      values (TG_TABLE_NAME || ':' || TG_OP, pg_backend_pid(), txid_current());
      if TG_OP = 'DELETE' then return OLD; end if;
      return NEW;
    end;
    $$;
    create trigger docket_test_trace_verification_delete
      after delete on verification for each row execute function docket_test_trace_oauth_write();
    create trigger docket_test_trace_grant_write
      after insert or update on oauth_resource_grant for each row execute function docket_test_trace_oauth_write();
    create trigger docket_test_trace_refresh_write
      after insert or update on oauth_refresh_token for each row execute function docket_test_trace_oauth_write();
    create trigger docket_test_trace_jwks_insert
      after insert on jwks for each row execute function docket_test_trace_oauth_write();
  `);
}

async function resetTransactionTrace(): Promise<void> {
  await controlB`truncate docket_test_oauth_transaction_trace`;
}

async function removeTransactionTrace(): Promise<void> {
  await controlB.unsafe(`
    drop trigger if exists docket_test_trace_verification_delete on verification;
    drop trigger if exists docket_test_trace_grant_write on oauth_resource_grant;
    drop trigger if exists docket_test_trace_refresh_write on oauth_refresh_token;
    drop trigger if exists docket_test_trace_jwks_insert on jwks;
    drop function if exists docket_test_trace_oauth_write();
    drop table if exists docket_test_oauth_transaction_trace;
  `);
}

async function assertWriteTrace(expectedEvents: readonly string[]): Promise<void> {
  const rows = await controlB<{ event: string; backendPid: number; transactionId: string }[]>`
    select event, backend_pid::int as "backendPid", transaction_id::text as "transactionId"
    from docket_test_oauth_transaction_trace order by event
  `;
  expect(new Set(rows.map((row) => row.backendPid)).size).toBe(1);
  expect(new Set(rows.map((row) => row.transactionId)).size).toBe(1);
  expect(rows.map((row) => row.event)).toEqual(expect.arrayContaining([...expectedEvents]));
}

function assertAdapterTrace(
  trace: readonly OAuthAdapterTraceEntry[],
  models: readonly string[],
): void {
  expect(trace.some((entry) => entry.kind === 'base')).toBe(false);
  for (const model of models) {
    expect(
      trace.some((entry) => entry.model === model && entry.method.startsWith('find')),
      `missing transaction-bound ${model} read`,
    ).toBe(true);
  }
  expect(
    new Set(trace.filter((entry) => entry.kind === 'transaction').map((entry) => entry.adapter))
      .size,
  ).toBe(1);
}

it('routes provider and Docket issuance writes through one PostgreSQL transaction child', async () => {
  const client = await registerPublicClient();
  const resource = `${origin}/v1`;
  const ceremony = await authorizationCode(client, resource, 'transaction-trace', true);
  const trace: OAuthAdapterTraceEntry[] = [];
  await installTransactionTrace();
  setActiveOAuthAdapterTrace(trace);
  try {
    const tokens = await exchangeCode(client, ceremony, resource);
    await assertWriteTrace([
      'jwks:INSERT',
      'oauth_refresh_token:INSERT',
      'oauth_refresh_token:UPDATE',
      'oauth_resource_grant:INSERT',
      'verification:DELETE',
    ]);
    assertAdapterTrace(trace, [
      'jwks',
      'oauthClient',
      'oauthRefreshToken',
      'oauthResourceGrant',
      'session',
      'user',
      'verification',
    ]);
    trace.length = 0;
    await resetTransactionTrace();
    const grantId = decodeAccessClaims(tokens.accessToken)[
      'https://clearthedocket.com/oauth/grant'
    ];
    await controlB`
      update oauth_resource_grant
      set expires_at = current_timestamp + interval '5 minutes'
      where id = ${grantId}
    `;
    await resetTransactionTrace();
    const descendant = await refreshTokens(client, tokens.refreshToken, resource);
    expect(descendant.response.status, await descendant.response.clone().text()).toBe(200);
    expect(descendant.tokens?.accessToken).toEqual(expect.any(String));
    await assertWriteTrace([
      'oauth_refresh_token:INSERT',
      'oauth_refresh_token:UPDATE',
      'oauth_resource_grant:UPDATE',
    ]);
    assertAdapterTrace(trace, ['oauthClient', 'oauthRefreshToken', 'oauthResourceGrant', 'user']);
  } finally {
    setActiveOAuthAdapterTrace(null);
    await removeTransactionTrace();
  }
});

it('serializes two rotations of the same refresh token and revokes a replayed family', async () => {
  const client = await registerPublicClient();
  const resource = `${origin}/v1`;
  const code = await authorizationCode(client, resource, 'parallel-refresh', true);
  const initial = await exchangeCode(client, code, resource);

  const [first, second] = await raceBehindClientLock(client.clientId, () => [
    refreshTokens(client, initial.refreshToken, resource),
    refreshTokens(client, initial.refreshToken, resource),
  ]);
  if (!first || !second) {
    throw new Error('Both concurrent refresh attempts must return a response.');
  }
  const results = [first, second].sort(
    (left, right) => left.response.status - right.response.status,
  );
  expect(results.map((result) => result.response.status)).toEqual([200, 400]);
  const failed = required(results[1], 'The refresh race did not return a failed request.');
  expect(await failed.response.json()).toMatchObject({ error: 'invalid_grant' });
  const issued = required(
    results[0],
    'The refresh race did not return a successful request.',
  ).tokens;
  if (!issued) throw new Error('The successful refresh attempt must return credentials.');

  const { db, oauthRefreshToken, oauthResourceGrant } = await import('@docket/db');
  const { eq } = await import('drizzle-orm');
  const grantId = decodeAccessClaims(initial.accessToken)['https://clearthedocket.com/oauth/grant'];
  const [grant] = await db
    .select({ revokedAt: oauthResourceGrant.revokedAt })
    .from(oauthResourceGrant)
    .where(eq(oauthResourceGrant.id, grantId));
  expect(grant?.revokedAt).toBeInstanceOf(Date);
  const refreshRows = await db
    .select({ token: oauthRefreshToken.token, revoked: oauthRefreshToken.revoked })
    .from(oauthRefreshToken)
    .where(eq(oauthRefreshToken.docketGrantId, grantId));
  expect(refreshRows).toHaveLength(2);
  const unrevokedRows = refreshRows.filter(({ revoked }) => revoked === null);
  expect(unrevokedRows).toEqual([]);
  const issuedDigest = createHash('sha256').update(issued.refreshToken).digest('base64url');
  expect(refreshRows.find(({ token }) => token === issuedDigest)?.revoked).toBeInstanceOf(Date);
  expect((await readOrganizations(initial.accessToken)).status).toBe(401);
  expect((await readOrganizations(issued.accessToken)).status).toBe(401);
  const descendantReplay = await refreshTokens(client, issued.refreshToken, resource);
  expect(descendantReplay.response.status).toBe(400);
  expect(await descendantReplay.response.json()).toMatchObject({ error: 'invalid_grant' });
});

it('rolls back provider-wide replay revocation before invalidating one PostgreSQL grant family', async () => {
  const client = await registerPublicClient();
  const resource = `${origin}/v1`;
  const firstCode = await authorizationCode(client, resource, 'pg-replay-first', true);
  const first = await exchangeCode(client, firstCode, resource);
  const siblingCode = await authorizationCode(client, resource, 'pg-replay-sibling', false);
  const sibling = await exchangeCode(client, siblingCode, resource);
  const firstGrantId = decodeAccessClaims(first.accessToken)[
    'https://clearthedocket.com/oauth/grant'
  ];
  const siblingGrantId = decodeAccessClaims(sibling.accessToken)[
    'https://clearthedocket.com/oauth/grant'
  ];
  expect(firstGrantId).not.toBe(siblingGrantId);

  const rotated = await refreshTokens(client, first.refreshToken, resource);
  expect(rotated.response.status, await rotated.response.clone().text()).toBe(200);
  const replayed = await refreshTokens(client, first.refreshToken, resource);
  expect(replayed.response.status, await replayed.response.clone().text()).toBe(400);
  expect(await replayed.response.json()).toMatchObject({ error: 'invalid_grant' });

  const grants = await controlB<{ id: string; revokedAt: Date | null }[]>`
      select id, revoked_at as "revokedAt"
      from oauth_resource_grant
      where id in (${firstGrantId}, ${siblingGrantId})
      order by id
    `;
  const byId = new Map(grants.map((grant) => [grant.id, grant.revokedAt]));
  expect(byId.get(firstGrantId)).toBeInstanceOf(Date);
  expect(byId.get(siblingGrantId)).toBeNull();
  expect((await readOrganizations(first.accessToken)).status).toBe(401);
  expect((await readOrganizations(sibling.accessToken)).status).toBe(200);
  const siblingRotation = await refreshTokens(client, sibling.refreshToken, resource);
  expect(siblingRotation.response.status, await siblingRotation.response.clone().text()).toBe(200);
  expect(siblingRotation.tokens?.accessToken).toEqual(expect.any(String));
});

it('leaves no credential live when refresh races connected-app deletion', async () => {
  const client = await registerPublicClient();
  const resource = `${origin}/v1`;
  const code = await authorizationCode(client, resource, 'refresh-delete-race', true);
  const initial = await exchangeCode(client, code, resource);

  const [refreshResponse, deleteResponse] = await raceBehindClientLock(client.clientId, () => [
    refreshTokens(client, initial.refreshToken, resource).then((result) => result.response),
    request(
      `/v1/me/connected-apps/${client.clientId}`,
      { method: 'DELETE', headers: { accept: 'application/json' } },
      sessionCookies,
    ),
  ]);
  expect(deleteResponse?.status, await deleteResponse?.clone().text()).toBe(200);
  expect([200, 400]).toContain(refreshResponse?.status);
  let returnedAccess: string | undefined;
  let returnedRefresh: string | undefined;
  if (refreshResponse?.status === 200) {
    const body = (await refreshResponse.json()) as {
      access_token: string;
      refresh_token: string;
    };
    returnedAccess = body.access_token;
    returnedRefresh = body.refresh_token;
  }

  expect((await readOrganizations(initial.accessToken)).status).toBe(401);
  if (returnedAccess) expect((await readOrganizations(returnedAccess)).status).toBe(401);
  const retried = await refreshTokens(client, returnedRefresh ?? initial.refreshToken, resource);
  expect(retried.response.status).toBe(400);
  const [counts] = await controlB<{ consents: number; grants: number; refreshes: number }[]>`
      select
        (select count(*)::int from oauth_consent where client_id = ${client.clientId}) as consents,
        (select count(*)::int from oauth_resource_grant where client_id = ${client.clientId}) as grants,
        (select count(*)::int from oauth_refresh_token where client_id = ${client.clientId}) as refreshes
    `;
  expect(counts).toEqual({ consents: 0, grants: 0, refreshes: 0 });
});

it('leaves no grant live when code exchange races consent deletion', async () => {
  const client = await registerPublicClient();
  const resource = `${origin}/v1`;
  const code = await authorizationCode(client, resource, 'code-consent-race', true);
  const [consent] = await controlB<{ id: string }[]>`
      select id from oauth_consent where client_id = ${client.clientId} and user_id = ${userId}
    `;
  expect(consent?.id).toEqual(expect.any(String));

  const [exchange, deletion] = await raceBehindClientLock(client.clientId, () => [
    exchangeCodeResponse(client, code, resource),
    jsonRequest(
      '/api/auth/oauth2/delete-consent',
      { id: required(consent, 'The race consent was not stored.').id },
      sessionCookies,
    ),
  ]);
  expect(deletion?.status, await deletion?.clone().text()).toBe(200);
  expect([200, 400]).toContain(exchange?.status);
  if (exchange?.status === 200) {
    const body = (await exchange.json()) as { access_token: string };
    expect((await readOrganizations(body.access_token)).status).toBe(401);
  } else {
    expect(await exchange?.json()).toMatchObject({ error: 'invalid_grant' });
  }
  const [counts] = await controlB<{ consents: number; grants: number; refreshes: number }[]>`
      select
        (select count(*)::int from oauth_consent where client_id = ${client.clientId}) as consents,
        (select count(*)::int from oauth_resource_grant where client_id = ${client.clientId}) as grants,
        (select count(*)::int from oauth_refresh_token where client_id = ${client.clientId}) as refreshes
    `;
  expect(counts).toEqual({ consents: 0, grants: 0, refreshes: 0 });
});

it('serializes trusted claimless-token adoption and retains a revocation tombstone', async () => {
  const { db, oauthClient } = await import('@docket/db');
  const { eq } = await import('drizzle-orm');
  const adoptionClient = await registerConfidentialClient();
  const adoptionCutoff = new Date();
  await db
    .update(oauthClient)
    .set({
      skipConsent: true,
      docketLegacyBefore: adoptionCutoff,
      docketLegacyTrusted: true,
    })
    .where(eq(oauthClient.clientId, adoptionClient.clientId));
  const adoptionTokens = await Promise.all([
    signClaimlessMcpToken(adoptionClient.clientId, userId, adoptionCutoff),
    signClaimlessMcpToken(adoptionClient.clientId, userId, adoptionCutoff),
  ]);

  const adopted = await raceBehindClientLock(adoptionClient.clientId, () =>
    adoptionTokens.map((token) => introspectToken(adoptionClient, token)),
  );
  for (const response of adopted) {
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toMatchObject({
      active: true,
      aud: `${origin}/mcp`,
      client_id: adoptionClient.clientId,
      sub: userId,
    });
  }
  for (const token of adoptionTokens) {
    expect((await initializeMcp(token)).status).toBe(200);
  }
  const [adoptionState] = await controlB<{ grants: number; revoked: number }[]>`
      select count(*)::int as grants,
             count(*) filter (where revoked_at is not null)::int as revoked
      from oauth_resource_grant
      where client_id = ${adoptionClient.clientId} and user_id = ${userId}
    `;
  expect(adoptionState).toEqual({ grants: 1, revoked: 0 });

  const revokeClient = await registerConfidentialClient();
  const revokeCutoff = new Date();
  await db
    .update(oauthClient)
    .set({
      skipConsent: true,
      docketLegacyBefore: revokeCutoff,
      docketLegacyTrusted: true,
    })
    .where(eq(oauthClient.clientId, revokeClient.clientId));
  const revokeTokens = await Promise.all([
    signClaimlessMcpToken(revokeClient.clientId, userId, revokeCutoff),
    signClaimlessMcpToken(revokeClient.clientId, userId, revokeCutoff),
  ]);
  const [introspection, deletion] = await raceBehindClientLock(revokeClient.clientId, () => [
    introspectToken(revokeClient, revokeTokens[0]),
    request(
      `/v1/me/connected-apps/${revokeClient.clientId}`,
      { method: 'DELETE', headers: { accept: 'application/json' } },
      sessionCookies,
    ),
  ]);
  expect(introspection?.status, await introspection?.clone().text()).toBe(200);
  expect([true, false]).toContain(((await introspection?.json()) as { active?: unknown }).active);
  expect(deletion?.status, await deletion?.clone().text()).toBe(200);
  const [revokedState] = await controlB<{ grants: number; revoked: number }[]>`
      select count(*)::int as grants,
             count(*) filter (where revoked_at is not null)::int as revoked
      from oauth_resource_grant
      where client_id = ${revokeClient.clientId} and user_id = ${userId}
    `;
  expect(revokedState).toEqual({ grants: 1, revoked: 1 });
  for (const token of revokeTokens) {
    expect((await initializeMcp(token)).status).toBe(401);
    const inactive = await introspectToken(revokeClient, token);
    expect(inactive.status, await inactive.clone().text()).toBe(200);
    expect(await inactive.json()).toEqual({ active: false });
  }
});

it('lets cleanup win a refresh race without returning an orphan credential', async () => {
  const { sweepOAuthLifecycle } = await import('@docket/auth');
  const client = await registerPublicClient();
  const resource = `${origin}/v1`;
  const code = await authorizationCode(client, resource, 'cleanup-refresh-race', true);
  const initial = await exchangeCode(client, code, resource);
  const grantId = decodeAccessClaims(initial.accessToken)['https://clearthedocket.com/oauth/grant'];
  await controlB`
      update oauth_resource_grant
      set created_at = now() - interval '2 seconds',
          expires_at = now() - interval '1 second'
      where id = ${grantId}
    `;

  let refresh: Promise<{ readonly response: Response; readonly tokens?: IssuedTokens }> | undefined;
  await controlA.begin(async (locked) => {
    await locked`select client_id from oauth_client where client_id = ${client.clientId} for update`;
    refresh = refreshTokens(client, initial.refreshToken, resource);
    await waitForBlockedBackends(controlB, 1);
    await expect(sweepOAuthLifecycle(new Date(), 10)).resolves.toMatchObject({
      grantsDeleted: 1,
    });
  });
  const result = await required(refresh, 'The cleanup race did not start a refresh.');
  expect(result.response.status).toBe(400);
  expect(await result.response.json()).toMatchObject({ error: 'invalid_grant' });
  expect((await readOrganizations(initial.accessToken)).status).toBe(401);
  const [counts] = await controlB<{ grants: number; refreshes: number }[]>`
      select
        (select count(*)::int from oauth_resource_grant where id = ${grantId}) as grants,
        (select count(*)::int from oauth_refresh_token where docket_grant_id = ${grantId}) as refreshes
    `;
  expect(counts).toEqual({ grants: 0, refreshes: 0 });
});

it('rolls back late JWKS failure and leaves the authorization code redeemable', async () => {
  const client = await registerPublicClient();
  const resource = `${origin}/v1`;
  const ceremony = await authorizationCode(client, resource, 'jwks-rollback', true);
  const identifier = createHash('sha256').update(ceremony.code).digest('base64url');
  await controlB`delete from jwks`;
  await controlB.unsafe(`
      create function docket_test_reject_jwks() returns trigger language plpgsql as $$
      begin raise exception 'injected JWKS failure'; end;
      $$;
      create trigger docket_test_reject_jwks before insert on jwks
      for each row execute function docket_test_reject_jwks();
    `);
  let failed: Response;
  try {
    failed = await exchangeCodeResponse(client, ceremony, resource);
  } finally {
    await controlB.unsafe(`
        drop trigger if exists docket_test_reject_jwks on jwks;
        drop function if exists docket_test_reject_jwks();
      `);
  }
  expect(required(failed, 'The injected JWKS failure did not return a response.').status).toBe(500);
  const [rolledBack] = await controlB<{ codes: number; grants: number; refreshes: number }[]>`
      select
        (select count(*)::int from verification where identifier = ${identifier}) as codes,
        (select count(*)::int from oauth_resource_grant where client_id = ${client.clientId}) as grants,
        (select count(*)::int from oauth_refresh_token where client_id = ${client.clientId}) as refreshes
    `;
  expect(rolledBack).toEqual({ codes: 1, grants: 0, refreshes: 0 });
  const retry = await exchangeCode(client, ceremony, resource);
  expect(typeof retry.accessToken).toBe('string');
});
