/**
 * `@docket/api` — the global authentication gate.
 *
 * @remarks
 * Defense-in-depth authentication for the typed `/v1` app: every RPC route requires an
 * authenticated session UNLESS its exact path is in {@link PUBLIC_PATHS}. This makes
 * authentication **opt-out** — a forgotten per-handler session check can no longer leave a
 * route publicly reachable — rather than the previous opt-in model where each endpoint had
 * to fend for itself.
 *
 * It is purely the authentication floor. Authorization layers on top unchanged:
 * {@link orgContextMiddleware} resolves org membership for `/orgs/:orgId/*`, and
 * `capabilityGuard` gates mutations on a capability. `sessionMiddleware` must run before this
 * (it populates `c.var.session`); it does, since it is registered globally on the root server.
 *
 * @see {@link ./org-context-middleware} for membership resolution
 * @see {@link ./capability-guard} for capability authorization
 */
import type { MiddlewareHandler } from 'hono';

import type { AppEnv } from '../context';
import { AuthError } from '../error';

/**
 * Routes reachable without a session:
 * - `/v1/config` — public client config read by the sign-in page pre-auth (no secrets).
 * - `/v1/health`, `/v1/openapi.json`, `/v1/docs` — operational/doc endpoints registered on the
 *   root server. They sit AFTER the app mount, so a request for them passes through this app's
 *   `*` middleware before falling through to the server handler; they must be exempted here or
 *   the gate would 401 them.
 *
 * Every other `/v1` route requires a session.
 */
const PUBLIC_PATHS: ReadonlySet<string> = new Set([
  '/v1/config',
  '/v1/health',
  '/v1/openapi.json',
  '/v1/docs',
]);

/**
 * Require an authenticated session for every `/v1` route except {@link PUBLIC_PATHS}; throws
 * {@link AuthError} (401) otherwise.
 */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!PUBLIC_PATHS.has(c.req.path) && !c.get('session')?.user) {
    throw new AuthError();
  }
  await next();
};
