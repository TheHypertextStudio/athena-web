/**
 * `@docket/api` — OAuth client display-metadata router (mounted at `/v1/oauth/clients`).
 *
 * @remarks
 * The consent page (`/oauth/authorize`) needs a client's display name/icon to show "X wants
 * access to your account", but a `client_id` can itself be an attacker-supplied HTTPS URL
 * (CIMD). Rather than the browser fetching that URL directly and rendering whatever it returns,
 * the client fetches this endpoint, which returns the **already server-validated** row Better
 * Auth's OAuth client table holds — for CIMD clients, the `client_name`/`logo_uri` this
 * server itself fetched, DNS-checked, and validated during the authorize preflight (see
 * `apps/api/src/mcp/cimd.ts`). The consent page never renders attacker-controlled content.
 * Session-only (any authenticated user reaching consent may look up the client they're
 * consenting to); no capability.
 */
import { db, oauthClient } from '@docket/db';
import { OAuthClientMetadataOut } from '@docket/identity-access/oauth-client-contract';
import { eq } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { AuthError, NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zParam } from '../lib/validate';

/** Require an active session; throw 401 if none. */
function requireUserId(c: Context<AppEnv>): string {
  const session = c.get('session');
  if (!session?.user.id) throw new AuthError('Authentication required.');
  return session.user.id;
}

/**
 * A display name for a client with no `name` on file: its own host for a CIMD (URL-form)
 * `client_id`, else the raw id. `oauthClient.name` is nullable — the plugin's dynamic client
 * registration doesn't require `client_name` — so a standard DCR'd client can legitimately
 * have none.
 */
export function fallbackClientName(clientId: string): string {
  try {
    return new URL(clientId).hostname;
  } catch {
    return clientId;
  }
}

const clientIdParam = z.object({ clientId: z.string() });

const oauthClients = new Hono<AppEnv>().get(
  '/:clientId/metadata',
  apiDoc({
    tag: 'OAuth',
    summary: 'Get an OAuth client’s display metadata',
    response: OAuthClientMetadataOut,
    description: `Return the validated display \`name\` and \`icon\` for an OAuth client. Docket fetches and validates CIMD metadata before this operation can return it; the browser never fetches the client-provided URL. Percent-encode URL-form \`clientId\` values in the path. Returns **404** when Docket has not registered or authorized the client.`,
  }),
  zParam(clientIdParam),
  async (c) => {
    requireUserId(c);
    const { clientId } = c.req.valid('param');
    const [row] = await db
      .select({ name: oauthClient.name, icon: oauthClient.icon })
      .from(oauthClient)
      .where(eq(oauthClient.clientId, clientId))
      .limit(1);
    if (!row) throw new NotFoundError('OAuth client not found.');
    return ok(c, OAuthClientMetadataOut, {
      name: row.name ?? fallbackClientName(clientId),
      icon: row.icon,
    });
  },
);

export default oauthClients;
