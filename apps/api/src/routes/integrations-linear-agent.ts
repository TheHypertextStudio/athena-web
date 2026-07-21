/**
 * `@docket/api` — Linear **Agent** platform install router (`/v1/orgs/:orgId/integrations/linear-agent`).
 *
 * @remarks
 * Installing the Agent app is a workspace-level, admin-only grant (`actor=app`) — a categorically
 * different relationship from the `provider: 'linear'` data-sync connector the generic
 * `integrations.ts` router manages, so it gets its own small sub-router the same way remote MCP
 * servers do (`integrations-mcp.ts`). The only action this router exposes is `GET /install`: it
 * find-or-creates the org's single `provider: 'linear_agent'` integration row and returns the
 * signed-state authorize URL the client redirects the browser to. Everything else about the row
 * (listing, disconnect) is already covered generically by `integrations.ts`'s `GET /` and
 * `DELETE /:id`, which don't discriminate by provider.
 *
 * The actual OAuth code exchange happens on `GET /internal/integrations/linear-agent/callback`
 * (`integrations-linear-agent-oauth.ts`), mounted OUTSIDE this typed `AppType` router — Linear
 * redirects the user's browser there directly, not through the RPC contract.
 */
import { db, integration } from '@docket/db';
import { and, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { buildLinearAgentAuthorizeUrl } from '@docket/integrations';

import type { AppEnv } from '../context';
import { ConflictError } from '../error';
import { linearAgentConfigFromEnv, signLinearAgentInstallState } from '../lib/linear-agent-connect';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { capabilityGuard } from '../permissions/capability-guard';

/** The response shape of `GET /install`: the browser-redirect target. */
const linearAgentInstallOut = z.object({ url: z.url() });

/**
 * Find the org's existing single-install `provider: 'linear_agent'` row, or create one.
 *
 * @remarks
 * Mirrors the idempotent-per-`(org, provider)` matching `integrations.ts`'s `POST /` uses for
 * legacy single-account providers: `externalAccountId` stays `null` for this pattern (there is
 * no per-user account to bind — the install is a single workspace-level grant), so the match is
 * `(organizationId, provider, externalAccountId IS NULL)` rather than the partial unique index
 * (which only applies when `externalAccountId IS NOT NULL`). Reconnecting reuses the row (reset
 * to `pending`) so the integration id — and thus `agent_session_external_link` routing built on
 * top of it — stays stable across reinstalls.
 */
async function findOrCreateLinearAgentIntegration(
  orgId: string,
  actorId: string,
): Promise<typeof integration.$inferSelect> {
  const existing = await db
    .select()
    .from(integration)
    .where(
      and(
        eq(integration.organizationId, orgId),
        eq(integration.provider, 'linear_agent'),
        isNull(integration.externalAccountId),
      ),
    )
    .limit(1);

  if (existing[0]) {
    const updated = await db
      .update(integration)
      .set({ status: 'pending', lastError: null, lastErrorAt: null })
      .where(eq(integration.id, existing[0].id))
      .returning();
    const row = updated[0];
    /* v8 ignore next -- @preserve defensive: update-by-id on a row just selected always returns one */
    if (!row) throw new Error('linear_agent integration update returned no row');
    return row;
  }

  const inserted = await db
    .insert(integration)
    .values({
      organizationId: orgId,
      provider: 'linear_agent',
      pattern: 'agent',
      roles: [],
      createdBy: actorId,
    })
    .returning();
  const row = inserted[0];
  /* v8 ignore next -- @preserve defensive: insert always returns a row */
  if (!row) throw new Error('linear_agent integration insert returned no row');
  return row;
}

/** The Linear Agent install router: a single action, `GET /install`. */
const integrationsLinearAgent = new Hono<AppEnv>().get(
  '/install',
  capabilityGuard('manage'),
  apiDoc({
    tag: 'Integrations',
    summary: 'Get the Linear Agent platform install URL',
    capability: 'manage',
    response: linearAgentInstallOut,
    description: `Return the **install URL** the client redirects the browser to in order to install Docket as a Linear Agent (\`actor=app\`) into the organization's Linear workspace. This is distinct from connecting Linear as a data-sync provider (\`POST /:orgId/integrations\` with \`provider: 'linear'\`): the Agent install is a single, workspace-level admin grant that lets Docket appear as an assignable/mentionable agent inside Linear, not a per-user import/mirror connection.

Find-or-creates the org's single \`provider: 'linear_agent'\` integration row (\`pending\` until the callback completes), signs a short-lived \`state\` binding this install to the org/integration (CSRF + tamper protection across the redirect round-trip), and returns \`{ url }\`. A 409 (\`The Linear Agent app is not configured…\`) means \`LINEAR_AGENT_CLIENT_ID\`/\`LINEAR_AGENT_CLIENT_SECRET\`/\`LINEAR_AGENT_WEBHOOK_SECRET\` are unset in this deploy.

Requires \`manage\` — installing an app-level agent grant is an administrative trust decision, the same bar as \`GET /:id/connect-url\` for the GitHub App. Related: \`GET /\` (the row appears there once created, like any integration), \`DELETE /:id\` (uninstall).`,
  }),
  async (c) => {
    const { orgId, actorId } = c.get('actorCtx');

    const config = linearAgentConfigFromEnv();
    if (!config) {
      throw new ConflictError(
        'The Linear Agent app is not configured (LINEAR_AGENT_CLIENT_ID/LINEAR_AGENT_CLIENT_SECRET/LINEAR_AGENT_WEBHOOK_SECRET are unset)',
      );
    }

    const row = await findOrCreateLinearAgentIntegration(orgId, actorId);
    const state = signLinearAgentInstallState({ integrationId: row.id, orgId });
    const url = buildLinearAgentAuthorizeUrl({
      clientId: config.clientId,
      redirectUri: config.redirectUri,
      state,
    });
    return ok(c, linearAgentInstallOut, { url });
  },
);

export default integrationsLinearAgent;
