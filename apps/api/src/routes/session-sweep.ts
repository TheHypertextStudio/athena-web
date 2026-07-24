/**
 * `@docket/api` — the expired-session cleanup sweep.
 *
 * @remarks
 * Better Auth only ever deletes a `session` row lazily — when that EXACT expired cookie is
 * presented again (`better-auth/dist/api/routes/session.mjs`) — so a browser profile that's
 * simply abandoned (a stale bookmark, a device that's no longer used) leaves its row behind
 * forever. `GET /v1/me/sessions` already filters these out of what it shows (`me-sessions.ts`),
 * but without this sweep they'd still sit in the table indefinitely. A plain, stateless delete: an
 * already-expired row has no live state to race or double-process, so no lease/claim guard is
 * needed the way the other sweeps in this directory use for in-flight work.
 */
import { db, session as sessionTable } from '@docket/db';
import { lt } from 'drizzle-orm';

/** The outcome of one sweep tick. */
export interface SessionSweepResult {
  /** Expired session rows deleted this tick. */
  readonly deleted: number;
}

/** Delete every session row past its `expiresAt`. */
export async function sweepExpiredSessions(now: Date): Promise<SessionSweepResult> {
  const deleted = await db
    .delete(sessionTable)
    .where(lt(sessionTable.expiresAt, now))
    .returning({ id: sessionTable.id });
  return { deleted: deleted.length };
}
