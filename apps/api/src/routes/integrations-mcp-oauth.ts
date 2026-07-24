/**
 * Browser callback for remote MCP OAuth approvals.
 *
 * @remarks
 * This route has no REQUIRED Docket session — authorization servers redirect the user agent here,
 * and the round trip may not always carry a recognizable session cookie back, so nothing here
 * forces one. The signed state binds the response to one org integration and the encrypted
 * pending credential holds the PKCE verifier and client-registration state needed by the MCP SDK.
 * When a session IS present on this request, its user is softly checked against the state's
 * signed `authUserId` claim (see the check below) as an extra CSRF-defense layer — but its absence
 * is never itself treated as a failure.
 */
import { completeMcpOAuthAuthorization, parseMcpOAuthCredential } from '@docket/integrations';
import { auth } from '@docket/auth';
import { db, integration, integrationCredential } from '@docket/db';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';

import { env } from '../env';
import { sealCredential, unsealCredential } from '../lib/credentials';
import { webAppOrigin } from '../lib/github-app';
import { verifyConnectState } from '../lib/oauth-state';
import { mcpConfig, verifyIntegration } from './integrations-mcp';

/** Return to the Athena settings screen (where MCP connectors now live) with status copy. */
function settingsRedirect(status: 'connected' | 'error'): string {
  const base = webAppOrigin();
  return `${base}/settings/athena?mcp=${status}`;
}

/** The same callback URL supplied when the approval was initiated. */
function redirectUrl(): string {
  return `${env.API_URL}/internal/integrations/mcp/callback`;
}

/** The remote MCP OAuth callback edge. */
const integrationsMcpOAuth = new Hono().get('/callback', async (c) => {
  const state = c.req.query('state');
  const decoded = state ? verifyConnectState(state) : null;
  const integrationId = decoded?.['integrationId'];
  const orgId = decoded?.['orgId'];
  if (typeof integrationId !== 'string' || typeof orgId !== 'string') {
    return c.redirect(settingsRedirect('error'));
  }

  // Soft session binding: if this browser happens to carry a valid Docket session (its cookie can
  // survive the third-party redirect round trip via a top-level GET navigation), require it to
  // belong to the same person who started the flow. Never require a session to be present — that
  // would break the documented "works even without one" design this route otherwise depends on —
  // this only rejects a session that IS present but belongs to someone else.
  const authUserId = decoded?.['authUserId'];
  if (typeof authUserId === 'string') {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (session && session.user.id !== authUserId) {
      return c.redirect(settingsRedirect('error'));
    }
  }

  const [row] = await db
    .select()
    .from(integration)
    .where(
      and(
        eq(integration.id, integrationId),
        eq(integration.organizationId, orgId),
        eq(integration.provider, 'mcp'),
      ),
    )
    .limit(1);
  if (!row) return c.redirect(settingsRedirect('error'));

  const code = c.req.query('code');
  if (!code) {
    await db
      .update(integration)
      .set({
        status: 'error',
        lastError: c.req.query('error') ?? 'MCP authorization was not completed',
        lastErrorAt: new Date(),
      })
      .where(eq(integration.id, row.id));
    return c.redirect(settingsRedirect('error'));
  }

  try {
    const [credentialRow] = await db
      .select({ ciphertext: integrationCredential.ciphertext })
      .from(integrationCredential)
      .where(eq(integrationCredential.integrationId, row.id))
      .limit(1);
    const parsed = credentialRow?.ciphertext
      ? parseMcpOAuthCredential(unsealCredential(credentialRow.ciphertext))
      : null;
    // `/authorize` always overwrites this row with a fresh `mcp_oauth_pending` kind before
    // redirecting, so an already-`mcp_oauth` (approved) kind here means no new `/authorize` has
    // run since this integration last completed — this hit is a stale replay (e.g. a browser
    // back-button resubmit), not a new attempt. Redirect idempotently rather than re-running the
    // exchange (which would fail against the remote server, since the code was already consumed)
    // and flipping an already-healthy connection to `error`.
    if (parsed?.kind === 'mcp_oauth') {
      return c.redirect(settingsRedirect(row.status === 'connected' ? 'connected' : 'error'));
    }
    if (parsed?.kind !== 'mcp_oauth_pending') {
      throw new Error('MCP OAuth approval is no longer active');
    }
    const config = mcpConfig(row);
    if (config.authMode !== 'oauth') throw new Error('MCP server is not configured for OAuth');
    const approved = await completeMcpOAuthAuthorization({
      serverUrl: config.url,
      redirectUrl: redirectUrl(),
      authorizationCode: code,
      credential: parsed,
    });
    await db
      .update(integrationCredential)
      .set({ ciphertext: sealCredential(JSON.stringify(approved)) })
      .where(eq(integrationCredential.integrationId, row.id));
    // Stamp the actually-granted scope onto the row's own (non-secret) config before verifying —
    // visibility only, since Docket never requests or enforces a specific scope from an arbitrary
    // remote MCP server. `verifyIntegration` re-derives its own config from the row it's given and
    // persists both fields together in its own success-path write, so this never clobbers or races
    // that update.
    const withScope = {
      ...row,
      config: { ...config, oauthScope: approved.tokens.scope ?? null },
    };
    const verified = await verifyIntegration(withScope);
    return c.redirect(settingsRedirect(verified.status === 'connected' ? 'connected' : 'error'));
  } catch (cause) {
    await db
      .update(integration)
      .set({
        status: 'error',
        lastError: cause instanceof Error ? cause.message : 'MCP authorization failed',
        lastErrorAt: new Date(),
      })
      .where(eq(integration.id, row.id));
    return c.redirect(settingsRedirect('error'));
  }
});

export default integrationsMcpOAuth;
