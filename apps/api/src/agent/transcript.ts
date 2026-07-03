/**
 * `@docket/api` — the durable session transcript (load/append).
 *
 * @remarks
 * One `agent_session_transcript` row per session holds the exact `TurnMessage[]`
 * conversation the provider resumes from. It is rewritten inside the SAME transaction
 * as the turn's activity rows (see the loop), so the visible stream and the resumable
 * conversation can never disagree. Re-entry after an approval that takes days — or a
 * server restart — rebuilds the provider conversation purely from this row.
 */
import { agentSessionTranscript } from '@docket/db';
import type { db } from '@docket/db';
import type { TurnMessage } from '@docket/types';
import { eq, sql } from 'drizzle-orm';

/** The transaction (or root db) handle the helpers run on. */
export type DbHandle = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Load a session's transcript messages (empty when the session has none yet).
 *
 * @param handle - The db/transaction handle to read on.
 * @param sessionId - The owning session.
 */
export async function loadTranscript(handle: DbHandle, sessionId: string): Promise<TurnMessage[]> {
  const rows = await handle
    .select({ messages: agentSessionTranscript.messages })
    .from(agentSessionTranscript)
    .where(eq(agentSessionTranscript.sessionId, sessionId))
    .limit(1);
  return rows[0]?.messages ?? [];
}

/**
 * Persist a session's full transcript (insert-or-replace, one row per session).
 *
 * @param handle - The db/transaction handle to write on (pass the turn's transaction).
 * @param sessionId - The owning session.
 * @param organizationId - The owning org (tenant isolation).
 * @param messages - The complete conversation to persist.
 */
export async function saveTranscript(
  handle: DbHandle,
  sessionId: string,
  organizationId: string,
  messages: readonly TurnMessage[],
): Promise<void> {
  await handle
    .insert(agentSessionTranscript)
    .values({ sessionId, organizationId, messages: [...messages] })
    .onConflictDoUpdate({
      target: agentSessionTranscript.sessionId,
      set: { messages: [...messages], updatedAt: sql`now()` },
    });
}
