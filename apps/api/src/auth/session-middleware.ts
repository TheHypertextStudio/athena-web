/**
 * `@docket/api` — session middleware.
 */
import { auth } from '@docket/auth';
import type { Context, MiddlewareHandler } from 'hono';

import type { AppEnv, AuthSession } from '../context';

/**
 * Better Auth's own mount. Requests here resolve and re-issue their session cookies inside the
 * handler, so resolving one first is a duplicate read whose `Set-Cookie` would collide with the
 * handler's own.
 */
const AUTH_ROUTE_PREFIX = '/api/auth/';

/**
 * Resolve the Better Auth session from request headers into `c.var.session`.
 *
 * @remarks
 * The session is served from a signed cookie rather than a database row on every request (see
 * `SESSION_COOKIE_CACHE_MAX_AGE_S` in `packages/auth/src/auth-builder.ts`). That cache is only
 * worth having if it stays warm, which is why this asks for the response headers and forwards
 * them: when Better Auth falls back to the database it hands back a refreshed cookie, and
 * dropping it would mean the cache expires once and every subsequent request pays the read again.
 *
 * Anything that must not be answered by a cached copy — revoking a session, deleting an account,
 * minting recovery codes — calls {@link readAuthoritativeSession} instead of reading `c.var`.
 */
export const sessionMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.path.startsWith(AUTH_ROUTE_PREFIX)) {
    c.set('session', null);
    await next();
    return;
  }

  const { headers, response } = await auth.api.getSession({
    headers: c.req.raw.headers,
    returnHeaders: true,
  });
  for (const cookie of headers.getSetCookie()) c.header('set-cookie', cookie, { append: true });
  c.set('session', response);
  await next();
};

/**
 * Re-resolve the session against the database, ignoring the cookie cache.
 *
 * @param c - The request context.
 * @returns The live session, or `null` when it has been revoked or expired.
 *
 * @remarks
 * `c.var.session` is fast because it may come from a signed cookie that outlives the session row
 * by up to the cache window. For an operation whose whole purpose is to act on session validity —
 * revoking a device, deleting the account, issuing recovery codes — that window is the difference
 * between honoring a revocation and ignoring it, so those handlers ask for the authoritative
 * answer and accept the extra read.
 */
export async function readAuthoritativeSession(c: Context<AppEnv>): Promise<AuthSession> {
  return await auth.api.getSession({
    headers: c.req.raw.headers,
    query: { disableCookieCache: true },
  });
}

/**
 * Overwrite `c.var.session` with the authoritative answer for a whole route subtree.
 *
 * @remarks
 * Mounted on the surfaces where acting on a revoked session would be the bug rather than a
 * momentary staleness — the device list and its revoke actions, account deletion, recovery-code
 * minting. Handlers below it read `c.var.session` exactly as they always have; only the value
 * they get is guaranteed to reflect the database rather than a cached cookie.
 */
export const authoritativeSessionMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set('session', await readAuthoritativeSession(c));
  await next();
};
