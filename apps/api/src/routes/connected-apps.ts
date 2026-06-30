/**
 * `@docket/api` — connected-apps router (mounted at `/v1/me/connected-apps`).
 *
 * @remarks
 * User-scoped surface for managing OAuth 2.1 clients the caller has authorized via the
 * MCP consent flow. Two endpoints:
 *
 * - `GET /` — list every `oauthConsent` the caller has granted, joined with
 *   `oauthApplication` for display name. Returns `{ items: ConnectedAppOut[] }`.
 * - `DELETE /:clientId` — revoke a single consent: deletes the `oauthConsent` row and
 *   every `oauthAccessToken` for (userId, clientId) so the client can no longer refresh.
 *
 * Both routes require an active session; an unauthenticated caller gets HTTP 401.
 */
import { db, oauthAccessToken, oauthApplication, oauthConsent } from '@docket/db';
import { and, eq } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { AuthError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zParam } from '../lib/validate';

/** One authorized MCP client returned by the list endpoint. */
const ConnectedAppOut = z.object({
  clientId: z
    .string()
    .describe(
      'The OAuth client id of the authorized app — the handle passed to DELETE to revoke it.',
    ),
  name: z.string().describe("The app's display name, from its registered `oauthApplication`."),
  icon: z.string().nullable().describe("The app's icon URL, or null when it registered none."),
  scopes: z
    .array(z.string())
    .describe(
      'The scope tokens the caller granted this app, split from the stored space-delimited consent string.',
    ),
  consentedAt: z.string().describe('ISO-8601 instant the caller granted (consented to) this app.'),
});
type ConnectedAppOut = z.infer<typeof ConnectedAppOut>;

const ConnectedAppsListOut = z.object({
  items: z
    .array(ConnectedAppOut)
    .describe(
      'The OAuth/MCP apps the caller has authorized. Empty when they have authorized none.',
    ),
});
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
      description: `List the third-party **OAuth 2.1 / MCP clients** the caller has authorized through the consent flow — the "connected apps" the user can review and revoke in account settings. Reads every \`oauthConsent\` row the caller granted (where \`consentGiven = true\`), joined to \`oauthApplication\` for the client's display \`name\` and \`icon\`. The stored space-delimited \`scopes\` string is split into an array of granted scope tokens, and \`consentedAt\` is when the grant was given.

User-scoped: rows are filtered to \`userId = session.user.id\`, so a caller only ever sees their own authorizations. Session-only, no capability; **401** when unauthenticated. Distinct from \`/me/identities\` (external accounts the *user* signed in with) — these are external apps that authorized *into* Docket on the user's behalf. Related: \`DELETE /me/connected-apps/:clientId\` to revoke.`,
    }),
    async (c) => {
      const userId = requireUserId(c);

      const rows = await db
        .select({
          clientId: oauthConsent.clientId,
          name: oauthApplication.name,
          icon: oauthApplication.icon,
          scopes: oauthConsent.scopes,
          consentedAt: oauthConsent.createdAt,
        })
        .from(oauthConsent)
        .innerJoin(oauthApplication, eq(oauthApplication.clientId, oauthConsent.clientId))
        .where(and(eq(oauthConsent.userId, userId), eq(oauthConsent.consentGiven, true)));

      const items: ConnectedAppOut[] = rows.map((row) => ({
        clientId: row.clientId,
        name: row.name,
        icon: row.icon,
        scopes: row.scopes
          .split(' ')
          .map((s) => s.trim())
          .filter(Boolean),
        consentedAt: row.consentedAt.toISOString(),
      }));

      return ok(c, ConnectedAppsListOut, { items });
    },
  )
  .delete(
    '/:clientId',
    apiDoc({
      tag: 'Me',
      summary: 'Revoke a connected app',
      response: RevokeOut,
      description: `Revoke the caller's authorization for a single OAuth/MCP client identified by \`:clientId\`. **Side effect — full revocation:** deletes every \`oauthAccessToken\` for \`(userId, clientId)\` so the client's live tokens stop working and it can no longer refresh, then deletes the \`oauthConsent\` row so the grant no longer appears in \`GET /me/connected-apps\`. After this the client must run the consent flow again to regain access.

Scoped to the caller (\`userId = session.user.id\`), so revoking only ever touches the caller's own grants. Idempotent — revoking a client the caller hasn't authorized (or has already revoked) deletes nothing and still returns \`{ revoked: true }\`. Session-only, no capability; **401** when unauthenticated.`,
    }),
    zParam(clientIdParam),
    async (c) => {
      const userId = requireUserId(c);
      const { clientId } = c.req.valid('param');

      await db
        .delete(oauthAccessToken)
        .where(and(eq(oauthAccessToken.userId, userId), eq(oauthAccessToken.clientId, clientId)));

      await db
        .delete(oauthConsent)
        .where(and(eq(oauthConsent.userId, userId), eq(oauthConsent.clientId, clientId)));

      return ok(c, RevokeOut, { revoked: true as const });
    },
  );

export default connectedApps;
