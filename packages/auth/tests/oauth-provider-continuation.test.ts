import { createHash, randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { isolatedProviderAuth, signInWithRecoveryCode } from './oauth-provider-handler.support';

type Continuation = 'created' | 'postLogin' | 'selected';

const callback = 'http://127.0.0.1/callback';
const mcpResource = 'http://localhost:4000/mcp';
const restResource = 'http://localhost:4000/v1';

async function seedClient(skipConsent: boolean): Promise<string> {
  const { db, oauthClient } = await import('@docket/db');
  const clientId = `continuation-${randomUUID()}`;
  await db.insert(oauthClient).values({
    clientId,
    redirectUris: [callback],
    public: true,
    type: 'public',
    requirePKCE: true,
    tokenEndpointAuthMethod: 'none',
    grantTypes: ['authorization_code', 'refresh_token'],
    responseTypes: ['code'],
    scopes: ['work:read', 'offline_access'],
    skipConsent,
  });
  return clientId;
}

function continuationAuth(mode: Continuation) {
  let postLoginChecks = 0;
  return isolatedProviderAuth(
    {
      generateRefreshToken: async () => `continuation-refresh-${randomUUID()}`,
      customAccessTokenClaims: () => ({}),
    },
    {
      providerOptions: {
        ...(mode === 'selected'
          ? {
              selectAccount: {
                page: 'http://localhost:3000/select-account',
                shouldRedirect: () => true,
              },
            }
          : {}),
        ...(mode === 'created' ? { signup: { page: 'http://localhost:3000/sign-up' } } : {}),
        ...(mode === 'postLogin'
          ? {
              postLogin: {
                page: 'http://localhost:3000/post-login',
                consentReferenceId: () => undefined,
                shouldRedirect: () => {
                  postLoginChecks += 1;
                  return postLoginChecks === 1;
                },
              },
            }
          : {}),
      },
    },
  );
}

async function beginContinuation(
  mode: Continuation,
  clientId: string,
  cookie: string,
  resource = mcpResource,
): Promise<{ readonly auth: ReturnType<typeof continuationAuth>; readonly signedQuery: string }> {
  const auth = continuationAuth(mode);
  const verifier = `continue-${mode}-verifier-000000000000000000000000000`;
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: callback,
    scope: 'work:read offline_access',
    resource,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    state: `continue-${mode}-${randomUUID()}`,
    ...(mode === 'selected' ? { prompt: 'select_account' } : {}),
    ...(mode === 'created' ? { prompt: 'create' } : {}),
  });
  const started = await auth.handler(
    new Request(`http://localhost:4000/api/auth/oauth2/authorize?${query.toString()}`, {
      headers: { accept: 'text/html', cookie },
    }),
  );
  expect(started.status, await started.clone().text()).toBe(302);
  const target = new URL(started.headers.get('location') ?? '');
  expect(target.searchParams.get('sig')).toEqual(expect.any(String));
  return { auth, signedQuery: target.search.slice(1) };
}

async function continueAuthorization(
  auth: ReturnType<typeof continuationAuth>,
  mode: Continuation,
  signedQuery: string,
  cookie: string,
): Promise<Response> {
  return auth.handler(
    new Request('http://localhost:4000/api/auth/oauth2/continue', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie,
        origin: 'http://localhost:4000',
      },
      body: JSON.stringify({ [mode]: true, oauth_query: signedQuery }),
    }),
  );
}

describe('Docket OAuth authorization continuation', () => {
  it.each(['selected', 'created', 'postLogin'] as const)(
    'preserves the %s prompt transition and issues one bound code',
    async (mode) => {
      const owner = await signInWithRecoveryCode();
      const clientId = await seedClient(true);
      const started = await beginContinuation(mode, clientId, owner.cookie);

      const response = await continueAuthorization(
        started.auth,
        mode,
        started.signedQuery,
        owner.cookie,
      );

      expect(response.status, await response.clone().text()).toBe(200);
      const body = (await response.json()) as { redirect?: unknown; url?: unknown };
      expect(body.redirect).toBe(true);
      const callbackUrl = new URL(String(body.url));
      expect(callbackUrl.origin + callbackUrl.pathname).toBe(callback);
      expect(callbackUrl.searchParams.get('code')).toEqual(expect.any(String));
    },
  );

  it('rechecks the Docket REST policy after a signed account-selection prompt', async () => {
    const { db, oauthClient, verification } = await import('@docket/db');
    const owner = await signInWithRecoveryCode();
    const clientId = await seedClient(false);
    const started = await beginContinuation('selected', clientId, owner.cookie, restResource);
    await db
      .update(oauthClient)
      .set({ skipConsent: true })
      .where(eq(oauthClient.clientId, clientId));

    const response = await continueAuthorization(
      started.auth,
      'selected',
      started.signedQuery,
      owner.cookie,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'unauthorized_client' });
    const codes = (await db.select({ value: verification.value }).from(verification)).filter(
      ({ value }) => value.includes(clientId),
    );
    expect(codes).toEqual([]);
  });

  it('preserves the provider error when no continuation flag is selected', async () => {
    const owner = await signInWithRecoveryCode();
    const clientId = await seedClient(true);
    const started = await beginContinuation('selected', clientId, owner.cookie);
    const response = await started.auth.handler(
      new Request('http://localhost:4000/api/auth/oauth2/continue', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: owner.cookie,
          origin: 'http://localhost:4000',
        },
        body: JSON.stringify({ oauth_query: started.signedQuery }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_request' });
  });
});
