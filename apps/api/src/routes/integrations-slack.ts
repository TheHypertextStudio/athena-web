/**
 * `@docket/api` — the Slack OAuth connect callback (mounted OUTSIDE the RPC `AppType`).
 *
 * @remarks
 * Slack redirects the user's browser here after they authorize the shared Docket app:
 * `GET /internal/integrations/slack/callback?code=…&state=…` (or `?error=access_denied` when
 * they cancel). Like the GitHub install callback it is a top-level browser navigation, so it
 * lives on `server` rather than the typed router, and the flow context (org + integration +
 * connecting user) arrives in the tamper-proof `state` — the callback itself has no session.
 *
 * The handler verifies the state, exchanges the code for the **user** grant (`xoxp-` token via
 * `oauth.v2.access`; short-circuited to fixtures in local/test), stores the token — sealed via
 * `sealCredential` (this raw Drizzle write bypasses Better Auth's own `encryptOAuthTokens`, so it
 * must encrypt itself) — as a Better Auth `account` row (`providerId='slack'`, credential by
 * reference only), and records the workspace on the integration:
 * `connection.externalWorkspaceId = team_id` is the routing key `/internal/ingest/slack` matches
 * inbound events against, and `externalAccountId = U…` is the identity the relevance resolver
 * matches mentions/DMs/threads against.
 *
 * Failures never 500 a browser redirect: they bounce back to settings with `?slack=error` and
 * the integration is left `error` with a real reason.
 */
import { account, db, integration } from '@docket/db';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';

import { sealCredential } from '../lib/credentials';
import { webAppOrigin } from '../lib/github-app';
import { exchangeSlackCode, verifySlackConnectState } from '../lib/slack-app';

/**
 * Build the redirect back to the org's Connections settings page with a status flag.
 *
 * @remarks
 * Settings are org-scoped (`/orgs/:orgId/settings/connections` is where `IntegrationsTab`
 * reads the `?slack=` return param); with no org recoverable from the state the redirect
 * falls back to the web root, which routes a signed-in user home.
 */
function settingsRedirect(orgId: string | null, status: 'connected' | 'error'): string {
  const base = webAppOrigin();
  if (!orgId) return `${base}/?slack=${status}`;
  return `${base}/orgs/${orgId}/settings/connections?slack=${status}`;
}

/** The Slack OAuth connect callback edge. */
const integrationsSlack = new Hono().get('/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');

  // A tamper-proof state is required: it binds this grant to the org/integration/user that
  // started the flow (and is the CSRF guard). No valid state → bounce to settings as an error.
  const decoded = state ? verifySlackConnectState(state) : null;
  if (!decoded) return c.redirect(settingsRedirect(null, 'error'));

  // The integration must still exist under the org the state claims (existence-hiding guard).
  const [row] = await db
    .select()
    .from(integration)
    .where(
      and(
        eq(integration.id, decoded.integrationId),
        eq(integration.organizationId, decoded.orgId),
        eq(integration.provider, 'slack'),
      ),
    )
    .limit(1);
  if (!row) return c.redirect(settingsRedirect(decoded.orgId, 'error'));

  // The user clicked Cancel on Slack's consent screen (`?error=access_denied`) or no code came
  // back — a clean decline, recorded truthfully rather than treated as an exchange failure.
  if (!code) {
    await db
      .update(integration)
      .set({
        status: 'error',
        lastError: c.req.query('error') ?? 'Slack authorization was not completed',
        lastErrorAt: new Date(),
      })
      .where(eq(integration.id, row.id));
    return c.redirect(settingsRedirect(decoded.orgId, 'error'));
  }

  try {
    const grant = await exchangeSlackCode(code, decoded.userId);

    // Store the xoxp- user token as a Better Auth account row (credential by reference —
    // the integration carries only a credentialsRef). One row per (user, slack account).
    // Sealed (AES-256-GCM, `credentials.ts`) before it ever touches the DB: writing here bypasses
    // Better Auth's own `encryptOAuthTokens` (that only fires inside Better Auth's own handlers),
    // so this raw Drizzle write must encrypt itself rather than land the token in plaintext. Any
    // future reader of `account.accessToken` for `providerId: 'slack'` MUST call
    // `unsealCredential` first — there is no current production reader to keep in sync with.
    const sealedAccessToken = sealCredential(grant.accessToken);
    const [existing] = await db
      .select({ id: account.id })
      .from(account)
      .where(
        and(
          eq(account.userId, decoded.userId),
          eq(account.providerId, 'slack'),
          eq(account.accountId, grant.slackUserId),
        ),
      )
      .limit(1);
    if (existing) {
      await db
        .update(account)
        .set({ accessToken: sealedAccessToken, scope: grant.scope })
        .where(eq(account.id, existing.id));
    } else {
      await db.insert(account).values({
        accountId: grant.slackUserId,
        providerId: 'slack',
        userId: decoded.userId,
        accessToken: sealedAccessToken,
        scope: grant.scope,
      });
    }

    await db
      .update(integration)
      .set({
        status: 'connected',
        lastError: null,
        lastErrorAt: null,
        externalAccountId: grant.slackUserId,
        connection: {
          ...row.connection,
          externalWorkspaceId: grant.teamId,
          account: grant.teamName,
          credentialsRef: `account:slack:${grant.slackUserId}`,
        },
      })
      .where(eq(integration.id, row.id));

    return c.redirect(settingsRedirect(decoded.orgId, 'connected'));
  } catch (err) {
    // The partial unique (org, provider, externalAccountId) surfaces "this Slack account is
    // already connected in this org" here — recorded truthfully like any exchange failure.
    const message =
      err instanceof Error ? err.message : 'Slack authorization could not be completed';
    await db
      .update(integration)
      .set({ status: 'error', lastError: message, lastErrorAt: new Date() })
      .where(eq(integration.id, row.id));
    return c.redirect(settingsRedirect(decoded.orgId, 'error'));
  }
});

export default integrationsSlack;
