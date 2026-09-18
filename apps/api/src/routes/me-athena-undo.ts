/**
 * `@docket/api` — Undo one change Athena made, mounted at `/v1/me/athena/changes`.
 *
 * @remarks
 * Split out of `me-athena.ts` (already at its complexity-debt line ceiling): a change set carries
 * no owner column of its own — {@link recordChangeSet} in `../mcp/change-set` stamps the acting
 * session onto `origin.sessionId` (see `openToolbox`) — so ownership here is answered by tracing
 * back to that session, the same way every other personal Athena route does. A change set with no
 * recorded session, or one whose session belongs to someone else, is reported as not found rather
 * than distinguished from a change set that never existed.
 */
import { agentSession, changeSet, db } from '@docket/db';
import { PhoneCallUndoOut as AthenaUndoOut } from '@docket/athena/voice';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { AuthError, NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zParam } from '../lib/validate';
import { undoChangeSetAtomically } from '../mcp/change-set';

/** Route param for a change-set undo, addressed by the change set alone. */
const undoParam = z.object({ changeSetId: z.string() });

/** Return the request-authenticated owner id; bodies never participate in ownership. */
function requestOwner(c: Context<AppEnv>): string {
  const userId = c.get('session')?.user.id;
  if (!userId) throw new AuthError();
  return userId;
}

/** Resolve the organization a change set ran in, only for a session the caller owns. */
async function loadOwnedChangeSet(
  ownerUserId: string,
  changeSetId: string,
): Promise<{ organizationId: string }> {
  const rows = await db
    .select({ organizationId: changeSet.organizationId, origin: changeSet.origin })
    .from(changeSet)
    .where(eq(changeSet.id, changeSetId))
    .limit(1);
  const row = rows[0];
  const sessionId = row?.origin.sessionId;
  if (!row || !sessionId) throw new NotFoundError('Change set not found');
  const owned = await db
    .select({ id: agentSession.id })
    .from(agentSession)
    .where(
      and(
        eq(agentSession.id, sessionId),
        eq(agentSession.executorKind, 'athena'),
        eq(agentSession.ownerUserId, ownerUserId),
      ),
    )
    .limit(1);
  if (!owned[0]) throw new NotFoundError('Change set not found');
  return { organizationId: row.organizationId };
}

/** Personal Athena undo route. */
const meAthenaChanges = new Hono<AppEnv>().post(
  '/:changeSetId/undo',
  apiDoc({
    tag: 'Athena',
    summary: 'Undo one Athena change',
    response: AthenaUndoOut,
    description:
      'Reverse one change Athena made in a caller-owned session, only when nothing later touched the same rows. A change set that belongs to another user’s session, or that carries no session at all, is reported as not found.',
  }),
  zParam(undoParam),
  async (c) => {
    const owner = requestOwner(c);
    const { changeSetId } = c.req.valid('param');
    const { organizationId } = await loadOwnedChangeSet(owner, changeSetId);
    await undoChangeSetAtomically(organizationId, changeSetId);
    return ok(c, AthenaUndoOut, { changeSetId, undone: true });
  },
);

export default meAthenaChanges;
