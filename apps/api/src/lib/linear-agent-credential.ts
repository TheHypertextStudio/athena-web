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
import type { LinearAgentPort } from '@docket/integrations';

import { buildLinearAgentClient } from '../container';
import { unsealCredential } from './credentials';

/** The unsealed credential shape a `linear_agent` integration's ciphertext decodes to. */
const linearAgentTokensSchema = z.object({ accessToken: z.string() }).loose();

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
  return buildLinearAgentClient(parsedTokens.data.accessToken);
}
