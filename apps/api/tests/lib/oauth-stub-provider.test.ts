/**
 * `@docket/api` — the local/test-only fake OAuth 2.0 authorization server.
 *
 * @remarks
 * This is a real, minimal authorization server, not a browser-side stub — so it is tested the same
 * way a real one would be: drive `authorize` → `token` → `userinfo` end to end, and prove every
 * refusal path actually refuses (a mismatched client, a replayed code, an expired token).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import oauthStubProvider from '../../src/lib/oauth-stub-provider';

const CLIENT_ID = 'docket-test-oauth-client';
const CLIENT_SECRET = 'docket-test-oauth-client-secret';
const REDIRECT_URI = 'https://app.example.test/api/auth/oauth2/callback/test-oauth';

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** Run the authorize step and pull the issued `code` off the redirect. */
async function authorize(
  query: Record<string, string>,
): Promise<{ res: Response; code: string | null }> {
  const params = new URLSearchParams(query);
  const res = await oauthStubProvider.request(`/authorize?${params.toString()}`, {
    redirect: 'manual',
  });
  const location = res.headers.get('location');
  const code = location ? new URL(location).searchParams.get('code') : null;
  return { res, code };
}

/** Exchange a code (or arbitrary overrides) at the token endpoint. */
async function tokenRequest(fields: Record<string, string>): Promise<Response> {
  const body = new URLSearchParams(fields);
  return oauthStubProvider.request('/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
}

describe('oauth stub provider', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('completes a full authorize → token → userinfo ceremony', async () => {
    const { res: authorizeRes, code } = await authorize({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      state: 'xyz',
    });
    expect(authorizeRes.status).toBe(302);
    const location = new URL(authorizeRes.headers.get('location')!);
    expect(location.searchParams.get('state')).toBe('xyz');
    expect(code).toBeTruthy();

    const tokenRes = await tokenRequest({
      grant_type: 'authorization_code',
      code: code!,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    });
    expect(tokenRes.status).toBe(200);
    const token = await json<{ access_token: string; token_type: string }>(tokenRes);
    expect(token.token_type).toBe('Bearer');

    const userinfoRes = await oauthStubProvider.request('/userinfo', {
      headers: { authorization: `Bearer ${token.access_token}` },
    });
    expect(userinfoRes.status).toBe(200);
    const identity = await json<{ email: string; email_verified: boolean }>(userinfoRes);
    expect(identity.email).toMatch(/^test-oauth\+.+@example\.test$/);
    expect(identity.email_verified).toBe(true);
  });

  it('mints a fresh identity on every authorize call', async () => {
    const first = await authorize({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
    });
    const second = await authorize({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
    });
    const firstToken = await json<{ access_token: string }>(
      await tokenRequest({
        grant_type: 'authorization_code',
        code: first.code!,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      }),
    );
    const secondToken = await json<{ access_token: string }>(
      await tokenRequest({
        grant_type: 'authorization_code',
        code: second.code!,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      }),
    );
    const firstIdentity = await json<{ sub: string }>(
      await oauthStubProvider.request('/userinfo', {
        headers: { authorization: `Bearer ${firstToken.access_token}` },
      }),
    );
    const secondIdentity = await json<{ sub: string }>(
      await oauthStubProvider.request('/userinfo', {
        headers: { authorization: `Bearer ${secondToken.access_token}` },
      }),
    );
    expect(firstIdentity.sub).not.toBe(secondIdentity.sub);
  });

  it('refuses authorize with a wrong client id, missing redirect_uri, or a non-code response type', async () => {
    expect(
      (
        await authorize({
          client_id: 'someone-else',
          redirect_uri: REDIRECT_URI,
          response_type: 'code',
        })
      ).res.status,
    ).toBe(400);
    expect(
      (await authorize({ client_id: CLIENT_ID, redirect_uri: '', response_type: 'code' })).res
        .status,
    ).toBe(400);
    expect(
      (
        await authorize({
          client_id: CLIENT_ID,
          redirect_uri: REDIRECT_URI,
          response_type: 'token',
        })
      ).res.status,
    ).toBe(400);
  });

  it('rejects a token exchange with the wrong grant type', async () => {
    const { code } = await authorize({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
    });
    const res = await tokenRequest({
      grant_type: 'refresh_token',
      code: code!,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    });
    expect(res.status).toBe(400);
    expect((await json<{ error: string }>(res)).error).toBe('invalid_grant');
  });

  it('rejects an unknown code', async () => {
    const res = await tokenRequest({
      grant_type: 'authorization_code',
      code: 'not-a-real-code',
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    });
    expect(res.status).toBe(400);
  });

  it('rejects a mismatched redirect_uri, client id, or client secret', async () => {
    const codes = await Promise.all(
      [0, 1, 2].map(() =>
        authorize({ client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: 'code' }),
      ),
    );
    expect(
      (
        await tokenRequest({
          grant_type: 'authorization_code',
          code: codes[0]!.code!,
          redirect_uri: 'https://attacker.example/callback',
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await tokenRequest({
          grant_type: 'authorization_code',
          code: codes[1]!.code!,
          redirect_uri: REDIRECT_URI,
          client_id: 'wrong-client',
          client_secret: CLIENT_SECRET,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await tokenRequest({
          grant_type: 'authorization_code',
          code: codes[2]!.code!,
          redirect_uri: REDIRECT_URI,
          client_id: CLIENT_ID,
          client_secret: 'wrong-secret',
        })
      ).status,
    ).toBe(400);
  });

  it('is single-use: a code cannot be redeemed twice', async () => {
    const { code } = await authorize({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
    });
    const fields = {
      grant_type: 'authorization_code',
      code: code!,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    };
    expect((await tokenRequest(fields)).status).toBe(200);
    expect((await tokenRequest(fields)).status).toBe(400);
  });

  it('rejects a code that has expired', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-02T12:00:00.000Z'));
    const { code } = await authorize({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
    });
    vi.setSystemTime(new Date('2026-08-02T12:10:01.000Z')); // past the 5-minute code TTL

    const res = await tokenRequest({
      grant_type: 'authorization_code',
      code: code!,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    });
    expect(res.status).toBe(400);
  });

  it('rejects an expired access token at userinfo', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-02T12:00:00.000Z'));
    const { code } = await authorize({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
    });
    const token = await json<{ access_token: string }>(
      await tokenRequest({
        grant_type: 'authorization_code',
        code: code!,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      }),
    );
    vi.setSystemTime(new Date('2026-08-02T12:10:01.000Z')); // past the 5-minute token TTL

    const res = await oauthStubProvider.request('/userinfo', {
      headers: { authorization: `Bearer ${token.access_token}` },
    });
    expect(res.status).toBe(401);
  });

  it('rejects userinfo with no bearer token or an unknown one', async () => {
    expect((await oauthStubProvider.request('/userinfo')).status).toBe(401);
    expect(
      (
        await oauthStubProvider.request('/userinfo', {
          headers: { authorization: 'Basic dXNlcjpwYXNz' },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await oauthStubProvider.request('/userinfo', {
          headers: { authorization: 'Bearer not-a-real-token' },
        })
      ).status,
    ).toBe(401);
  });
});

describe('oauth stub provider mount gate', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('refuses every route outside local/test app modes', async () => {
    vi.doMock('../../src/env', () => ({ env: { APP_MODE: 'production' } }));
    const { default: gated } = await import('../../src/lib/oauth-stub-provider');
    expect((await gated.request('/authorize?client_id=x')).status).toBe(404);
    expect((await gated.request('/userinfo')).status).toBe(404);
    vi.doUnmock('../../src/env');
  });
});
