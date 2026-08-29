/**
 * `@docket/api` — session middleware.
 */
import { auth } from '@docket/auth';
import type { Context, MiddlewareHandler } from 'hono';

import type { AppEnv, AuthSession } from '../context';
import { AuthError } from '../error';
import { isReplayOwnerRequest, REPLAY_OWNER_HEADER } from '../replay-owner-contract';

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
 * Better Auth resolves the live database session on every request. The session-data cookie cache
 * and sliding refresh are disabled, so account changes cannot leave an independently valid browser
 * identity behind. Response headers are still forwarded because Better Auth owns its cookie
 * protocol and may issue cleanup headers while resolving an expired session.
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
 * Re-resolve the session against the database for a destructive or validity-sensitive operation.
 *
 * @param c - The request context.
 * @returns The live session, or `null` when it has been revoked or expired.
 *
 * @remarks
 * The global session cache is disabled, but these call sites retain the explicit
 * `disableCookieCache` option as a local invariant. A future cache policy change therefore cannot
 * weaken device revocation, account deletion, recovery-code issuance, or replay-owner binding.
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
 * minting. Handlers below it read `c.var.session` exactly as they always have while this middleware
 * preserves an explicit database-backed boundary.
 */
export const authoritativeSessionMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set('session', await readAuthoritativeSession(c));
  await next();
};

/**
 * Bind an offline-capable live attempt or replay to its captured account.
 *
 * @remarks
 * Every ordinary session read is database-backed. The replay-owner header adds a separate claim:
 * the live session must still belong to the account that captured the queued write. Only the
 * atomically idempotent object-command POST route may carry {@link REPLAY_OWNER_HEADER}.
 */
export const replayOwnerSessionMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const replayOwnerId = c.req.header(REPLAY_OWNER_HEADER);
  if (replayOwnerId === undefined) {
    await next();
    return;
  }
  if (!isReplayOwnerRequest(c.req.method, c.req.path)) throw new AuthError();

  const liveSession = await readAuthoritativeSession(c);
  c.set('session', liveSession);
  if (liveSession?.user.id !== replayOwnerId) throw new AuthError();

  await next();
};
