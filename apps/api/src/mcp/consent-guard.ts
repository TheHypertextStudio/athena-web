/**
 * `@docket/api` — consent enforcement for the MCP OAuth authorize route.
 *
 * @remarks
 * Better Auth 1.6.14's `mcp()` authorize endpoint only routes through the consent page
 * when the client sends `prompt=consent` — a client that omits it is issued a code
 * silently (mcp/authorize.mjs stores `requireConsent: query.prompt === "consent"`).
 * Docket's authorization model (mcp-surface.md §2.2) requires every third-party client
 * to pass the human consent gate once per scope set, and the Settings → Authorized apps
 * roster is built from the `oauth_consent` rows that gate writes.
 *
 * This guard reinstates standard OAuth consent semantics in front of Better Auth: an
 * authorize request without `prompt=consent` whose (client, user) pair has no stored
 * consent covering the requested scopes is 302-redirected to the SAME URL with
 * `prompt=consent` appended — which makes Better Auth run its consent-page branch.
 * Requests with a covering consent (or no session yet — Better Auth handles the login
 * redirect and the retried authorize passes back through here) proceed untouched.
 */
import { db, oauthConsent } from '@docket/db';
import { and, eq } from 'drizzle-orm';
import type { Context, Next } from 'hono';

import type { AppEnv } from '../context';

/** Whether the user has a stored consent for `clientId` covering every requested scope. */
async function hasCoveringConsent(
  clientId: string,
  userId: string,
  requestedScopes: readonly string[],
): Promise<boolean> {
  const rows = await db
    .select({ scopes: oauthConsent.scopes, consentGiven: oauthConsent.consentGiven })
    .from(oauthConsent)
    .where(and(eq(oauthConsent.clientId, clientId), eq(oauthConsent.userId, userId)));
  return rows.some((row) => {
    if (!row.consentGiven) return false;
    const consented = row.scopes.split(' ').filter(Boolean);
    return requestedScopes.every((scope) => consented.includes(scope));
  });
}

/**
 * Enforce the consent gate on `/api/auth/mcp/authorize`.
 *
 * @param c - The authorize request context (session resolved by {@link sessionMiddleware}).
 * @param next - The next handler, normally the Better Auth handler.
 */
export async function mcpConsentGuard(
  c: Context<AppEnv>,
  next: Next,
): Promise<Response | undefined> {
  // Already routed to consent — Better Auth will show the consent page.
  if (c.req.query('prompt') === 'consent') {
    await next();
    return undefined;
  }

  const clientId = c.req.query('client_id');
  const session = c.var.session;
  // Malformed requests and signed-out users are Better Auth's to reject/redirect; the
  // post-login authorize retry passes back through this guard with a session.
  if (!clientId || !session?.user) {
    await next();
    return undefined;
  }

  const requestedScopes = (c.req.query('scope') ?? '').split(' ').filter(Boolean);
  if (await hasCoveringConsent(clientId, session.user.id, requestedScopes)) {
    await next();
    return undefined;
  }

  const url = new URL(c.req.url);
  url.searchParams.set('prompt', 'consent');
  return c.redirect(`${url.pathname}?${url.searchParams.toString()}`, 302);
}
