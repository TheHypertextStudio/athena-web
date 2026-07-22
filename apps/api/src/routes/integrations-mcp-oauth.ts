/**
 * Browser callback for remote MCP OAuth approvals.
 *
 * @remarks
 * This route has no Docket session because authorization servers redirect the user agent here.
 * The signed state binds the response to one org integration and the encrypted pending
 * credential holds the PKCE verifier and client-registration state needed by the MCP SDK.
 */
import { completeMcpOAuthAuthorization, parseMcpOAuthCredential } from '@docket/integrations';
import { db, integration, integrationCredential } from '@docket/db';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';

import { env } from '../env';
import { sealCredential, unsealCredential } from '../lib/credentials';
import { webAppOrigin } from '../lib/github-app';
import { verifyConnectState } from '../lib/oauth-state';
import { verifyIntegration } from './integrations-mcp';

interface McpConfig {
  readonly url: string;
  readonly authMode?: 'oauth' | 'bearer' | 'none';
}

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
    const pending = credentialRow?.ciphertext
      ? parseMcpOAuthCredential(unsealCredential(credentialRow.ciphertext))
      : null;
    if (pending?.kind !== 'mcp_oauth_pending') {
      throw new Error('MCP OAuth approval is no longer active');
    }
    const config = row.config as unknown as McpConfig;
    if (config.authMode !== 'oauth') throw new Error('MCP server is not configured for OAuth');
    const approved = await completeMcpOAuthAuthorization({
      serverUrl: config.url,
      redirectUrl: redirectUrl(),
      authorizationCode: code,
      credential: pending,
    });
    await db
      .update(integrationCredential)
      .set({ ciphertext: sealCredential(JSON.stringify(approved)) })
      .where(eq(integrationCredential.integrationId, row.id));
    const verified = await verifyIntegration(row);
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
