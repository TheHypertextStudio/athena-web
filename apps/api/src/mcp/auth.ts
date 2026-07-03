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
import { MCP_SCOPES } from './scope';

/**
 * Who an MCP call is executing as: an authenticated human user (cookie/Bearer paths)
 * or an internal agent principal (Athena's in-process loop; see
 * {@link import('./internal-session').internalAgentContext}).
 *
 * @remarks
 * A discriminated union — not a `userId`-shaped bag with agent fields bolted on — so
 * every identity-sensitive consumer (actor resolution, cursor signing, task-store
 * ownership, prompt personalization, hub resources) must decide explicitly what an
 * agent principal means for it. Agents never carry a Better Auth user.
 */
export type McpPrincipal =
  | {
      /** A human user resolved from a Better Auth session or access token. */
      readonly kind: 'user';
      /** The Better Auth user id behind the session. */
      readonly userId: string;
      /** The user's display name, when set. */
      readonly userName: string | null;
      /** The user's email. */
      readonly userEmail: string;
    }
  | {
      /** An org-registered agent acting through the in-process MCP server. */
      readonly kind: 'agent';
      /** The `agent` registration row id. */
      readonly agentId: string;
      /** The backing `agent`-kind Actor id — the identity it acts and is audited as. */
      readonly agentActorId: string;
      /** The one organization this principal exists in (agents are org-scoped). */
      readonly orgId: string;
      /** The agent Actor's display name (e.g. "Athena"). */
      readonly displayName: string;
    };

/**
 * The authenticated MCP caller: who is asking ({@link McpPrincipal}) plus the verified
 * OAuth scopes the call carries.
 *
 * @remarks
 * Org membership is resolved lazily per call via {@link resolveActor}, because one
 * user may belong to many orgs and each tool/resource targets a specific one. `scopes`
 * is the FIRST authorization layer (mcp-surface.md §2.2): each tool/resource gates on it
 * via {@link import('./scope').requireScope} BEFORE the per-org grant check.
 */
export interface McpContext {
  /** Who is asking. */
  readonly principal: McpPrincipal;
  /**
   * The verified OAuth scopes the caller carries (mcp-surface.md §2.2). A first-party
   * cookie session carries the full set (it has already consented to the whole app); a
   * Bearer access token carries only its granted, audience-bound scopes; an internal
   * agent principal carries the fixed agent-session set (never `connectors:link`).
   */
  readonly scopes: readonly string[];
}

/** The minimal `getMcpSession` result shape the RS reads (Better Auth `OAuthAccessToken`). */
interface McpSession {
  /** The bearer access token string. */
  readonly accessToken: string;
  /** The subject (Better Auth user id) the token was minted for. */
  readonly userId: string;
  /** The space-separated scope string the token carries. */
  readonly scopes: string;
}

/** The slice of `auth.api` the Bearer path uses (present only once `mcp()` is mounted). */
interface McpAuthApi {
  getMcpSession?: (args: { headers: Headers }) => Promise<McpSession | null>;
}

type GetMcpSession = NonNullable<McpAuthApi['getMcpSession']>;

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

/** Whether the request presents an OAuth `Authorization: Bearer …` access token. */
function bearerToken(headers: Headers): string | null {
  const raw = headers.get('authorization');
  if (!raw) return null;
  const match = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return match ? (match[1]?.trim() ?? null) : null;
}

function getMcpSessionApi(): GetMcpSession | null {
  const descriptor: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(
    auth.api,
    'getMcpSession',
  );
  const candidate: unknown = descriptor?.value;
  return typeof candidate === 'function' ? (candidate as GetMcpSession) : null;
}

/**
 * Resolve an OAuth Bearer access token into an {@link McpContext}, enforcing the RS
 * checks (audience + issuer binding + scope availability) of mcp-surface.md §2.5.
 *
 * @remarks
 * Uses Better Auth's `auth.api.getMcpSession`, which is mounted only when the `mcp()`
 * plugin is configured (real `MCP_RESOURCE_URL` + `OIDC_LOGIN_PAGE_URL`). The plugin
 * resolves the token **bound to the configured `resource`** (the canonical RS URI), which
 * IS the RFC 8707 audience binding: a token minted for any other resource does not resolve
 * here. We additionally require the RS to be configured for OAuth (`MCP_RESOURCE_URL` +
 * `MCP_ISSUER_URL`) so a deploy that never advertised an issuer cannot silently accept
 * bearer tokens. The token's granted scopes (a space-separated string) become the caller's
 * verified scope set; **no scope is granted that the token did not carry** — and the token
 * itself is never forwarded downstream (no passthrough; connector calls use Integration
 * credentials).
 *
 * @param headers - The incoming request headers (carrying the Bearer token).
 * @param token - The extracted bearer token string.
 * @returns the resolved {@link McpContext} with the token's verified scopes.
 * @throws {AuthError} When OAuth is not configured, the helper is unavailable, or the
 *   token does not resolve to an audience-bound session.
 */
async function resolveBearerContext(headers: Headers, token: string): Promise<McpContext> {
  // Issuer binding (§2.5 item 3): the RS only accepts tokens once it advertises an issuer
  // + canonical resource. Absent that config, a Bearer token is rejected outright (it
  // cannot have been minted by *this* AS for *this* resource).
  if (!env.MCP_ISSUER_URL || !env.MCP_RESOURCE_URL) {
    throw new AuthError('Bearer tokens are not accepted on this resource');
  }

  const getMcpSession = getMcpSessionApi();
  /* v8 ignore next -- @preserve defensive: getMcpSession exists whenever mcp() is mounted, which the issuer guard above requires */
  if (!getMcpSession) {
    throw new AuthError('Bearer tokens are not accepted on this resource');
  }

  // `getMcpSession` validates the token AND its audience binding to the configured
  // `resource` (RFC 8707) — a mismatched/foreign-audience token resolves to null here.
  const session = await getMcpSession({ headers });
  if (session?.accessToken !== token) throw new AuthError();

  const scopes = session.scopes
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  // The user record backs the display name/email the prompts/resources surface.
  const user = await auth.api.getSession({ headers });
  const name = user?.user.name ?? '';
  return {
    principal: {
      kind: 'user',
      userId: session.userId,
      // An empty display name normalizes to null, exactly like the cookie path.
      userName: name === '' ? null : name,
      userEmail: user?.user.email ?? '',
    },
    scopes,
  };
}

/**
 * Resolve the authenticated Docket caller from request headers, or throw 401.
 *
 * @remarks
 * Two paths (mcp-surface.md §2.5):
 * - **OAuth Bearer** — when an `Authorization: Bearer …` token is present, it is validated
 *   as an audience-bound MCP access token via {@link resolveBearerContext}; the caller's
 *   scope set is exactly what the token carries (the scope layer then gates each call).
 * - **First-party cookie session** — a Better Auth session cookie (the same resolver the
 *   RPC {@link sessionMiddleware} uses) authenticates first-party clients (Docket web,
 *   Athena planner) that have already consented to the whole app; they carry the FULL
 *   scope set, so the scope layer is a no-op and only the per-org grant cascade gates.
 *
 * The Origin guard (DNS-rebinding) is applied first in both cases.
 *
 * @param headers - The incoming request headers.
 * @returns the resolved {@link McpContext} (incl. verified scopes).
 * @throws {AuthError} When the Origin is rejected or no valid token/session is present.
 */
export async function resolveMcpContext(headers: Headers): Promise<McpContext> {
  if (!isOriginAllowed(headers)) throw new AuthError('Origin not allowed');

  const token = bearerToken(headers);
  if (token) return resolveBearerContext(headers, token);

  const session = await auth.api.getSession({ headers });
  if (!session?.user) throw new AuthError();

  return {
    principal: {
      kind: 'user',
      userId: session.user.id,
      userName: session.user.name || null,
      userEmail: session.user.email,
    },
    // A consented first-party session is granted the full scope set; the granular per-org
    // grant cascade remains the binding authorization layer for it.
    scopes: [...MCP_SCOPES],
  };
}

/**
 * Resolve the caller's Actor within `orgId` for capability checks.
 *
 * @remarks
 * User principals load their `(userId, orgId)` human actor exactly like
 * {@link orgContextMiddleware}; agent principals resolve to their own agent Actor —
 * but only within the one org they exist in. Either way a mismatch 404s
 * (existence-hiding — a non-member must not learn the org exists). The returned
 * `actorId` is what every tool/resource passes to {@link canActor} before reading or
 * writing, so agents traverse the identical grant cascade humans do.
 *
 * @param ctx - The authenticated MCP caller.
 * @param orgId - The organization the caller is acting within.
 * @returns the caller's {@link McpActor} for that org.
 * @throws {NotFoundError} When the caller has no actor in the org.
 */
export async function resolveActor(ctx: McpContext, orgId: string): Promise<McpActor> {
  if (ctx.principal.kind === 'agent') {
    if (ctx.principal.orgId !== orgId) throw new NotFoundError();
    return { orgId, actorId: ctx.principal.agentActorId };
  }

  const rows = await db
    .select({ id: actor.id })
    .from(actor)
    .where(
      and(
        eq(actor.userId, ctx.principal.userId),
        eq(actor.organizationId, orgId),
        eq(actor.kind, 'human'),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) throw new NotFoundError();

  return { orgId, actorId: row.id };
}
