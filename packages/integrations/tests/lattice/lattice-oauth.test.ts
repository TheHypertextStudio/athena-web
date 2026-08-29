/**
 * Sign in with Lovelace: the authorization URL, PKCE, the token exchange, refresh, and the scope
 * check.
 *
 * @remarks
 * The scope assertions are the ones that matter most. The OAuth grant must request only the
 * permissions appropriate to Athena's use of Lattice, and a scope list is exactly the kind of thing that
 * quietly grows. These tests pin both what is asked for and what is deliberately not.
 */
import { createHash } from 'node:crypto';

import {
  LATTICE_SCOPES,
  LOVELACE_ACCOUNTS_ISSUER,
  LatticeOAuthError,
  beginLatticeAuthorization,
  codeChallengeFor,
  completeLatticeAuthorization,
  latticeCredentialNeedsRefresh,
  missingLatticeScopes,
  parseLatticeCredential,
  refreshLatticeCredential,
  type LatticeCredentialRecord,
  type LatticeOAuthClientConfig,
} from '@docket/integrations';
import { describe, expect, it, vi } from 'vitest';

/** A deterministic byte source so the PKCE verifier is reproducible. */
const fixedRandom = (size: number): Buffer => Buffer.alloc(size, 7);

/** A base config pointing at a stand-in issuer. */
function config(overrides: Partial<LatticeOAuthClientConfig> = {}): LatticeOAuthClientConfig {
  return {
    issuer: 'https://accounts.test',
    clientId: 'client_abc',
    clientSecret: 'secret_xyz',
    redirectUri: 'https://api.docket.test/internal/integrations/lattice/callback',
    ...overrides,
  };
}

/** A fetch double returning one scripted token response and recording the form it received. */
function tokenFetch(
  status: number,
  payload: unknown,
): { fetch: typeof globalThis.fetch; forms: URLSearchParams[]; urls: string[] } {
  const forms: URLSearchParams[] = [];
  const urls: string[] = [];
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    urls.push(String(input));
    forms.push(new URLSearchParams(typeof init?.body === 'string' ? init.body : ''));
    return new Response(JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof globalThis.fetch;
  return { fetch: fetchImpl, forms, urls };
}

describe('the requested scopes', () => {
  it('asks for identity, durable access, inference, and catalog read', () => {
    expect([...LATTICE_SCOPES]).toEqual([
      'openid',
      'profile',
      'email',
      'offline_access',
      'lattice:compute:inference',
      'lattice:compute:catalog:read',
    ]);
  });

  it('never asks for authority to manage the user’s devices or to use shared capacity', () => {
    // Each of these would let Athena do something the feature does not require: mint daemon
    // credentials on the person's account, or route their work onto someone else's hardware.
    expect(LATTICE_SCOPES).not.toContain('lattice:compute:personal_runtime:manage');
    expect(LATTICE_SCOPES).not.toContain('lattice:compute:marketplace');
    expect(LATTICE_SCOPES).not.toContain('lattice:compute:usage:read');
  });

  it('treats a narrowed grant as missing scopes, and a silent issuer as sufficient', () => {
    expect(missingLatticeScopes('lattice:compute:inference')).toEqual([
      'openid',
      'profile',
      'email',
      'offline_access',
      'lattice:compute:catalog:read',
    ]);
    expect(missingLatticeScopes(LATTICE_SCOPES.join(' '))).toEqual([]);
    // OAuth 2.1 lets an issuer omit `scope` when the grant matches the request exactly.
    expect(missingLatticeScopes(null)).toEqual([]);
  });
});

describe('beginLatticeAuthorization', () => {
  it('builds an authorization-code + S256 PKCE URL against the issuer', () => {
    const begun = beginLatticeAuthorization(config(), 'signed-state', fixedRandom);
    const url = new URL(begun.authorizationUrl);

    expect(url.origin).toBe('https://accounts.test');
    expect(url.pathname).toBe('/oauth/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('client_abc');
    expect(url.searchParams.get('state')).toBe('signed-state');
    expect(url.searchParams.get('scope')).toBe(LATTICE_SCOPES.join(' '));
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('puts the challenge on the URL and keeps the verifier off it', () => {
    const begun = beginLatticeAuthorization(config(), 'st', fixedRandom);
    const url = new URL(begun.authorizationUrl);
    const verifier = begun.credential.codeVerifier;

    expect(url.searchParams.get('code_challenge')).toBe(
      createHash('sha256').update(verifier).digest('base64url'),
    );
    expect(codeChallengeFor(verifier)).toBe(url.searchParams.get('code_challenge'));
    expect(begun.authorizationUrl).not.toContain(verifier);
  });

  it('defaults to the real Lovelace accounts issuer', () => {
    const begun = beginLatticeAuthorization(
      { clientId: 'c', redirectUri: 'https://r.test/cb' },
      'st',
      fixedRandom,
    );
    expect(begun.authorizationUrl.startsWith(`${LOVELACE_ACCOUNTS_ISSUER}/oauth/authorize`)).toBe(
      true,
    );
  });
});

describe('completeLatticeAuthorization', () => {
  it('exchanges the code with the verifier and the client credentials', async () => {
    const { fetch, forms, urls } = tokenFetch(200, {
      access_token: 'at_1',
      refresh_token: 'rt_1',
      expires_in: 3600,
      scope: LATTICE_SCOPES.join(' '),
    });

    const record = await completeLatticeAuthorization(config({ fetch }), {
      authorizationCode: 'code_1',
      credential: { kind: 'lattice_oauth_pending', codeVerifier: 'verifier_1' },
    });

    expect(urls[0]).toBe('https://accounts.test/oauth/token');
    expect(forms[0]?.get('grant_type')).toBe('authorization_code');
    expect(forms[0]?.get('code')).toBe('code_1');
    expect(forms[0]?.get('code_verifier')).toBe('verifier_1');
    expect(forms[0]?.get('client_secret')).toBe('secret_xyz');
    expect(record).toMatchObject({
      kind: 'lattice_oauth',
      accessToken: 'at_1',
      refreshToken: 'rt_1',
      expiresInSeconds: 3600,
    });
  });

  it('surfaces the issuer’s stable error code and drops its prose', async () => {
    const { fetch } = tokenFetch(400, {
      error: 'invalid_grant',
      error_description: 'authorization code has already been redeemed',
    });

    const failure = await completeLatticeAuthorization(config({ fetch }), {
      authorizationCode: 'used',
      credential: { kind: 'lattice_oauth_pending', codeVerifier: 'v' },
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(LatticeOAuthError);
    expect((failure as LatticeOAuthError).code).toBe('invalid_grant');
  });

  it('refuses a 200 that carried no access token rather than storing an empty grant', async () => {
    const { fetch } = tokenFetch(200, { token_type: 'bearer' });

    await expect(
      completeLatticeAuthorization(config({ fetch }), {
        authorizationCode: 'c',
        credential: { kind: 'lattice_oauth_pending', codeVerifier: 'v' },
      }),
    ).rejects.toMatchObject({ code: 'invalid_grant' });
  });

  it('reads an empty token response as no grant rather than throwing on malformed JSON', async () => {
    const fetch = (async () => new Response('', { status: 200 })) as typeof globalThis.fetch;

    await expect(
      completeLatticeAuthorization(config({ fetch }), {
        authorizationCode: 'c',
        credential: { kind: 'lattice_oauth_pending', codeVerifier: 'v' },
      }),
    ).rejects.toMatchObject({ code: 'invalid_grant' });
  });

  it('reads a non-JSON token response (e.g. an HTML error page) as no grant', async () => {
    const fetch = (async () =>
      new Response('<html><body>502 Bad Gateway</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })) as typeof globalThis.fetch;

    await expect(
      completeLatticeAuthorization(config({ fetch }), {
        authorizationCode: 'c',
        credential: { kind: 'lattice_oauth_pending', codeVerifier: 'v' },
      }),
    ).rejects.toMatchObject({ code: 'invalid_grant' });
  });

  it('stores a null scope rather than a stringified undefined when the issuer omits it', async () => {
    const { fetch } = tokenFetch(200, { access_token: 'at_no_scope', expires_in: 3600 });

    const record = await completeLatticeAuthorization(config({ fetch }), {
      authorizationCode: 'c',
      credential: { kind: 'lattice_oauth_pending', codeVerifier: 'v' },
    });

    expect(record.scope).toBeNull();
  });

  it('stores a null lifetime rather than NaN when the issuer omits expires_in', async () => {
    const { fetch } = tokenFetch(200, { access_token: 'at_no_expiry' });

    const record = await completeLatticeAuthorization(config({ fetch }), {
      authorizationCode: 'c',
      credential: { kind: 'lattice_oauth_pending', codeVerifier: 'v' },
    });

    expect(record.expiresInSeconds).toBeNull();
  });

  it('omits client_secret from the form when the client is public rather than confidential', async () => {
    const { fetch, forms } = tokenFetch(200, {
      access_token: 'at_public',
      expires_in: 3600,
    });

    await completeLatticeAuthorization(config({ clientSecret: undefined, fetch }), {
      authorizationCode: 'c',
      credential: { kind: 'lattice_oauth_pending', codeVerifier: 'v' },
    });

    expect(forms[0]?.has('client_secret')).toBe(false);
  });

  it('treats a non-ok response with no recognizable body as an HTTP-coded failure', async () => {
    const fetch = (async () =>
      new Response(JSON.stringify({ unexpected: true }), {
        status: 500,
      })) as typeof globalThis.fetch;

    const failure = await completeLatticeAuthorization(config({ fetch }), {
      authorizationCode: 'c',
      credential: { kind: 'lattice_oauth_pending', codeVerifier: 'v' },
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(LatticeOAuthError);
    expect((failure as LatticeOAuthError).code).toBe('http_500');
    expect((failure as LatticeOAuthError).message).toBe('token endpoint returned HTTP 500');
  });

  it('reports a transport failure with the underlying Error’s message', async () => {
    const fetch = (async () => {
      throw new Error('getaddrinfo ENOTFOUND accounts.uselovelace.com');
    }) as typeof globalThis.fetch;

    const failure = await completeLatticeAuthorization(config({ fetch }), {
      authorizationCode: 'c',
      credential: { kind: 'lattice_oauth_pending', codeVerifier: 'v' },
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(LatticeOAuthError);
    expect((failure as LatticeOAuthError).code).toBe('transport_error');
    expect((failure as LatticeOAuthError).message).toBe(
      'getaddrinfo ENOTFOUND accounts.uselovelace.com',
    );
  });

  it('falls back to a generic message when the token request throws a non-Error value', async () => {
    const fetch = (async () => {
      // Exercises the non-Error fallback path, which requires throwing something that isn't one.
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw 'connection reset';
    }) as typeof globalThis.fetch;

    const failure = await completeLatticeAuthorization(config({ fetch }), {
      authorizationCode: 'c',
      credential: { kind: 'lattice_oauth_pending', codeVerifier: 'v' },
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(LatticeOAuthError);
    expect((failure as LatticeOAuthError).code).toBe('transport_error');
    expect((failure as LatticeOAuthError).message).toBe('token request failed');
  });

  it('falls back to the platform fetch when no transport is injected', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ access_token: 'at_global', expires_in: 3600 }), {
          status: 200,
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      const record = await completeLatticeAuthorization(config({ fetch: undefined }), {
        authorizationCode: 'c',
        credential: { kind: 'lattice_oauth_pending', codeVerifier: 'v' },
      });
      expect(record.accessToken).toBe('at_global');
      expect(fetchMock).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('refreshLatticeCredential', () => {
  /** A stored grant obtained an hour ago. */
  const stored: LatticeCredentialRecord = {
    kind: 'lattice_oauth',
    accessToken: 'at_old',
    refreshToken: 'rt_old',
    expiresInSeconds: 3600,
    scope: LATTICE_SCOPES.join(' '),
    obtainedAt: '2026-08-02T00:00:00.000Z',
  };

  it('carries the previous refresh token forward when the issuer does not rotate it', async () => {
    const { fetch } = tokenFetch(200, { access_token: 'at_new', expires_in: 3600 });

    const refreshed = await refreshLatticeCredential(config({ fetch }), stored);

    expect(refreshed.accessToken).toBe('at_new');
    // Without this, one refresh against a non-rotating issuer would strip Docket's ability to
    // ever refresh again.
    expect(refreshed.refreshToken).toBe('rt_old');
    expect(refreshed.scope).toBe(stored.scope);
  });

  it('takes the issuer’s new refresh token when it rotates', async () => {
    const { fetch } = tokenFetch(200, {
      access_token: 'at_new',
      refresh_token: 'rt_new',
      expires_in: 3600,
    });

    expect((await refreshLatticeCredential(config({ fetch }), stored)).refreshToken).toBe('rt_new');
  });

  it('refuses to refresh a grant that has no refresh token', async () => {
    const { fetch } = tokenFetch(200, {});
    await expect(
      refreshLatticeCredential(config({ fetch }), { ...stored, refreshToken: null }),
    ).rejects.toMatchObject({ code: 'invalid_grant' });
  });
});

describe('latticeCredentialNeedsRefresh', () => {
  /** Obtained at a fixed instant with a one-hour lifetime. */
  const base: LatticeCredentialRecord = {
    kind: 'lattice_oauth',
    accessToken: 'at',
    refreshToken: 'rt',
    expiresInSeconds: 3600,
    scope: null,
    obtainedAt: '2026-08-02T00:00:00.000Z',
  };
  const obtained = Date.parse(base.obtainedAt);

  it('is false well inside the lifetime', () => {
    expect(latticeCredentialNeedsRefresh(base, obtained + 60_000)).toBe(false);
  });

  it('is true inside the one-minute skew, before the token actually expires', () => {
    // Refreshing early is what stops a turn dying mid-conversation on a token that expired
    // between the check and the gateway call.
    expect(latticeCredentialNeedsRefresh(base, obtained + 3_600_000 - 30_000)).toBe(true);
  });

  it('leaves a credential with no reported lifetime alone', () => {
    expect(
      latticeCredentialNeedsRefresh({ ...base, expiresInSeconds: null }, obtained + 9_000_000),
    ).toBe(false);
  });

  it('refreshes when the obtained time cannot be parsed', () => {
    // "I do not know when I got this" safely reads as "it may already be dead".
    expect(latticeCredentialNeedsRefresh({ ...base, obtainedAt: 'not-a-date' }, obtained)).toBe(
      true,
    );
  });
});

describe('parseLatticeCredential', () => {
  it('accepts both kinds Docket writes', () => {
    expect(parseLatticeCredential('{"kind":"lattice_oauth_pending","codeVerifier":"v"}')).toEqual({
      kind: 'lattice_oauth_pending',
      codeVerifier: 'v',
    });
    expect(parseLatticeCredential('{"kind":"lattice_oauth","accessToken":"a"}')).toMatchObject({
      kind: 'lattice_oauth',
    });
  });

  it('rejects arbitrary JSON and plain text rather than treating them as a token', () => {
    expect(parseLatticeCredential('{"kind":"mcp_oauth"}')).toBeNull();
    expect(parseLatticeCredential('{"accessToken":"a"}')).toBeNull();
    expect(parseLatticeCredential('a-bare-bearer-token')).toBeNull();
  });
});
