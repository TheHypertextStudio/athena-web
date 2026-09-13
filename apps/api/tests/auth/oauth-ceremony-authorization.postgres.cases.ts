import { createHash, randomUUID } from 'node:crypto';

import { expect, it } from 'vitest';

import {
  CookieJar,
  cimdDocuments,
  controlA,
  controlB,
  createRecoveryUser,
  jsonRequest,
  origin,
  redirectTarget,
  registerPublicClient,
  required,
  request,
  sessionCookies,
  waitForBlockedBackends,
  type IssuedTokens,
} from './oauth-ceremony.postgres.runtime';
import {
  authorizationCode,
  decodeAccessClaims,
  exchangeCode,
  exchangeCodeResponse,
  refreshTokens,
} from './oauth-ceremony.postgres.protocol';

it('rechecks REST client policy inside the post-login authorization resume', async () => {
  const identity = await createRecoveryUser('Post-login OAuth owner');
  const client = await registerPublicClient();
  const cookies = new CookieJar();
  const verifier = 'post-login-verifier-000000000000000000000000000000000000';
  const state = `post-login-${randomUUID()}`;
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
  const started = await request(
    `/api/auth/oauth2/authorize?${query.toString()}`,
    { headers: { accept: 'text/html' } },
    cookies,
  );
  const startedText = await started.clone().text();
  expect([200, 302], startedText).toContain(started.status);
  const startTarget =
    started.status === 302
      ? started.headers.get('location')
      : ((JSON.parse(startedText) as { url?: string }).url ?? null);
  const signInTarget = new URL(startTarget ?? '', origin);
  expect(signInTarget.pathname).toBe('/sign-in');

  const challenge = await jsonRequest(
    '/api/auth/two-factor/recovery-challenge',
    { email: identity.email },
    cookies,
  );
  expect(challenge.status, await challenge.clone().text()).toBe(200);
  await controlB`
      update oauth_client set skip_consent = true where client_id = ${client.clientId}
    `;
  const verified = await jsonRequest(
    '/api/auth/two-factor/verify-backup-code',
    { code: identity.code, oauth_query: signInTarget.search.slice(1) },
    cookies,
  );
  expect(verified.status).toBe(400);
  expect(await verified.json()).toMatchObject({ error: 'unauthorized_client' });
  const [codes] = await controlB<{ total: number }[]>`
      select count(*)::int as total from verification
      where value like ${`%${state}%`}
    `;
  expect(codes?.total).toBe(0);
});

it('waits for the client row lock before completing a post-login authorization', async () => {
  const identity = await createRecoveryUser('Locked post-login OAuth owner');
  const client = await registerPublicClient();
  const cookies = new CookieJar();
  const verifier = 'locked-post-login-verifier-0000000000000000000000000000000';
  const state = `locked-post-login-${randomUUID()}`;
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
  const started = await request(
    `/api/auth/oauth2/authorize?${query.toString()}`,
    { headers: { accept: 'text/html' } },
    cookies,
  );
  const signInTarget = await redirectTarget(started);
  expect(signInTarget.pathname).toBe('/sign-in');
  const challenge = await jsonRequest(
    '/api/auth/two-factor/recovery-challenge',
    { email: identity.email },
    cookies,
  );
  expect(challenge.status, await challenge.clone().text()).toBe(200);

  let completion: Promise<Response> | undefined;
  await controlA.begin(async (locked) => {
    await locked`select client_id from oauth_client where client_id = ${client.clientId} for update`;
    completion = jsonRequest(
      '/api/auth/two-factor/verify-backup-code',
      { code: identity.code, oauth_query: signInTarget.search.slice(1) },
      cookies,
    );
    await waitForBlockedBackends(controlB, 1);
    await locked`
        update oauth_client set skip_consent = true where client_id = ${client.clientId}
      `;
  });

  const verified = await required(completion, 'The locked authorization did not complete.');
  expect(verified.status, await verified.clone().text()).toBe(400);
  expect(await verified.json()).toMatchObject({ error: 'unauthorized_client' });
  const [codes] = await controlB<{ total: number }[]>`
      select count(*)::int as total from verification
      where value like ${`%${state}%`}
    `;
  expect(codes?.total).toBe(0);
});

it('resumes a valid post-login authorization and exchanges its code', async () => {
  const { db, oauthConsent } = await import('@docket/db');
  const identity = await createRecoveryUser('Positive post-login OAuth owner');
  const client = await registerPublicClient();
  const cookies = new CookieJar();
  const verifier = 'positive-post-login-verifier-000000000000000000000000000000';
  const state = `positive-post-login-${randomUUID()}`;
  const resource = `${origin}/v1`;
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: client.clientId,
    redirect_uri: 'http://127.0.0.1/callback',
    scope: 'work:read offline_access',
    resource,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    state,
  });
  const started = await request(
    `/api/auth/oauth2/authorize?${query.toString()}`,
    { headers: { accept: 'text/html' } },
    cookies,
  );
  const signInTarget = await redirectTarget(started);
  expect(signInTarget.pathname).toBe('/sign-in');
  expect(signInTarget.searchParams.get('sig')).toEqual(expect.any(String));
  await db.insert(oauthConsent).values({
    id: `positive-post-login-consent-${randomUUID()}`,
    clientId: client.clientId,
    userId: identity.userId,
    scopes: ['work:read', 'offline_access'],
  });
  const challenge = await jsonRequest(
    '/api/auth/two-factor/recovery-challenge',
    { email: identity.email },
    cookies,
  );
  expect(challenge.status, await challenge.clone().text()).toBe(200);
  const verified = await jsonRequest(
    '/api/auth/two-factor/verify-backup-code',
    { code: identity.code, oauth_query: signInTarget.search.slice(1) },
    cookies,
  );
  const verifiedText = await verified.text();
  expect(verified.status, verifiedText).toBe(200);
  const body = JSON.parse(verifiedText) as { url?: unknown };
  expect(body.url).toEqual(expect.any(String));
  const callback = new URL(body.url as string);
  expect(callback.searchParams.get('state')).toBe(state);
  const code = callback.searchParams.get('code');
  expect(code).toEqual(expect.any(String));

  const tokens = await exchangeCode(client, { code: code ?? '', verifier }, resource);
  expect(decodeAccessClaims(tokens.accessToken)).toMatchObject({
    aud: resource,
    azp: client.clientId,
    sub: identity.userId,
  });
});

it('keeps a disabled CIMD client disabled across authorize preflight refresh', async () => {
  const { db, oauthClient } = await import('@docket/db');
  const clientId = `https://oauth-client.example/${randomUUID()}.json`;
  const redirectUri = 'http://127.0.0.1/callback';
  cimdDocuments.set(clientId, {
    client_id: clientId,
    client_name: 'PostgreSQL CIMD client',
    redirect_uris: [redirectUri],
    token_endpoint_auth_method: 'none',
  });
  const client = { clientId };
  const mcpResource = `${origin}/mcp`;
  const ceremony = await authorizationCode(client, mcpResource, 'cimd-live', true);
  const tokens = await exchangeCode(client, ceremony, mcpResource);
  await db
    .update(oauthClient)
    .set({ disabled: true })
    .where((await import('drizzle-orm')).eq(oauthClient.clientId, clientId));

  const query = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'work:read offline_access',
    resource: mcpResource,
    code_challenge: createHash('sha256')
      .update('disabled-cimd-verifier-0000000000000000000000000000000000')
      .digest('base64url'),
    code_challenge_method: 'S256',
    state: 'disabled-cimd',
  });
  const authorize = await request(
    `/api/auth/oauth2/authorize?${query.toString()}`,
    { headers: { accept: 'text/html' } },
    sessionCookies,
  );
  const failure = await redirectTarget(authorize);
  expect(failure.searchParams.get('error')).toBe('client_disabled');
  const [stored] = await db
    .select({ disabled: oauthClient.disabled })
    .from(oauthClient)
    .where((await import('drizzle-orm')).eq(oauthClient.clientId, clientId));
  expect(stored?.disabled).toBe(true);

  const rejected = await request('/mcp', {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${tokens.accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 17, method: 'initialize', params: {} }),
  });
  expect(rejected.status).toBe(401);
});

it('rolls back a failed refresh insert and keeps the predecessor redeemable', async () => {
  const client = await registerPublicClient();
  const resource = `${origin}/v1`;
  const code = await authorizationCode(client, resource, 'refresh-rollback', true);
  const initial = await exchangeCode(client, code, resource);
  const initialDigest = createHash('sha256').update(initial.refreshToken).digest('base64url');
  const [before] = await controlB<
    { grantExpiresAt: Date; refreshExpiresAt: Date; revoked: Date | null }[]
  >`
      select resource_grant.expires_at as "grantExpiresAt",
             refresh.expires_at as "refreshExpiresAt",
             refresh.revoked
      from oauth_refresh_token refresh
      join oauth_resource_grant resource_grant on resource_grant.id = refresh.docket_grant_id
      where refresh.token = ${initialDigest}
    `;
  expect(before).toBeDefined();
  await controlB.unsafe(`
      create function docket_test_reject_refresh() returns trigger language plpgsql as $$
      begin raise exception 'injected refresh failure'; end;
      $$;
      create trigger docket_test_reject_refresh before insert on oauth_refresh_token
      for each row execute function docket_test_reject_refresh();
    `);
  let failed: { readonly response: Response; readonly tokens?: IssuedTokens };
  try {
    failed = await refreshTokens(client, initial.refreshToken, resource);
  } finally {
    await controlB.unsafe(`
        drop trigger if exists docket_test_reject_refresh on oauth_refresh_token;
        drop function if exists docket_test_reject_refresh();
      `);
  }
  expect(
    required(failed, 'The injected refresh failure did not return a response.').response.status,
  ).toBe(500);
  const [after] = await controlB<
    { descendants: number; grantExpiresAt: Date; refreshExpiresAt: Date; revoked: Date | null }[]
  >`
      select resource_grant.expires_at as "grantExpiresAt",
             refresh.expires_at as "refreshExpiresAt",
             refresh.revoked,
             (
               select count(*)::int from oauth_refresh_token child
               where child.docket_grant_id = resource_grant.id
             ) as descendants
      from oauth_refresh_token refresh
      join oauth_resource_grant resource_grant on resource_grant.id = refresh.docket_grant_id
      where refresh.token = ${initialDigest}
    `;
  expect(after).toEqual({ ...before, descendants: 1 });
  const retried = await refreshTokens(client, initial.refreshToken, resource);
  expect(retried.response.status, await retried.response.clone().text()).toBe(200);
  expect(retried.tokens?.accessToken).toEqual(expect.any(String));
});

const LATE_DOCKET_FAILURES = [
  [
    'returned refresh binding',
    `
        create function docket_test_reject_docket_binding() returns trigger language plpgsql as $$
        begin raise exception 'injected Docket binding failure'; end;
        $$;
        create trigger docket_test_reject_docket_binding before update on oauth_refresh_token
        for each row when (old.docket_grant_id is null and new.docket_grant_id is not null)
        execute function docket_test_reject_docket_binding();
      `,
    `
        drop trigger if exists docket_test_reject_docket_binding on oauth_refresh_token;
        drop function if exists docket_test_reject_docket_binding();
      `,
  ],
  [
    'grant deadline extension',
    `
        create function docket_test_reject_grant_deadline() returns trigger language plpgsql as $$
        begin raise exception 'injected Docket deadline failure'; end;
        $$;
        create trigger docket_test_reject_grant_deadline before update on oauth_resource_grant
        for each row when (old.expires_at is distinct from new.expires_at)
        execute function docket_test_reject_grant_deadline();
      `,
    `
        drop trigger if exists docket_test_reject_grant_deadline on oauth_resource_grant;
        drop function if exists docket_test_reject_grant_deadline();
      `,
  ],
] as const;

it.each(LATE_DOCKET_FAILURES)(
  'rolls back a late %s failure and restores the authorization code',
  async (label, installFailure, removeFailure) => {
    const client = await registerPublicClient();
    const resource = `${origin}/v1`;
    const ceremony = await authorizationCode(
      client,
      resource,
      `late-docket-${label.replaceAll(' ', '-')}`,
      true,
    );
    const identifier = createHash('sha256').update(ceremony.code).digest('base64url');
    await controlB.unsafe(installFailure);
    let failed: Response;
    try {
      failed = await exchangeCodeResponse(client, ceremony, resource);
    } finally {
      await controlB.unsafe(removeFailure);
    }
    expect(required(failed, 'The injected Docket failure did not return a response.').status).toBe(
      500,
    );
    const [rolledBack] = await controlB<{ codes: number; grants: number; refreshes: number }[]>`
        select
          (select count(*)::int from verification where identifier = ${identifier}) as codes,
          (select count(*)::int from oauth_resource_grant where client_id = ${client.clientId}) as grants,
          (select count(*)::int from oauth_refresh_token where client_id = ${client.clientId}) as refreshes
      `;
    expect(rolledBack).toEqual({ codes: 1, grants: 0, refreshes: 0 });
    const retry = await exchangeCode(client, ceremony, resource);
    expect(typeof retry.accessToken).toBe('string');
    expect(typeof retry.refreshToken).toBe('string');
  },
);

it.each(LATE_DOCKET_FAILURES)(
  'rolls back a refresh %s failure and keeps the predecessor redeemable',
  async (label, installFailure, removeFailure) => {
    const client = await registerPublicClient();
    const resource = `${origin}/v1`;
    const code = await authorizationCode(
      client,
      resource,
      `refresh-late-${label.replaceAll(' ', '-')}`,
      true,
    );
    const initial = await exchangeCode(client, code, resource);
    const digest = createHash('sha256').update(initial.refreshToken).digest('base64url');
    if (label === 'grant deadline extension') {
      await controlB`
          update oauth_resource_grant
          set expires_at = current_timestamp + interval '5 minutes'
          where id = (
            select docket_grant_id from oauth_refresh_token where token = ${digest}
          )
        `;
    }
    const [before] = await controlB<
      { descendants: number; grantExpiresAt: Date; revoked: Date | null }[]
    >`
        select resource_grant.expires_at as "grantExpiresAt", refresh.revoked,
          (select count(*)::int from oauth_refresh_token child
           where child.docket_grant_id = resource_grant.id) as descendants
        from oauth_refresh_token refresh
        join oauth_resource_grant resource_grant
          on resource_grant.id = refresh.docket_grant_id
        where refresh.token = ${digest}
      `;
    await controlB.unsafe(installFailure);
    let failed: Awaited<ReturnType<typeof refreshTokens>> | undefined;
    try {
      failed = await refreshTokens(client, initial.refreshToken, resource);
    } finally {
      await controlB.unsafe(removeFailure);
    }
    expect(required(failed, 'The late refresh failure returned no response.').response.status).toBe(
      500,
    );
    const [after] = await controlB<
      { descendants: number; grantExpiresAt: Date; revoked: Date | null }[]
    >`
        select resource_grant.expires_at as "grantExpiresAt", refresh.revoked,
          (select count(*)::int from oauth_refresh_token child
           where child.docket_grant_id = resource_grant.id) as descendants
        from oauth_refresh_token refresh
        join oauth_resource_grant resource_grant
          on resource_grant.id = refresh.docket_grant_id
        where refresh.token = ${digest}
      `;
    expect(after).toEqual(before);
    const retry = await refreshTokens(client, initial.refreshToken, resource);
    expect(retry.response.status, await retry.response.clone().text()).toBe(200);
  },
);
