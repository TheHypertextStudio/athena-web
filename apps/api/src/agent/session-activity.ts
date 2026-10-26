/** Session activity writers preserve explicit participant and executor roles. */
import { sessionActivity, type SessionActivityBody } from '@docket/db';
import type { DbHandle } from './transcript';

/**
 * Persist an executor message inside its existing transaction and return its durable id.
 * @returns The saved activity id, with an explicit executor role on responses.
 * @throws If the database insert fails or returns no saved activity.
 */
export async function insertExecutorActivity(
  handle: DbHandle,
  organizationId: string | null,
  sessionId: string,
  type: 'thought' | 'response' | 'elicitation' | 'error' | 'action',
  body: SessionActivityBody,
): Promise<string> {
  const [row] = await handle
    .insert(sessionActivity)
    .values({
      sessionId,
      organizationId,
      type,
      body: type === 'response' ? { ...body, author: body.author ?? 'athena' } : body,
    })
    .returning({ id: sessionActivity.id });
  if (!row) throw new Error('activity insert returned no row');
  return row.id;
}

/** Preserve the participant role and durable question linkage on an elicitation response. */
export function participantReplyBody(
  text: string,
  elicitationActivityId: string,
  toolUseId?: string,
): SessionActivityBody {
  return { text, author: 'user', elicitationActivityId, ...(toolUseId ? { toolUseId } : {}) };
}
