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
import { zParam } from '../lib/validate';

/** One authorized MCP client returned by the list endpoint. */
const ConnectedAppOut = z.object({
  clientId: z.string(),
  name: z.string(),
  icon: z.string().nullable(),
  scopes: z.array(z.string()),
  consentedAt: z.string(),
});
type ConnectedAppOut = z.infer<typeof ConnectedAppOut>;

const ConnectedAppsListOut = z.object({ items: z.array(ConnectedAppOut) });
const RevokeOut = z.object({ revoked: z.literal(true) });

const clientIdParam = z.object({ clientId: z.string().min(1) });

/** Require an active session; throw 401 if none. */
function requireUserId(c: Context<AppEnv>): string {
  const session = c.get('session');
  if (!session?.user.id) throw new AuthError('Authentication required.');
  return session.user.id;
}

const connectedApps = new Hono<AppEnv>()
  .get('/', async (c) => {
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
  })
  .delete('/:clientId', zParam(clientIdParam), async (c) => {
    const userId = requireUserId(c);
    const { clientId } = c.req.valid('param');

    await db
      .delete(oauthAccessToken)
      .where(and(eq(oauthAccessToken.userId, userId), eq(oauthAccessToken.clientId, clientId)));

    await db
      .delete(oauthConsent)
      .where(and(eq(oauthConsent.userId, userId), eq(oauthConsent.clientId, clientId)));

    return ok(c, RevokeOut, { revoked: true as const });
  });

export default connectedApps;
