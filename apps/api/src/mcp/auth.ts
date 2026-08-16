/**
 * `@docket/api` — MCP request authentication + per-org actor resolution.
 *
 * @remarks
 * The MCP endpoint validates the request Origin, resolves an OAuth access token from
 * `Authorization: Bearer …`, and — per tool/resource call — loads the
 * caller's human {@link actor} within a target org so the handlers can authorize via
 * {@link canActor} before touching data. Nothing here bypasses the permission engine;
 * it only establishes *who* is asking, exactly like {@link orgContextMiddleware}.
 */
import { verifyAccessToken } from '@docket/auth';
import { actor, db, oauthClient, oauthConsent, user as userTable } from '@docket/db';
import { and, eq } from 'drizzle-orm';

import { env } from '../env';
import { AuthError, CapabilityError, NotFoundError } from '../error';
import { assertProductCapability } from '../product-capability';

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
  /**
   * The registered OAuth client the call arrived through (the token's verified `azp`).
   *
   * @remarks
   * Set ONLY by the Bearer path, where a registered client actually exists; absent for a
   * first-party cookie session and for the internal agent path, so "no client" has one
   * spelling and {@link resolveBearerContext} stays the field's only writer. Consumers read
   * it as `ctx.clientId ?? null`.
   *
   * This is what lets an audit row name *which* connected client did something without the
   * schema ever naming one (curfew-integration.md §3.3) — it is attribution only, never an
   * authorization input; the scope and grant layers alone decide what a call may do.
   */
  readonly clientId?: string | null;
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

/** Whether a host string denotes localhost (any port), used for local development. */
function isLocalhostHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
}

/**
 * Validate the request `Origin` header without identifying client vendors.
 *
 * @remarks
 * Native clients commonly omit Origin. A browser origin must be an exact HTTPS origin.
 * Local development additionally permits HTTP loopback origins outside production.
 * OAuth establishes client identity; no deployment-time vendor list participates.
 *
 * @param headers - The incoming request headers.
 * @returns true when the origin is acceptable.
 */
export function isOriginAllowed(headers: Headers): boolean {
  const origin = headers.get('origin');
  if (!origin) return true;

  try {
    const url = new URL(origin);
    if (url.origin !== origin || url.username || url.password) return false;
    if (url.protocol === 'https:') return true;
    return (
      env.NODE_ENV !== 'production' && url.protocol === 'http:' && isLocalhostHost(url.hostname)
    );
  } catch {
    return false;
  }
}

/** Whether the request presents an OAuth `Authorization: Bearer …` access token. */
function bearerToken(headers: Headers): string | null {
  const raw = headers.get('authorization');
  if (!raw) return null;
  const match = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return match ? (match[1]?.trim() ?? null) : null;
}

/**
 * Resolve an OAuth Bearer access token into an {@link McpContext}, enforcing the RS
 * checks (audience + issuer binding + scope availability) of mcp-surface.md §2.5.
 *
 * @remarks
 * Verifies the token as a locally-checkable JWT via Better Auth's `verifyAccessToken`
 * (`jose`-based signature check against the AS's own `/jwks` endpoint, cached).
 * `audience`/`issuer` are checked against `MCP_RESOURCE_URL`/`MCP_ISSUER_URL` — a token minted for
 * any other resource or by any other issuer fails verification outright, which IS the RFC 8707
 * audience binding. The token's `scope` claim becomes the caller's verified scope set; **no scope
 * is granted that the token did not carry** — and the token itself is never forwarded downstream
 * (no passthrough; connector calls use Integration credentials).
 *
 * Signature/audience/expiry are necessary but not sufficient: the grant behind the token must
 * still stand. {@link isGrantLive} re-checks it on every call, so removing an app from the
 * Connected apps screen stops it at the very next request rather than whenever its token happens
 * to expire.
 *
 * @param token - The extracted bearer token string.
 * @returns the resolved {@link McpContext} with the token's verified scopes.
 * @throws {AuthError} When OAuth is not configured, the token fails verification, or the caller
 * has revoked (or never granted) the client the token names.
 */
/**
 * The OAuth issuer identifier — Better Auth's mount point, NOT the bare API origin.
 *
 * @remarks
 * `MCP_ISSUER_URL` names the API origin because that is what a deploy configures, but the
 * authorization server is Better Auth mounted at `/api/auth`: its discovery document advertises
 * `issuer: <origin>/api/auth` and it stamps that same value into every access token's `iss`.
 * Verifying against the bare origin therefore rejects every token the AS issues, and a PRM that
 * points `authorization_servers` at the bare origin names something that is not an issuer.
 * One helper so the advertised issuer, the verified issuer, and the JWKS location cannot drift.
 *
 * @returns the issuer identifier, or `null` when the RS is not configured for OAuth.
 */
export function oauthIssuer(): string | null {
  const origin = env.MCP_ISSUER_URL?.replace(/\/$/, '');
  return origin ? `${origin}/api/auth` : null;
}

/**
 * Whether the caller's grant for `clientId` is still standing.
 *
 * @remarks
 * The check that makes revocation **immediate** rather than eventual: a third-party developer's
 * consent screen must accurately describe live access, so revoking a grant from the user's
 * settings has to make the very next call fail, not merely stop future token issuance. Docket's
 * access tokens are self-contained JWTs, so `verifyAccessToken` alone proves only that this AS minted the
 * token for this resource and that it has not expired — it says nothing about whether the person
 * has since removed the app from their Connected apps screen. Without this lookup a revoked client
 * kept working for the remainder of the token's 15-minute lifetime, which is precisely the window
 * someone revoking a suspicious app is trying to close.
 *
 * The grant record is the `oauthConsent` row `DELETE /v1/me/connected-apps/:clientId` deletes. One
 * class of client legitimately has none: a client registered with `skip_consent` never runs the
 * consent screen, so for those the registration itself *is* the authorization and the client row is
 * what is checked. A `disabled` client fails either way.
 *
 * Cost is one indexed read on `(client_id, user_id)` per call, alongside the user read this path
 * already performs — the earlier "no DB round-trip per call" property was never true of this
 * function, and correctness on revocation is worth strictly more than the round-trip it saves.
 *
 * @param clientId - The `azp` claim: the OAuth client the token was minted for.
 * @param userId - The token's subject.
 * @returns true when the client is registered, enabled, and still authorized by this user.
 */
async function isGrantLive(clientId: string, userId: string): Promise<boolean> {
  const clients = await db
    .select({ disabled: oauthClient.disabled, skipConsent: oauthClient.skipConsent })
    .from(oauthClient)
    .where(eq(oauthClient.clientId, clientId))
    .limit(1);

  const client = clients[0];
  if (!client || client.disabled === true) return false;
  if (client.skipConsent === true) return true;

  const consents = await db
    .select({ id: oauthConsent.id })
    .from(oauthConsent)
    .where(and(eq(oauthConsent.clientId, clientId), eq(oauthConsent.userId, userId)))
    .limit(1);

  return consents.length > 0;
}

async function resolveBearerContext(token: string): Promise<McpContext> {
  // Issuer binding (§2.5 item 3): the RS only accepts tokens once it advertises an issuer
  // + canonical resource. Absent that config, a Bearer token is rejected outright (it
  // cannot have been minted by *this* AS for *this* resource).
  const issuer = oauthIssuer();
  if (!issuer || !env.MCP_RESOURCE_URL) {
    throw new AuthError('Bearer tokens are not accepted on this resource');
  }

  let payload: Awaited<ReturnType<typeof verifyAccessToken>>;
  try {
    payload = await verifyAccessToken(token, {
      verifyOptions: { audience: env.MCP_RESOURCE_URL, issuer },
      jwksUrl: `${issuer}/jwks`,
    });
  } catch {
    throw new AuthError();
  }

  const userId = typeof payload.sub === 'string' ? payload.sub : null;
  if (!userId) throw new AuthError();

  // `azp` is the authorized party — the OAuth client the AS minted this token for. Better Auth's
  // `oauthProvider` stamps it onto every access token it issues, so a token that reaches here
  // without one did not come from the authorization-code flow and cannot have its grant checked;
  // refusing is the only answer that keeps revocation meaningful.
  const clientClaim = payload['azp'];
  const clientId = typeof clientClaim === 'string' && clientClaim !== '' ? clientClaim : null;
  if (!clientId) throw new AuthError();
  if (!(await isGrantLive(clientId, userId))) throw new AuthError();

  const scopeClaim = payload['scope'];
  const scopes = (typeof scopeClaim === 'string' ? scopeClaim : '')
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  // The user record backs the display name/email the prompts/resources surface — read
  // directly by the token's `sub`, independent of any session cookie (there may be none).
  const rows = await db
    .select({ name: userTable.name, email: userTable.email })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
  const row = rows[0];
  const name = row?.name ?? '';

  return {
    principal: {
      kind: 'user',
      userId,
      // An empty display name normalizes to null (not the literal `''`).
      userName: name === '' ? null : name,
      userEmail: row?.email ?? '',
    },
    scopes,
    clientId,
  };
}

/**
 * Resolve the authenticated Docket caller from request headers, or throw 401.
 *
 * @remarks
 * The OAuth Bearer token is validated as an audience-bound MCP access token via
 * {@link resolveBearerContext}; the caller receives exactly the scopes in that token.
 * Browser session cookies are ignored on this public resource. Athena uses its separate
 * in-process principal path.
 *
 * @param headers - The incoming request headers.
 * @returns the resolved {@link McpContext} (incl. verified scopes).
 * @throws {CapabilityError} When a present Origin is invalid.
 * @throws {AuthError} When no valid Bearer token is present.
 */
export async function resolveMcpContext(headers: Headers): Promise<McpContext> {
  if (!isOriginAllowed(headers)) throw new CapabilityError('Origin not allowed');

  const token = bearerToken(headers);
  if (token) return resolveBearerContext(token);
  throw new AuthError();
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
    await assertProductCapability(orgId, 'mcp');
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

  await assertProductCapability(orgId, 'mcp');

  return { orgId, actorId: row.id };
}
