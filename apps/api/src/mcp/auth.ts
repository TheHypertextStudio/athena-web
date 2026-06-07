/**
 * `@docket/api` — MCP request authentication + per-org actor resolution.
 *
 * @remarks
 * The MCP endpoint reuses the exact Docket auth stack: it validates the request
 * Origin (a DNS-rebinding guard that allows the configured `MCP_ALLOWED_ORIGINS`
 * plus localhost in dev), resolves a Better Auth session from the request headers
 * (cookie OR `Authorization: Bearer …`), and — per tool/resource call — loads the
 * caller's human {@link actor} within a target org so the handlers can authorize via
 * {@link canActor} before touching data. Nothing here bypasses the permission engine;
 * it only establishes *who* is asking, exactly like {@link orgContextMiddleware}.
 */
import { auth } from '@docket/auth';
import { actor, db } from '@docket/db';
import { and, eq } from 'drizzle-orm';

import { env } from '../env';
import { AuthError, NotFoundError } from '../error';

/**
 * The authenticated MCP caller: the Better Auth user the request resolved to.
 *
 * @remarks
 * Org membership is resolved lazily per call via {@link resolveActor}, because one
 * user may belong to many orgs and each tool/resource targets a specific one.
 */
export interface McpContext {
  /** The Better Auth user id behind the session. */
  readonly userId: string;
  /** The user's display name, when set. */
  readonly userName: string | null;
  /** The user's email. */
  readonly userEmail: string;
}

/**
 * The caller's resolved Actor within one organization, for {@link canActor} checks.
 *
 * @remarks
 * Mirrors the shape {@link orgContextMiddleware} attaches for the RPC routes.
 */
export interface McpActor {
  /** The active organization id. */
  readonly orgId: string;
  /** The caller's human Actor id within that org. */
  readonly actorId: string;
}

/** Whether a host string denotes localhost (any port), used to allow dev origins. */
function isLocalhostHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
}

/**
 * Build the set of explicitly allowed origins from `MCP_ALLOWED_ORIGINS`.
 *
 * @returns the trimmed, non-empty configured origins (empty when unset).
 */
function configuredOrigins(): string[] {
  return (
    env.MCP_ALLOWED_ORIGINS?.split(',')
      .map((s) => s.trim())
      .filter(Boolean) ?? []
  );
}

/**
 * Validate the request `Origin` header (DNS-rebinding protection).
 *
 * @remarks
 * A missing Origin is allowed (non-browser MCP clients — e.g. CLIs — send none).
 * When present, the origin must either be in `MCP_ALLOWED_ORIGINS` or, outside
 * production (`NODE_ENV !== 'production'`), point at localhost. Anything else is
 * rejected so a malicious page cannot drive the local server via DNS rebinding.
 *
 * @param headers - The incoming request headers.
 * @returns true when the origin is acceptable.
 */
export function isOriginAllowed(headers: Headers): boolean {
  const origin = headers.get('origin');
  if (!origin) return true;

  if (configuredOrigins().includes(origin)) return true;

  if (env.NODE_ENV !== 'production') {
    try {
      const { hostname } = new URL(origin);
      if (isLocalhostHost(hostname)) return true;
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * Resolve the authenticated Docket user from request headers, or throw 401.
 *
 * @remarks
 * Delegates to Better Auth's `auth.api.getSession`, which accepts either a session
 * cookie or an `Authorization: Bearer …` token — the same resolution the RPC
 * {@link sessionMiddleware} uses. The Origin guard is applied first.
 *
 * @param headers - The incoming request headers.
 * @returns the resolved {@link McpContext}.
 * @throws {AuthError} When the Origin is rejected or no valid session is present.
 */
export async function resolveMcpContext(headers: Headers): Promise<McpContext> {
  if (!isOriginAllowed(headers)) throw new AuthError('Origin not allowed');

  const session = await auth.api.getSession({ headers });
  if (!session?.user) throw new AuthError();

  return {
    userId: session.user.id,
    userName: session.user.name || null,
    userEmail: session.user.email,
  };
}

/**
 * Resolve the caller's human Actor within `orgId` for capability checks.
 *
 * @remarks
 * Loads the `(userId, orgId)` human actor exactly like {@link orgContextMiddleware};
 * a missing membership 404s (existence-hiding — a non-member must not learn the org
 * exists). The returned `actorId` is what every tool/resource passes to
 * {@link canActor} before reading or writing.
 *
 * @param ctx - The authenticated MCP caller.
 * @param orgId - The organization the caller is acting within.
 * @returns the caller's {@link McpActor} for that org.
 * @throws {NotFoundError} When the caller has no actor in the org.
 */
export async function resolveActor(ctx: McpContext, orgId: string): Promise<McpActor> {
  const rows = await db
    .select({ id: actor.id })
    .from(actor)
    .where(
      and(eq(actor.userId, ctx.userId), eq(actor.organizationId, orgId), eq(actor.kind, 'human')),
    )
    .limit(1);

  const row = rows[0];
  if (!row) throw new NotFoundError();

  return { orgId, actorId: row.id };
}
