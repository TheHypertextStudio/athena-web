/**
 * `@docket/api` — active-sessions resource (mounted at `/v1/me/sessions`).
 *
 * @remarks
 * The **Settings → Security** device list: every session (signed-in device/browser) on the
 * caller's account, and the ability to revoke one — or every other one at once — from a
 * currently-signed-in session. Distinct from `/v1/me/identities` (linked external accounts) and
 * the passkey-management surface (credentials that can *mint* a session): a session is an
 * active login. Operates directly on Better Auth's `session` table (a revoke is exactly what
 * Better Auth's own `/revoke-session` endpoint does internally — delete the row by token; see
 * `better-auth/dist/api/routes/session.mjs`), scoped to the caller's `userId` so no request can
 * ever touch another user's session. The bearer token never crosses the API boundary — the
 * client only ever sees the opaque session `id`. Requires an active session; unauthenticated
 * callers get HTTP 401.
 */
import { db, session as sessionTable } from '@docket/db';
import { SessionListOut, SessionOut } from '@docket/types';
import { and, eq, ne } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv, AuthSession } from '../context';
import { AuthError, ConflictError, NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zParam } from '../lib/validate';

/** Require an active session; throw 401 if none. */
function requireSession(c: Context<AppEnv>): NonNullable<AuthSession> {
  const session = c.get('session');
  if (!session?.user.id) throw new AuthError('Authentication required.');
  return session;
}

type SessionRow = typeof sessionTable.$inferSelect;

function toOut(row: SessionRow, currentToken: string): z.input<typeof SessionOut> {
  return {
    id: row.id,
    current: row.token === currentToken,
    ipAddress: row.ipAddress ?? null,
    userAgent: row.userAgent ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const idParam = z.object({ id: z.string() });

const meSessions = new Hono<AppEnv>()
  .get(
    '/',
    apiDoc({
      tag: 'Me',
      summary: 'List active sessions',
      response: SessionListOut,
      description: `List every active session (signed-in device/browser) on the caller's account, most recently active first, for the Settings → Security device list. Each entry reports whether it's \`current\` (the session this very request is authenticated with), its \`ipAddress\`/\`userAgent\` when Better Auth recorded them, and when it was created/last refreshed. **The bearer token itself is never returned** — only the opaque \`id\`, which \`POST /me/sessions/:id/revoke\` resolves server-side. Session-only, no capability. **401** when unauthenticated. Related: \`/me/identities\` (linked external accounts, a different concept) and the passkey-management endpoints (credentials that mint a session, not a session itself).`,
    }),
    async (c) => {
      const { user, session } = requireSession(c);
      const rows = await db.select().from(sessionTable).where(eq(sessionTable.userId, user.id));
      const items = rows
        .map((row) => toOut(row, session.token))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return ok(c, SessionListOut, { items });
    },
  )
  .post(
    '/:id/revoke',
    apiDoc({
      tag: 'Me',
      summary: 'Revoke a session',
      response: SessionOut,
      description: `Revoke one of the caller's OTHER active sessions by its opaque \`id\` — e.g. "sign out that old laptop" from the device list. **Cannot revoke the session making this request**: that is what sign-out is for, and doing it here would sever the connection mid-request without a clean redirect. \`id\` must belong to the caller (never another user's session, regardless of guesses). Session-only, no capability. **404** if the id doesn't resolve to one of the caller's sessions; **409** \`current_session\` if it is the caller's own; **401** when unauthenticated.`,
    }),
    zParam(idParam),
    async (c) => {
      const { user, session } = requireSession(c);
      const { id } = c.req.valid('param');
      const [row] = await db
        .select()
        .from(sessionTable)
        .where(and(eq(sessionTable.id, id), eq(sessionTable.userId, user.id)))
        .limit(1);
      if (!row) throw new NotFoundError('Session not found.');
      if (row.token === session.token) {
        throw new ConflictError(
          'This is your current session — sign out instead of revoking it here.',
          'current_session',
        );
      }
      await db.delete(sessionTable).where(eq(sessionTable.id, row.id));
      return ok(c, SessionOut, toOut(row, session.token));
    },
  )
  .post(
    '/revoke-others',
    apiDoc({
      tag: 'Me',
      summary: 'Revoke every other session',
      response: SessionListOut,
      description: `Revoke every one of the caller's sessions EXCEPT the one making this request — "sign out everywhere else". Useful after noticing an unfamiliar device in the list, or as routine hygiene. Returns the caller's remaining sessions (just the current one) so the client can refresh its list from the response. Session-only, no capability. **401** when unauthenticated.`,
    }),
    async (c) => {
      const { user, session } = requireSession(c);
      await db
        .delete(sessionTable)
        .where(and(eq(sessionTable.userId, user.id), ne(sessionTable.token, session.token)));
      const remaining = await db
        .select()
        .from(sessionTable)
        .where(eq(sessionTable.userId, user.id));
      const items = remaining.map((row) => toOut(row, session.token));
      return ok(c, SessionListOut, { items });
    },
  );

export default meSessions;
