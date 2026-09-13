/**
 * `@docket/api` — the global authentication gate.
 *
 * @remarks
 * Defense-in-depth authentication for the typed `/v1` app. The exact operation policy selects a
 * public, first-party-session, or session-or-OAuth boundary. Any operation without an explicit
 * OAuth policy stays session-only, so adding a route cannot widen external access by accident.
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
import type { CallerPrincipal } from '../context';
import { AuthError, CapabilityError, InsufficientScopeError } from '../error';
import { resolvePresentedRestBearer } from '../auth/principal-middleware';
import { accessForOperation } from '../auth/rest-access-policy';

/**
 * Routes reachable without a session:
 * - `/v1/config` — public client config read by the sign-in page pre-auth (no secrets).
 * - `/v1/health`, `/v1/openapi.json`, `/v1/docs` — operational/doc endpoints registered on the
 *   root server. They sit AFTER the app mount, so a request for them passes through this app's
 *   `*` middleware before falling through to the server handler; they must be exempted here or
 *   the gate would 401 them.
 *
 * Every other `/v1` route uses the exact policy returned by {@link accessForOperation}. The
 * default policy requires a first-party session.
 */
const PUBLIC_CONTROL_PATHS: ReadonlySet<string> = new Set([
  '/v1/health',
  '/v1/openapi.json',
  '/v1/docs',
]);

function isPublicControlOperation(method: string, path: string): boolean {
  const safeRead = method === 'GET' || method === 'HEAD';
  return safeRead && (PUBLIC_CONTROL_PATHS.has(path) || path.startsWith('/v1/docs/assets/'));
}

async function operationPrincipal(
  c: Parameters<MiddlewareHandler<AppEnv>>[0],
): Promise<CallerPrincipal | null> {
  if (c.req.raw.headers.has('authorization')) return resolvePresentedRestBearer(c);
  const principal = c.get('principal');
  if (principal) return principal;
  const session = c.get('session');
  if (!session) return null;
  return {
    kind: 'session',
    userId: session.user.id,
    user: session.user,
    session: session.session,
  };
}

function assertRequiredScopes(
  principal: Extract<CallerPrincipal, { kind: 'oauth' }>,
  scopes: readonly (typeof principal.scopes)[number][],
): void {
  const missing = scopes.find((scope) => !principal.scopes.includes(scope));
  if (missing) throw new InsufficientScopeError(missing);
}

async function enforceOperationAccess(
  access: ReturnType<typeof accessForOperation>,
  principal: CallerPrincipal | null,
  next: () => Promise<void>,
): Promise<void> {
  if (!principal) throw new AuthError();
  if (access.kind === 'session-only' && principal.kind === 'oauth') throw new CapabilityError();
  if (access.kind === 'session-or-oauth' && principal.kind === 'oauth') {
    assertRequiredScopes(principal, access.scopes);
  }
  if (access.kind === 'share-token') throw new AuthError();
  await next();
}

/**
 * Enforce the exact operation access policy after the caller principal has been resolved.
 *
 * @throws {AuthError} When an operation requires authentication and no valid principal exists.
 * @throws {CapabilityError} When an OAuth caller reaches a session-only operation.
 * @throws {InsufficientScopeError} When an OAuth token lacks a required operation scope.
 */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const access = accessForOperation(c.req.method, c.req.path);
  const principal = await operationPrincipal(c);
  c.set('principal', principal);

  if (access.kind === 'public' || isPublicControlOperation(c.req.method, c.req.path)) {
    await next();
    return;
  }
  await enforceOperationAccess(access, principal, next);
};
