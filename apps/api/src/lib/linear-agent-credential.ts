/**
 * `@docket/api` — shared Linear **Agent** credential resolution.
 *
 * @remarks
 * Two callers need to turn an org's `linear_agent` integration into an authenticated
 * {@link LinearAgentPort}: the webhook receiver (`routes/ingest-linear-agent.ts`, which already
 * has the integration row in hand from its workspace-id routing) and the outbound relay
 * (`lib/linear-agent-relay.ts`, which only has an org id). Kept in exactly one place so the
 * OAuth callback that seals the credential (`routes/integrations-linear-agent-oauth.ts`,
 * `sealCredential(JSON.stringify(tokens))`) and every reader agree on the envelope shape — a
 * webhook-side and relay-side copy of this unseal/parse logic that drifted would be a silent
 * outage the type system can't catch.
 */
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db, integration, integrationCredential } from '@docket/db';
import {
  linearAgentTokenNeedsRefresh,
  refreshLinearAgentToken,
  type LinearAgentPort,
  type StoredLinearAgentTokens,
} from '@docket/integrations';

import { buildLinearAgentClient } from '../container';
import { sealCredential, unsealCredential } from './credentials';
import { linearAgentConfigFromEnv } from './linear-agent-connect';

/**
 * The unsealed credential shape a `linear_agent` integration's ciphertext decodes to.
 *
 * @remarks
 * Only `accessToken` is required — a credential sealed before {@link StoredLinearAgentTokens} was
 * introduced won't have the rest, and must still degrade to "use the token as-is, skip the refresh
 * check" rather than fail to parse.
 */
const linearAgentTokensSchema = z
  .object({
    accessToken: z.string(),
    tokenType: z.string().optional(),
    scope: z.string().optional(),
    refreshToken: z.string().optional(),
    expiresIn: z.number().optional(),
    obtainedAt: z.string().optional(),
  })
  .loose();

/**
 * Find an org's `linear_agent` integration row, if one exists.
 *
 * @remarks
 * Unlike the webhook receiver's routing (which finds the integration BY workspace id, because
 * the org itself isn't known yet), a caller that already knows `orgId` — the outbound relay —
 * just needs this org-scoped lookup. No `status` filter, mirroring the webhook receiver: a
 * `connecting`/`error` integration still degrades gracefully at the credential step below rather
 * than being treated as absent here.
 */
export async function findLinearAgentIntegration(
  orgId: string,
): Promise<typeof integration.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(integration)
    .where(and(eq(integration.organizationId, orgId), eq(integration.provider, 'linear_agent')))
    .limit(1);
  return row ?? null;
}

/**
 * Build an authenticated {@link LinearAgentPort} for one `linear_agent` integration.
 *
 * @remarks
 * Degrades to `null` (never throws) on a missing or unparseable credential — the same
 * "unrouted, ACK and move on" degrade the webhook receiver applies — since a caller here (the
 * outbound relay, running from a cron sweep) must never turn a revoked/incomplete install into a
 * hard sweep failure. A malformed ciphertext envelope (tamper/corruption, not "missing") still
 * throws out of {@link unsealCredential} — that is a genuine fault worth surfacing, not silently
 * swallowed.
 *
 * Refreshes the access token before use when it's due (mirrors the remote-MCP toolbox's
 * refresh-before-use in `agent/toolbox.ts`) — Linear's Agent access tokens expire in 24h, so
 * without this every install would silently start failing a day after connecting. A refresh
 * failure (revoked grant, app reconfigured) degrades the integration to `status: 'error'` with a
 * clear reason, same as a first-connect failure, and this still returns `null` rather than
 * throwing into the caller's sweep/webhook path.
 *
 * @param integrationId - The `linear_agent` integration's id.
 */
export async function buildLinearAgentPortForIntegration(
  integrationId: string,
): Promise<LinearAgentPort | null> {
  const [credentialRow] = await db
    .select({ ciphertext: integrationCredential.ciphertext })
    .from(integrationCredential)
    .where(eq(integrationCredential.integrationId, integrationId))
    .limit(1);
  if (!credentialRow) return null;

  const parsedTokens = linearAgentTokensSchema.safeParse(
    JSON.parse(unsealCredential(credentialRow.ciphertext)),
  );
  if (!parsedTokens.success) return null;

  const { accessToken, tokenType, scope, refreshToken, expiresIn, obtainedAt } = parsedTokens.data;
  if (refreshToken && tokenType && scope && expiresIn !== undefined && obtainedAt) {
    const stored: StoredLinearAgentTokens = {
      accessToken,
      tokenType,
      scope,
      refreshToken,
      expiresIn,
      obtainedAt,
    };
    if (linearAgentTokenNeedsRefresh(stored)) {
      const config = linearAgentConfigFromEnv();
      if (!config) return null;
      try {
        const refreshed = await refreshLinearAgentToken({
          clientId: config.clientId,
          clientSecret: config.clientSecret,
          refreshToken: stored.refreshToken,
        });
        const next: StoredLinearAgentTokens = {
          ...refreshed,
          obtainedAt: new Date().toISOString(),
        };
        await db
          .update(integrationCredential)
          .set({ ciphertext: sealCredential(JSON.stringify(next)) })
          .where(eq(integrationCredential.integrationId, integrationId));
        return buildLinearAgentClient(next.accessToken);
      } catch (cause) {
        await db
          .update(integration)
          .set({
            status: 'error',
            lastError:
              cause instanceof Error
                ? cause.message
                : 'Linear Agent token refresh failed; reconnect required',
            lastErrorAt: new Date(),
          })
          .where(eq(integration.id, integrationId));
        return null;
      }
    }
  }
  return buildLinearAgentClient(accessToken);
}
