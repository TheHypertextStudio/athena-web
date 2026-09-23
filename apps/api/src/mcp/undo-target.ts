/**
 * `@docket/api` — which change set a bare `undo` reverses.
 *
 * @remarks
 * Every write records a change set, whichever door it came through, so "the caller's latest
 * change" must mean the latest change made through the same door. An MCP client asking to undo
 * reaches for its own last call, never the person's last edit in the app or another client's
 * work under the same account. Rows recorded before provenance carry no channel and stay eligible,
 * which is how they behaved before.
 */
import { changeSet, db } from '@docket/db';
import { and, desc, eq, isNull, or, sql, type SQL } from 'drizzle-orm';

import { currentProvenance } from '../lib/provenance/context';

/** Match change sets recorded through the caller's own channel, client, and session. */
function sameDoor(): SQL | undefined {
  const base = currentProvenance();
  if (!base) return undefined;
  const channel = sql`${changeSet.origin}->>'channel'`;
  const conditions: SQL[] = [eq(channel, base.channel)];
  if (base.client) conditions.push(eq(sql`${changeSet.origin}->>'client'`, base.client));
  if (base.sessionId) conditions.push(eq(sql`${changeSet.origin}->>'sessionId'`, base.sessionId));
  return or(and(...conditions), isNull(channel));
}

/**
 * The caller's latest change set that is still undoable, made through the same door.
 *
 * @param orgId - The organization the undo runs in.
 * @param actorId - The caller's actor in that organization.
 * @returns the change set id, or undefined when there is nothing to undo.
 */
export async function latestOwnChangeSet(
  orgId: string,
  actorId: string,
): Promise<string | undefined> {
  const [row] = await db
    .select({ id: changeSet.id })
    .from(changeSet)
    .where(
      and(
        eq(changeSet.organizationId, orgId),
        eq(changeSet.actorId, actorId),
        isNull(changeSet.undoneAt),
        sameDoor(),
      ),
    )
    .orderBy(desc(changeSet.createdAt))
    .limit(1);
  return row?.id;
}
