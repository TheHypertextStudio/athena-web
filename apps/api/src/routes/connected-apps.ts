/**
 * `@docket/api` — connected-apps router (mounted at `/v1/me/connected-apps`).
 *
 * @remarks
 * User-scoped surface for managing OAuth 2.1 clients the caller has authorized for REST or MCP.
 * Two endpoints:
 *
 * - `GET /` — list every `oauthConsent` the caller has granted, joined with
 *   `oauthClient` for display name. Returns `{ items: ConnectedAppOut[] }`.
 * - `DELETE /:clientId` — revoke the complete relationship in one client-locked transaction,
 *   including consent, resource grants, refresh credentials, and stored access credentials.
 *
 * Both routes require an active session; an unauthenticated caller gets HTTP 401.
 *
 * **Revocation is immediate.** The shared REST and MCP bearer verifier checks the live client,
 * user, consent, resource grant, granted scopes, and revocation state on every request. A held JWT
 * therefore fails on its next use even though its signature and expiry remain valid.
 */
import { revokeConnectedOAuthClient } from '@docket/auth';
import { db, oauthClient, oauthConsent } from '@docket/db';
import { and, asc, eq } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { CursorQuery, pageOf } from '../contracts/pagination';
import { AuthError } from '../error';
import { pageResultByKey, seekAfterId } from '../lib/list-cursor';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zParam, zQuery } from '../lib/validate';
import { fallbackClientName } from './oauth-clients';

/** One authorized OAuth client returned by the list endpoint. */
const ConnectedAppOut = z.object({
  clientId: z
    .string()
    .describe(
      'The OAuth client id of the authorized app — the handle passed to DELETE to revoke it.',
    ),
  name: z.string().describe("The app's display name, from its registered `oauthClient`."),
  icon: z.string().nullable().describe("The app's icon URL, or null when it registered none."),
  scopes: z.array(z.string()).describe('The scope tokens the caller granted this app.'),
  consentedAt: z.string().describe('ISO-8601 instant the caller granted (consented to) this app.'),
});
type ConnectedAppOut = z.infer<typeof ConnectedAppOut>;

const ConnectedAppsListOut = pageOf(ConnectedAppOut);
const RevokeOut = z.object({
  revoked: z
    .literal(true)
    .describe(
      'Always `true` — confirms the revocation completed (idempotent even if nothing was deleted).',
    ),
});

const clientIdParam = z.object({ clientId: z.string().min(1) });

/** Require an active session; throw 401 if none. */
function requireUserId(c: Context<AppEnv>): string {
  const session = c.get('session');
  if (!session?.user.id) throw new AuthError('Authentication required.');
  return session.user.id;
}

const connectedApps = new Hono<AppEnv>()
  .get(
    '/',
    apiDoc({
      tag: 'Me',
      summary: 'List connected apps',
      response: ConnectedAppsListOut,
      description: `List the third-party **OAuth 2.1 clients** the caller has authorized for the REST API or MCP — the "connected apps" the user can review and revoke in account settings. Each item identifies the registered client, the standing scopes the user approved, and when that approval was recorded. A client can hold separate resource-bound credentials for REST and MCP under this one approval.

The response contains only the caller's authorizations. Session-only, no capability; **401** when unauthenticated. \`/me/identities\` lists accounts the user connected to Docket, while this operation lists external apps that received access to Docket. Use \`DELETE /me/connected-apps/:clientId\` to revoke one.`,
    }),
    zQuery(CursorQuery),
    async (c) => {
      const userId = requireUserId(c);
      const { cursor, limit } = c.req.valid('query');

      const rows = await db
        .select({
          clientId: oauthConsent.clientId,
          name: oauthClient.name,
          icon: oauthClient.icon,
          scopes: oauthConsent.scopes,
          consentedAt: oauthConsent.createdAt,
        })
        .from(oauthConsent)
        .innerJoin(oauthClient, eq(oauthClient.clientId, oauthConsent.clientId))
        .where(
          and(eq(oauthConsent.userId, userId), seekAfterId(oauthConsent.clientId, cursor, 'asc')),
        )
        .orderBy(asc(oauthConsent.clientId))
        .limit(limit + 1);

      const items: ConnectedAppOut[] = rows.map((row) => ({
        clientId: row.clientId,
        name: row.name ?? fallbackClientName(row.clientId),
        icon: row.icon,
        scopes: row.scopes,
        consentedAt: (row.consentedAt ?? new Date(0)).toISOString(),
      }));

      return ok(
        c,
        ConnectedAppsListOut,
        pageResultByKey(items, limit, (item) => item.clientId),
      );
    },
  )
  .delete(
    '/:clientId',
    apiDoc({
      tag: 'Me',
      summary: 'Revoke a connected app',
      response: RevokeOut,
      description: `Revoke the caller's REST and MCP authorization for \`:clientId\`. The app disappears from \`GET /me/connected-apps\`, refresh tokens stop working, and existing access tokens receive 401 on their next request even when their signed expiry is later. The client must complete authorization again to regain access.

This operation affects only the signed-in user's grants. Repeating it for an unknown or already revoked client still returns \`{ "revoked": true }\`.`,
    }),
    zParam(clientIdParam),
    async (c) => {
      const userId = requireUserId(c);
      const { clientId } = c.req.valid('param');

      await revokeConnectedOAuthClient(userId, clientId);

      return ok(c, RevokeOut, { revoked: true as const });
    },
  );

export default connectedApps;
