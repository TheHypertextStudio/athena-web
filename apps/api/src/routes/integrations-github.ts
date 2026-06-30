/**
 * `@docket/api` — the GitHub App install callback (mounted OUTSIDE the RPC `AppType`).
 *
 * @remarks
 * GitHub redirects the user's browser here after they install the Docket GitHub App:
 * `GET /internal/integrations/github/callback?installation_id=…&setup_action=install&state=…`.
 * It is a top-level browser navigation (not an API/RPC call), so — like `/internal/ingest` and
 * `/api/auth/*` — it lives on `server` rather than the typed router.
 *
 * The handler verifies the signed `state` (which carries the org + integration the install is for,
 * tamper-proof via {@link verifyInstallState}), validates the installation by minting an app token
 * and resolving its account, then records the `installation_id` on the integration's
 * `connection.externalWorkspaceId` — the routing key the webhook firehose matches against
 * (`/internal/ingest/github`). Finally it redirects back to the web app's integration settings.
 *
 * Failures never 500 a browser redirect: they bounce back to settings with a `?github=error` flag
 * so the UI can surface a retry, and the integration is left `error` with a real reason.
 */
import { db, integration } from '@docket/db';
import { mintInstallationToken, resolveInstallationAccount } from '@docket/boundaries';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';

import { githubAppConfigFromEnv, verifyInstallState, webAppOrigin } from '../lib/github-app';

/** Build the redirect back to the web app's integration settings with a status flag. */
function settingsRedirect(status: 'connected' | 'error'): string {
  return `${webAppOrigin()}/settings/integrations?github=${status}`;
}

/** The GitHub App connect callback edge. */
const integrationsGithub = new Hono().get('/callback', async (c) => {
  const installationId = c.req.query('installation_id');
  const state = c.req.query('state');

  // A tamper-proof state is required: it binds this installation to the org/integration that
  // started the flow (and is the CSRF guard). No valid state → bounce to settings as an error.
  const decoded = state ? verifyInstallState(state) : null;
  if (!decoded || !installationId) {
    return c.redirect(settingsRedirect('error'));
  }

  const config = githubAppConfigFromEnv();
  if (!config) return c.redirect(settingsRedirect('error'));

  // The integration must still exist under the org the state claims (existence-hiding upsert guard).
  const [row] = await db
    .select()
    .from(integration)
    .where(
      and(
        eq(integration.id, decoded.integrationId),
        eq(integration.organizationId, decoded.orgId),
        eq(integration.provider, 'github'),
      ),
    )
    .limit(1);
  if (!row) return c.redirect(settingsRedirect('error'));

  try {
    // Validate the installation for real (and label it) before recording it: mint a token and
    // resolve the installed account. A bad/uninstalled id throws and is recorded truthfully.
    const nowSeconds = Math.floor(Date.now() / 1000);
    await mintInstallationToken(config, installationId, nowSeconds);
    const account = await resolveInstallationAccount(config, installationId, nowSeconds);

    await db
      .update(integration)
      .set({
        status: 'connected',
        lastError: null,
        lastErrorAt: null,
        connection: {
          ...row.connection,
          externalWorkspaceId: installationId,
          ...(account ? { account } : {}),
        },
      })
      .where(eq(integration.id, row.id));

    return c.redirect(settingsRedirect('connected'));
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'GitHub installation could not be verified';
    await db
      .update(integration)
      .set({ status: 'error', lastError: message, lastErrorAt: new Date() })
      .where(eq(integration.id, row.id));
    return c.redirect(settingsRedirect('error'));
  }
});

export default integrationsGithub;
