/**
 * `@docket/api` — the Linear Agent platform install callback (mounted OUTSIDE the RPC `AppType`).
 *
 * @remarks
 * Linear redirects the user's browser here after an org admin approves the `actor=app` install:
 * `GET /internal/integrations/linear-agent/callback?code=…&state=…`. Like the GitHub App callback
 * (`integrations-github.ts`) and the remote-MCP OAuth callback (`integrations-mcp-oauth.ts`), it
 * is a top-level browser navigation with no Docket session, so it lives on `server` rather than
 * the typed `/v1` router, self-authed by the signed `state` (not `requireAuth`).
 *
 * The handler verifies `state` (carries the org + integration the install is for, tamper-proof
 * via {@link verifyLinearAgentInstallState}), exchanges the `code` for the workspace's Agent
 * install token pair via the boundary adapter's `exchangeLinearAgentCode`, and seals that pair
 * whole (`JSON.stringify` then AES-256-GCM) into the integration's 1:1 `integration_credential`
 * row — the same envelope shape `integrations-mcp-oauth.ts` uses for its OAuth token JSON, so a
 * future consumer reads it the same way: `JSON.parse(unsealCredential(ciphertext))` yields a
 * {@link LinearAgentOAuthTokens}.
 *
 * **Known gap**: this callback does NOT stamp `connection.externalWorkspaceId`/
 * `externalWorkspaceName` the way the generic `integrations.ts` verify path does for the
 * `provider: 'linear'` connector. Linear's Agent-platform boundary adapter
 * (`packages/integrations/src/linear-agent.ts`) exposes only `agentActivityCreate` and
 * `agentSessionUpdate` today — no GraphQL query for the installed workspace's id/name — so
 * resolving those fields here would mean inventing an unverified call against a real Agent app
 * that has never been registered. The integration is still correctly promoted to `connected` on
 * a successful token exchange (the credential is real and proven); a follow-up should add a
 * `resolveInstalledWorkspace`-shaped export to `linear-agent.ts` (e.g. `query { organization { id
 * urlKey name } }` via `LinearAgentClient.query`) once that can be verified against a live app.
 *
 * Failures never 500 a browser redirect: they bounce back to settings with a `?linear_agent=error`
 * flag so the UI can surface a retry, and the integration is left `error` with a real reason.
 */
import { db, integration, integrationCredential } from '@docket/db';
import { exchangeLinearAgentCode, type StoredLinearAgentTokens } from '@docket/integrations';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';

import { sealCredential } from '../lib/credentials';
import { webAppOrigin } from '../lib/github-app';
import {
  linearAgentConfigFromEnv,
  verifyLinearAgentInstallState,
} from '../lib/linear-agent-connect';

/** Build the redirect back to the org's Connections settings page with a status flag. */
function settingsRedirect(orgId: string | null, status: 'connected' | 'error'): string {
  const base = webAppOrigin();
  if (!orgId) return `${base}/?linear_agent=${status}`;
  return `${base}/orgs/${orgId}/settings/connections?linear_agent=${status}`;
}

/** The Linear Agent platform install callback edge. */
const integrationsLinearAgentOAuth = new Hono().get('/callback', async (c) => {
  const state = c.req.query('state');

  // A tamper-proof state is required: it binds this callback to the org/integration that started
  // the flow (and is the CSRF guard). No valid state → bounce to settings as an error.
  const decoded = state ? verifyLinearAgentInstallState(state) : null;
  if (!decoded) return c.redirect(settingsRedirect(null, 'error'));

  const config = linearAgentConfigFromEnv();
  if (!config) return c.redirect(settingsRedirect(decoded.orgId, 'error'));

  // The integration must still exist under the org the state claims (existence-hiding upsert guard).
  const [row] = await db
    .select()
    .from(integration)
    .where(
      and(
        eq(integration.id, decoded.integrationId),
        eq(integration.organizationId, decoded.orgId),
        eq(integration.provider, 'linear_agent'),
      ),
    )
    .limit(1);
  if (!row) return c.redirect(settingsRedirect(decoded.orgId, 'error'));

  // `/install` always resets `status` to `pending` on every call (see
  // `findOrCreateLinearAgentIntegration`'s own remarks), so a `connected` row here means no fresh
  // `/install` has run since this integration last completed — this hit is a stale replay (e.g. a
  // browser back-button resubmit), not a new attempt. Redirect idempotently rather than re-running
  // `exchangeLinearAgentCode` (which would fail against Linear's server, since the code was already
  // consumed) and flipping an already-healthy connection to `error`.
  if (row.status === 'connected') {
    return c.redirect(settingsRedirect(decoded.orgId, 'connected'));
  }

  const code = c.req.query('code');
  if (!code) {
    await db
      .update(integration)
      .set({
        status: 'error',
        lastError: c.req.query('error') ?? 'Linear Agent authorization was not completed',
        lastErrorAt: new Date(),
      })
      .where(eq(integration.id, row.id));
    return c.redirect(settingsRedirect(decoded.orgId, 'error'));
  }

  try {
    const tokens = await exchangeLinearAgentCode({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: config.redirectUri,
      code,
    });

    const stored: StoredLinearAgentTokens = { ...tokens, obtainedAt: new Date().toISOString() };
    const ciphertext = sealCredential(JSON.stringify(stored));
    await db.transaction(async (tx) => {
      await tx
        .insert(integrationCredential)
        .values({ organizationId: row.organizationId, integrationId: row.id, ciphertext })
        .onConflictDoUpdate({
          target: integrationCredential.integrationId,
          set: { ciphertext },
        });

      await tx
        .update(integration)
        .set({
          status: 'connected',
          lastError: null,
          lastErrorAt: null,
          connection: { ...row.connection, credentialsRef: 'integration_credential' },
        })
        .where(eq(integration.id, row.id));
    });

    return c.redirect(settingsRedirect(decoded.orgId, 'connected'));
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Linear Agent installation could not be verified';
    await db
      .update(integration)
      .set({ status: 'error', lastError: message, lastErrorAt: new Date() })
      .where(eq(integration.id, row.id));
    return c.redirect(settingsRedirect(decoded.orgId, 'error'));
  }
});

export default integrationsLinearAgentOAuth;
