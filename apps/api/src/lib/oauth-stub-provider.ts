/**
 * `@docket/api` — the local/test-only fake OAuth 2.0 authorization server behind `test-oauth`.
 *
 * @remarks
 * SCR-07 ("an OAuth-provider sign-in succeeds") requires a REAL Better Auth session to be minted
 * at the end of a REAL OAuth2 ceremony. No environment this code runs in — including CI — holds a
 * real Google/GitHub/etc. account to complete one against, and the real `socialProviders` blocks
 * in `packages/auth/src/auth-builder.ts` are (deliberately) out of scope for a test fixture: they
 * mount real providers' own endpoints, not a stand-in.
 *
 * This module is that stand-in: a REAL, minimal OAuth 2.0 authorization server — a Hono HTTP
 * handler, not a browser-side `page.route` stub — implementing the three endpoints an
 * authorization-code ceremony needs:
 *
 * - `GET /authorize` — immediately redirects back to the caller's `redirect_uri` with a genuine
 *   one-time `code` and the given `state` (this fixture has no login/consent screen: consent is
 *   assumed, the way a "click allow" step would resolve instantly in a real ceremony).
 * - `POST /token` — exchanges that `code` for an access token. Single-use: an unknown, reused, or
 *   `redirect_uri`-mismatched code is rejected with a standard `invalid_grant` error.
 * - `GET /userinfo` — returns the fixed-shape fake identity (`sub`/`email`/`email_verified`/
 *   `name`) the presented access token resolved to at `/token` time.
 *
 * Only the identity provider on the other end is faked — Better Auth's `genericOAuth` plugin
 * (configured in `packages/auth/src/auth-builder.ts`'s `test-oauth` provider) performs a
 * genuine authorize → code → token → userinfo round trip against these routes, exactly as it
 * would against Google. This is the same "run a small local authorization server" shape every
 * serious OAuth test suite uses (the `mock-oauth2-server` pattern), not a fake ceremony.
 *
 * **Mounting.** `apps/api/src/server.ts` mounts this app at `/api/auth-test/oauth-stub` — the
 * SAME Hono server (and therefore the same origin/port) as `/api/auth/*` (Better Auth itself), so
 * `packages/auth/src/auth-builder.ts` can point the `test-oauth` provider's URLs at
 * `${BETTER_AUTH_URL}/api/auth-test/oauth-stub/*` with no separate process or port to manage.
 * The mount is gated to `APP_MODE ∈ {local,test}` in `server.ts` — the route is not registered at
 * all otherwise — and every handler here re-checks the same gate as defense in depth, so a future
 * regression in that mount guard cannot make this fixture reachable in production on its own.
 *
 * **Client credentials.** {@link CLIENT_ID}/{@link CLIENT_SECRET} are not secrets (this is
 * Docket's own fixture, never a real provider) and are duplicated as literals in
 * `packages/auth/src/auth-builder.ts` rather than shared through an import, because
 * `packages/auth` must never depend on `apps/api` (apps depend on packages, never the reverse). A
 * drift between the two files fails loudly: `/token` rejects the mismatched credential with
 * `invalid_grant`, so the e2e ceremony spec cannot pass silently against a stale value.
 */
import { randomUUID } from 'node:crypto';

import { Hono } from 'hono';

import { env } from '../env';

/**
 * The `test-oauth` provider's client id/secret — must match
 * `packages/auth/src/auth-builder.ts`'s `TEST_OAUTH_CLIENT_ID`/`TEST_OAUTH_CLIENT_SECRET` exactly
 * (see the module remarks above for why these are independent literals, not a shared import).
 */
const CLIENT_ID = 'docket-test-oauth-client';
/** @see {@link CLIENT_ID} */
const CLIENT_SECRET = 'docket-test-oauth-client-secret';

/** How long an issued authorization code stays redeemable before `/token` rejects it. */
const CODE_TTL_MS = 5 * 60 * 1000;
/** How long an issued access token stays valid before `/userinfo` rejects it. */
const TOKEN_TTL_MS = 5 * 60 * 1000;

/** The fake identity a completed ceremony resolves to. */
interface FakeIdentity {
  readonly sub: string;
  readonly email: string;
  readonly name: string;
}

/** A one-time authorization code, as minted by `/authorize` and redeemed by `/token`. */
interface IssuedCode {
  readonly redirectUri: string;
  readonly identity: FakeIdentity;
  readonly expiresAt: number;
}

/** An access token, as minted by `/token` and redeemed by `/userinfo`. */
interface IssuedToken {
  readonly identity: FakeIdentity;
  readonly expiresAt: number;
}

// In-memory, process-local stores. This is a throwaway test fixture, not a persisted credential
// store: codes are single-use and short-lived, tokens are short-lived, and both only ever need to
// survive the life of one `tsx watch` / e2e-run process — never a restart, never a second process.
const issuedCodes = new Map<string, IssuedCode>();
const issuedTokens = new Map<string, IssuedToken>();

/**
 * Mint a brand-new fake identity, unique per `/authorize` call.
 *
 * @remarks
 * Uniqueness matters beyond just avoiding same-run collisions: the local/e2e stack's Postgres is
 * a persistent embedded instance across repeated dev-stack runs (not reset per Playwright
 * invocation), so a FIXED fake email would make the second-ever run of the ceremony spec resolve
 * to a RETURNING user (a real, valid, but different code path) instead of the fresh sign-up the
 * spec's `newUserCallbackURL` assertion expects. A fresh identity every call makes the ceremony
 * deterministic regardless of what ran before it.
 */
function mintIdentity(): FakeIdentity {
  const suffix = randomUUID();
  return {
    sub: `test-oauth-${suffix}`,
    email: `test-oauth+${suffix}@example.test`,
    name: 'Docket Test OAuth User',
  };
}

/** Defense in depth: every handler below re-checks the mount gate `server.ts` already applies. */
function isEnabled(): boolean {
  return env.APP_MODE === 'local' || env.APP_MODE === 'test';
}

/**
 * The fake authorization server backing the `test-oauth` generic-oauth provider. See the module
 * remarks for the full ceremony shape and the mounting/gating story.
 */
const oauthStubProvider = new Hono()
  .use('*', async (c, next) => {
    if (!isEnabled()) return c.json({ error: 'not_found' }, 404);
    return next();
  })
  .get('/authorize', (c) => {
    const clientId = c.req.query('client_id');
    const redirectUri = c.req.query('redirect_uri');
    const state = c.req.query('state');
    const responseType = c.req.query('response_type');
    if (clientId !== CLIENT_ID || !redirectUri || responseType !== 'code') {
      return c.json({ error: 'invalid_request' }, 400);
    }
    const code = randomUUID();
    issuedCodes.set(code, {
      redirectUri,
      identity: mintIdentity(),
      expiresAt: Date.now() + CODE_TTL_MS,
    });
    const back = new URL(redirectUri);
    back.searchParams.set('code', code);
    if (state) back.searchParams.set('state', state);
    // A real consenting-user landing back from a provider's authorize screen — this fixture has
    // no login/consent UI, so consent is assumed and the bounce is immediate.
    return c.redirect(back.toString(), 302);
  })
  .post('/token', async (c) => {
    const body = await c.req.parseBody();
    const field = (name: string): string | undefined => {
      const value = body[name];
      return typeof value === 'string' ? value : undefined;
    };
    const grantType = field('grant_type');
    const code = field('code');
    const redirectUri = field('redirect_uri');
    const clientId = field('client_id');
    const clientSecret = field('client_secret');
    const issued = code ? issuedCodes.get(code) : undefined;
    const valid =
      grantType === 'authorization_code' &&
      issued !== undefined &&
      issued.expiresAt >= Date.now() &&
      clientId === CLIENT_ID &&
      clientSecret === CLIENT_SECRET &&
      redirectUri === issued.redirectUri;
    if (!valid || !code) {
      return c.json({ error: 'invalid_grant' }, 400);
    }
    // Single use: deleting here means a replayed code misses the map above and is rejected.
    issuedCodes.delete(code);
    const accessToken = randomUUID();
    issuedTokens.set(accessToken, {
      identity: issued.identity,
      expiresAt: Date.now() + TOKEN_TTL_MS,
    });
    return c.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: Math.floor(TOKEN_TTL_MS / 1000),
      scope: 'openid email profile',
    });
  })
  .get('/userinfo', (c) => {
    const authorization = c.req.header('authorization') ?? '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : '';
    const issued = token ? issuedTokens.get(token) : undefined;
    if (!issued || issued.expiresAt < Date.now()) {
      return c.json({ error: 'invalid_token' }, 401);
    }
    return c.json({
      sub: issued.identity.sub,
      email: issued.identity.email,
      email_verified: true,
      name: issued.identity.name,
    });
  });

export default oauthStubProvider;
