import { createHash, randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  authRequest,
  registerConfidentialClient,
  signInWithRecoveryCode,
} from './oauth-provider-handler.support';

type ConsentPolicyMutation =
  'disabled' | 'deleted' | 'grant' | 'redirect' | 'scope' | 'pkce' | 'skipConsent';

function consentPolicyClientUpdate(
  mutation: Exclude<ConsentPolicyMutation, 'deleted'>,
): Record<string, unknown> {
  const updates: Record<Exclude<ConsentPolicyMutation, 'deleted'>, Record<string, unknown>> = {
    disabled: { disabled: true },
    grant: { grantTypes: ['refresh_token'] },
    redirect: { redirectUris: ['http://127.0.0.1/changed-callback'] },
    scope: { scopes: ['work:write', 'offline_access'] },
    pkce: { requirePKCE: true },
    skipConsent: { skipConsent: true },
  };
  return updates[mutation];
}

describe('Docket OAuth provider handler preservation', () => {
  it('rolls the accepted-consent authorization probe back before issuing the real code', async () => {
    const { db, oauthConsent, verification } = await import('@docket/db');
    const owner = await signInWithRecoveryCode();
    const client = await registerConfidentialClient(owner.cookie);
    const verifier = `consent-probe-${randomUUID()}-000000000000000000000000000`;
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: client.clientId,
      redirect_uri: 'http://127.0.0.1/callback',
      scope: 'work:read offline_access',
      resource: 'http://localhost:4000/v1',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      state: `consent-probe-${randomUUID()}`,
    });
    const authorize = await authRequest(`/oauth2/authorize?${query.toString()}`, {
      headers: { accept: 'text/html', cookie: owner.cookie },
    });
    const consentTarget = new URL(authorize.headers.get('location') ?? '');
    expect(consentTarget.pathname).toBe('/oauth/authorize');
    await db.insert(oauthConsent).values({
      id: `consent-probe-${randomUUID()}`,
      clientId: client.clientId,
      userId: owner.userId,
      scopes: ['work:read', 'offline_access'],
      referenceId: null,
    });

    const resumed = await authRequest('/oauth2/consent', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: owner.cookie,
        origin: 'http://localhost:4000',
      },
      body: JSON.stringify({ accept: true, oauth_query: consentTarget.search.slice(1) }),
    });

    expect(resumed.status, await resumed.clone().text()).toBe(200);
    const body = (await resumed.json()) as { redirect?: unknown; url?: unknown };
    expect(body.redirect).toBe(true);
    const redirect = new URL(String(body.url));
    expect(redirect.searchParams.get('code')).toEqual(expect.any(String));
    const codeRows = (await db.select({ value: verification.value }).from(verification)).filter(
      ({ value }) => value.includes(client.clientId),
    );
    expect(codeRows).toHaveLength(1);
  });

  it.each([
    ['duplicate human consent', [null, null]],
    ['mixed human and reference consent', [null, 'workspace_1']],
  ] as const)('rejects a signed consent resume with %s', async (_label, referenceIds) => {
    const { db, oauthConsent, oauthRefreshToken, oauthResourceGrant, verification } =
      await import('@docket/db');
    const owner = await signInWithRecoveryCode();
    const client = await registerConfidentialClient(owner.cookie);
    const verifier = `consent-ambiguity-${randomUUID()}-000000000000000000000000`;
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: client.clientId,
      redirect_uri: 'http://127.0.0.1/callback',
      scope: 'work:read offline_access',
      resource: 'http://localhost:4000/v1',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      state: `consent-ambiguity-${randomUUID()}`,
    });
    const authorize = await authRequest(`/oauth2/authorize?${query.toString()}`, {
      headers: { accept: 'text/html', cookie: owner.cookie },
    });
    expect(authorize.status).toBe(302);
    const consentTarget = new URL(authorize.headers.get('location') ?? '');
    expect(consentTarget.pathname).toBe('/oauth/authorize');
    const consentRows = referenceIds.map((referenceId) => ({
      id: `ambiguous-consent-${randomUUID()}`,
      clientId: client.clientId,
      userId: owner.userId,
      scopes: ['work:read', 'offline_access'],
      referenceId,
    }));
    await db.insert(oauthConsent).values(consentRows);

    const resumed = await authRequest('/oauth2/consent', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: owner.cookie,
        origin: 'http://localhost:4000',
      },
      body: JSON.stringify({
        accept: true,
        oauth_query: consentTarget.search.slice(1),
      }),
    });

    expect(resumed.status).toBe(400);
    expect(await resumed.json()).toMatchObject({ error: 'invalid_grant' });
    const persistedConsents = await db
      .select({ id: oauthConsent.id, referenceId: oauthConsent.referenceId })
      .from(oauthConsent)
      .where(eq(oauthConsent.clientId, client.clientId));
    expect(persistedConsents).toEqual(
      consentRows.map(({ id, referenceId }) => ({ id, referenceId })),
    );
    const codeRows = (await db.select({ value: verification.value }).from(verification)).filter(
      ({ value }) => value.includes(client.clientId),
    );
    expect(codeRows).toEqual([]);
    await expect(
      db.select().from(oauthResourceGrant).where(eq(oauthResourceGrant.clientId, client.clientId)),
    ).resolves.toEqual([]);
    await expect(
      db.select().from(oauthRefreshToken).where(eq(oauthRefreshToken.clientId, client.clientId)),
    ).resolves.toEqual([]);
  });

  it('rejects ambiguous consent while resuming authorization through a new recovery session', async () => {
    const { auth, generateRecoveryCodes } = await import('../src/index');
    const {
      db,
      oauthClient,
      oauthConsent,
      oauthRefreshToken,
      oauthResourceGrant,
      user,
      verification,
    } = await import('@docket/db');
    const suffix = randomUUID();
    const email = `post-login-ambiguity-${suffix}@example.test`;
    const [owner] = await db
      .insert(user)
      .values({ name: 'Post-login ambiguity owner', email })
      .returning({ id: user.id });
    if (!owner) throw new Error('Failed to create the post-login ambiguity owner.');
    const recoveryCodes = await generateRecoveryCodes(owner.id);
    const clientId = `post-login-ambiguity-client-${suffix}`;
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
      skipConsent: false,
    });
    const state = `post-login-ambiguity-${randomUUID()}`;
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: 'http://127.0.0.1/callback',
      scope: 'work:read offline_access',
      resource: 'http://localhost:4000/v1',
      code_challenge: createHash('sha256')
        .update('post-login-ambiguity-verifier-000000000000000000000000')
        .digest('base64url'),
      code_challenge_method: 'S256',
      state,
    });
    const started = await authRequest(`/oauth2/authorize?${query.toString()}`, {
      headers: { accept: 'text/html' },
    });
    expect(started.status).toBe(302);
    const signInTarget = new URL(started.headers.get('location') ?? '');
    expect(signInTarget.pathname).toBe('/sign-in');
    expect(signInTarget.searchParams.get('sig')).toEqual(expect.any(String));
    const consentRows = [null, 'workspace_1'].map((referenceId) => ({
      id: `post-login-ambiguity-consent-${randomUUID()}`,
      clientId,
      userId: owner.id,
      scopes: ['work:read', 'offline_access'],
      referenceId,
    }));
    await db.insert(oauthConsent).values(consentRows);

    const armed = await auth.handler(
      new Request('http://localhost:4000/api/auth/two-factor/recovery-challenge', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:4000' },
        body: JSON.stringify({ email }),
      }),
    );
    expect(armed.status, await armed.clone().text()).toBe(200);
    const challengeCookie = armed.headers
      .getSetCookie()
      .map((entry) => entry.split(';')[0])
      .join('; ');
    const resumed = await auth.handler(
      new Request('http://localhost:4000/api/auth/two-factor/verify-backup-code', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: challengeCookie,
          origin: 'http://localhost:4000',
        },
        body: JSON.stringify({
          code: recoveryCodes[0],
          oauth_query: signInTarget.search.slice(1),
        }),
      }),
    );

    expect(resumed.status).toBe(400);
    expect(await resumed.json()).toMatchObject({ error: 'invalid_grant' });
    const persistedConsents = await db
      .select({ id: oauthConsent.id, referenceId: oauthConsent.referenceId })
      .from(oauthConsent)
      .where(eq(oauthConsent.clientId, clientId));
    expect(persistedConsents).toEqual(
      consentRows.map(({ id, referenceId }) => ({ id, referenceId })),
    );
    const codeRows = (await db.select({ value: verification.value }).from(verification)).filter(
      ({ value }) => value.includes(clientId),
    );
    expect(codeRows).toEqual([]);
    await expect(
      db.select().from(oauthResourceGrant).where(eq(oauthResourceGrant.clientId, clientId)),
    ).resolves.toEqual([]);
    await expect(
      db.select().from(oauthRefreshToken).where(eq(oauthRefreshToken.clientId, clientId)),
    ).resolves.toEqual([]);
  });

  it.each([
    ['disabled client', 'disabled', 'client_disabled', 200],
    ['deleted client', 'deleted', 'invalid_client', 200],
    ['removed authorization-code grant', 'grant', 'unauthorized_client', 200],
    ['changed redirect URI', 'redirect', 'invalid_redirect', 200],
    ['narrowed client scopes', 'scope', 'invalid_scope', 200],
    ['new PKCE requirement', 'pkce', 'invalid_request', 200],
    ['trusted-client policy', 'skipConsent', 'unauthorized_client', 400],
  ] as const)(
    'rolls back accepted consent when %s fails downstream authorization',
    async (_label, mutation, expectedError, expectedStatus) => {
      const { db, oauthClient, oauthConsent, oauthRefreshToken, oauthResourceGrant, verification } =
        await import('@docket/db');
      const owner = await signInWithRecoveryCode();
      const suffix = randomUUID();
      const clientId = `consent-policy-race-${suffix}`;
      const startsWithoutPkce = mutation === 'pkce';
      await db.insert(oauthClient).values({
        clientId,
        ...(startsWithoutPkce ? { clientSecret: `pkce-race-secret-${suffix}` } : {}),
        redirectUris: ['http://127.0.0.1/callback'],
        public: !startsWithoutPkce,
        type: startsWithoutPkce ? 'web' : 'public',
        requirePKCE: !startsWithoutPkce,
        tokenEndpointAuthMethod: startsWithoutPkce ? 'client_secret_post' : 'none',
        grantTypes: ['authorization_code', 'refresh_token'],
        responseTypes: ['code'],
        scopes: ['work:read', 'offline_access'],
        skipConsent: false,
      });
      const state = `consent-policy-race-${randomUUID()}`;
      const query = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: 'http://127.0.0.1/callback',
        scope: startsWithoutPkce ? 'work:read' : 'work:read offline_access',
        resource: 'http://localhost:4000/v1',
        state,
      });
      if (!startsWithoutPkce) {
        query.set(
          'code_challenge',
          createHash('sha256')
            .update('consent-policy-race-verifier-000000000000000000000000')
            .digest('base64url'),
        );
        query.set('code_challenge_method', 'S256');
      }
      const authorize = await authRequest(`/oauth2/authorize?${query.toString()}`, {
        headers: { accept: 'text/html', cookie: owner.cookie },
      });
      expect(authorize.status).toBe(302);
      const consentTarget = new URL(authorize.headers.get('location') ?? '');
      expect(consentTarget.pathname).toBe('/oauth/authorize');

      if (mutation === 'deleted') {
        await db.delete(oauthClient).where(eq(oauthClient.clientId, clientId));
      } else {
        await db
          .update(oauthClient)
          .set(consentPolicyClientUpdate(mutation))
          .where(eq(oauthClient.clientId, clientId));
      }

      const resumed = await authRequest('/oauth2/consent', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: owner.cookie,
          origin: 'http://localhost:4000',
        },
        body: JSON.stringify({
          accept: true,
          oauth_query: consentTarget.search.slice(1),
        }),
      });

      expect(resumed.status, await resumed.clone().text()).toBe(expectedStatus);
      const body = (await resumed.json()) as {
        error?: unknown;
        redirect?: unknown;
        url?: unknown;
      };
      if (expectedStatus === 400) {
        expect(body.error).toBe(expectedError);
      } else {
        expect(body.redirect).toBe(true);
        expect(body.url).toEqual(expect.any(String));
        expect(new URL(body.url as string).searchParams.get('error')).toBe(expectedError);
      }
      await expect(
        db.select().from(oauthConsent).where(eq(oauthConsent.clientId, clientId)),
      ).resolves.toEqual([]);
      const codeRows = (await db.select({ value: verification.value }).from(verification)).filter(
        ({ value }) => value.includes(clientId),
      );
      expect(codeRows).toEqual([]);
      await expect(
        db.select().from(oauthResourceGrant).where(eq(oauthResourceGrant.clientId, clientId)),
      ).resolves.toEqual([]);
      await expect(
        db.select().from(oauthRefreshToken).where(eq(oauthRefreshToken.clientId, clientId)),
      ).resolves.toEqual([]);
    },
  );

  it.each([
    ['disabled client', false],
    ['deleted client', true],
  ] as const)('preserves an access denial without revealing a %s', async (_label, deleteClient) => {
    const { db, oauthClient, oauthConsent, oauthRefreshToken, oauthResourceGrant, verification } =
      await import('@docket/db');
    const owner = await signInWithRecoveryCode();
    const suffix = randomUUID();
    const clientId = `consent-denial-${suffix}`;
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
      skipConsent: false,
    });
    const state = `consent-denial-${randomUUID()}`;
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: 'http://127.0.0.1/callback',
      scope: 'work:read offline_access',
      resource: 'http://localhost:4000/v1',
      code_challenge: createHash('sha256')
        .update('consent-denial-verifier-000000000000000000000000000000')
        .digest('base64url'),
      code_challenge_method: 'S256',
      state,
    });
    const authorize = await authRequest(`/oauth2/authorize?${query.toString()}`, {
      headers: { accept: 'text/html', cookie: owner.cookie },
    });
    expect(authorize.status).toBe(302);
    const consentTarget = new URL(authorize.headers.get('location') ?? '');
    expect(consentTarget.pathname).toBe('/oauth/authorize');
    if (deleteClient) {
      await db.delete(oauthClient).where(eq(oauthClient.clientId, clientId));
    } else {
      await db
        .update(oauthClient)
        .set({ disabled: true })
        .where(eq(oauthClient.clientId, clientId));
    }

    const denied = await authRequest('/oauth2/consent', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: owner.cookie,
        origin: 'http://localhost:4000',
      },
      body: JSON.stringify({
        accept: false,
        oauth_query: consentTarget.search.slice(1),
      }),
    });

    expect(denied.status, await denied.clone().text()).toBe(200);
    const body = (await denied.json()) as { redirect?: unknown; url?: unknown };
    expect(body.redirect).toBe(true);
    expect(body.url).toEqual(expect.any(String));
    expect(new URL(body.url as string).searchParams.get('error')).toBe('access_denied');
    await expect(
      db.select().from(oauthConsent).where(eq(oauthConsent.clientId, clientId)),
    ).resolves.toEqual([]);
    const codeRows = (await db.select({ value: verification.value }).from(verification)).filter(
      ({ value }) => value.includes(clientId),
    );
    expect(codeRows).toEqual([]);
    await expect(
      db.select().from(oauthResourceGrant).where(eq(oauthResourceGrant.clientId, clientId)),
    ).resolves.toEqual([]);
    await expect(
      db.select().from(oauthRefreshToken).where(eq(oauthRefreshToken.clientId, clientId)),
    ).resolves.toEqual([]);
  });
});
