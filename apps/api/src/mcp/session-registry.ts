/**
 * `@docket/api` — MCP session records (mcp-notifications.md §3, §4.1).
 *
 * @remarks
 * A session exists for one reason: to give a client a durable handle the notification channel can
 * be addressed by. The request path stays stateless — a session id does not make a POST resume
 * anything — so this module is deliberately small: mint, validate, touch, end, reap.
 *
 * The security-critical part is {@link resolveSession}. The stateless design's safety property is
 * that every request builds a fresh server bound to a freshly resolved identity, so authorization
 * can never cross principals. A session id travelling in a header does not carry that guarantee,
 * so a presented id must be proven to belong to the caller who presents it — and a mismatch is
 * reported as a miss, never as a denial, so a guessed id cannot confirm that a session exists.
 */
import { db, mcpSession, mcpSubscription } from '@docket/db';
import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm';

import { NotFoundError } from '../error';
import type { McpContext } from './auth';
import { principalKey } from './principal';

/** How long a session survives without being seen before the sweep reaps it. */
const IDLE_TTL_MS = 24 * 60 * 60 * 1000;

/** The header carrying the session id, per the Streamable HTTP transport. */
export const SESSION_HEADER = 'mcp-session-id';

/**
 * Mint a session for a caller completing `initialize`.
 *
 * @param ctx - The authenticated caller.
 * @param protocolVersion - The protocol version the client negotiated, when it sent one.
 * @returns the new session id.
 */
export async function createSession(
  ctx: McpContext,
  protocolVersion: string | null,
): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(mcpSession).values({
    id,
    principalKey: principalKey(ctx),
    ...(protocolVersion ? { protocolVersion } : {}),
  });
  return id;
}

/**
 * Resolve a presented session id, proving it belongs to this caller.
 *
 * @remarks
 * Matching on `principalKey` is what stops a leaked or guessed `Mcp-Session-Id` from attaching one
 * principal's client to another's notification stream. The failure is a {@link NotFoundError}
 * rather than a permission error for the usual existence-hiding reason.
 *
 * @param ctx - The authenticated caller.
 * @param sessionId - The id presented in the request header.
 * @returns the session id, confirmed live and owned by this caller.
 * @throws {NotFoundError} When no live session with that id belongs to this caller.
 */
export async function resolveSession(ctx: McpContext, sessionId: string): Promise<string> {
  const rows = await db
    .select({ id: mcpSession.id })
    .from(mcpSession)
    .where(
      and(
        eq(mcpSession.id, sessionId),
        eq(mcpSession.principalKey, principalKey(ctx)),
        isNull(mcpSession.endedAt),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('Session not found');
  return row.id;
}

/** Stamp `lastSeenAt` so an active session is not reaped. Best-effort. */
export async function touchSession(sessionId: string): Promise<void> {
  await db.update(mcpSession).set({ lastSeenAt: new Date() }).where(eq(mcpSession.id, sessionId));
}

/**
 * Retire sessions: drop their subscriptions and stamp `endedAt`.
 *
 * @remarks
 * Shared by the explicit `DELETE` and the idle reaper so "ended" means the same thing however a
 * session got there — a subscription outliving its session would be a silent leak on the write
 * path's lookup.
 *
 * @param sessionIds - The sessions to retire.
 * @param at - The instant to stamp.
 */
async function retire(sessionIds: readonly string[], at: Date): Promise<void> {
  if (sessionIds.length === 0) return;
  const ids = [...sessionIds];
  await db.delete(mcpSubscription).where(inArray(mcpSubscription.sessionId, ids));
  await db.update(mcpSession).set({ endedAt: at }).where(inArray(mcpSession.id, ids));
}

/**
 * End a session and drop its subscriptions.
 *
 * @param ctx - The authenticated caller, proven to own the session.
 * @param sessionId - The session to end.
 * @throws {NotFoundError} When the session is not this caller's.
 */
export async function endSession(ctx: McpContext, sessionId: string): Promise<void> {
  await resolveSession(ctx, sessionId);
  await retire([sessionId], new Date());
}

/** Persist the minimum severity a session wants `notifications/message` frames for. */
export async function setSessionLogLevel(sessionId: string, level: string): Promise<void> {
  await db
    .update(mcpSession)
    .set({ logLevel: sql`${level}::log_level` })
    .where(eq(mcpSession.id, sessionId));
}

/**
 * Reap sessions idle past the TTL.
 *
 * @remarks
 * Request- and cron-driven rather than timer-driven: Cloud Run throttles CPU to near-zero between
 * requests, so a `setInterval` reaper would fire unpredictably or not at all.
 *
 * @param now - The current instant, injectable for tests.
 * @returns how many sessions were reaped.
 */
export async function reapIdleSessions(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - IDLE_TTL_MS);
  const stale = await db
    .select({ id: mcpSession.id })
    .from(mcpSession)
    .where(and(lt(mcpSession.lastSeenAt, cutoff), isNull(mcpSession.endedAt)));
  await retire(
    stale.map((row) => row.id),
    now,
  );
  return stale.length;
}
