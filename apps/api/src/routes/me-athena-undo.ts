/**
 * `@docket/api` — Undo one change Athena made, mounted at `/v1/me/athena/changes`.
 *
 * @remarks
 * Split out of `me-athena.ts` (already at its complexity-debt line ceiling): a change set carries
 * no owner column of its own — {@link recordChangeSet} in `../mcp/change-set` stamps the acting
 * session onto `origin.sessionId` (see `openToolbox`) — so ownership here is answered by tracing
 * back to that session, the same way every other personal Athena route does.
 *
 * A plan commit is the second way in. Confirming on the planning canvas is the person's own button
 * press, with no agent session behind it, so `commitPlanNodes` also stamps `origin.planId`; a
 * change set is undoable when it traces back to a caller-owned session OR to a caller-owned plan.
 * Both claims are re-checked against the row they name rather than trusted off the origin. A
 * change set that traces back to neither is reported as not found rather than distinguished from a
 * change set that never existed.
 */
import { agentSession, changeSet, db, planDraft } from '@docket/db';
import { PhoneCallUndoOut as AthenaUndoOut } from '@docket/athena/voice';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { AuthError, NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { reopenUndoneNodes } from '../lib/plan-draft/reopen';
import { zParam } from '../lib/validate';
import { undoChangeSet, undoChangeSetAtomically } from '../mcp/change-set';

/** Route param for a change-set undo, addressed by the change set alone. */
const undoParam = z.object({ changeSetId: z.string() });

/** Return the request-authenticated owner id; bodies never participate in ownership. */
function requestOwner(c: Context<AppEnv>): string {
  const userId = c.get('session')?.user.id;
  if (!userId) throw new AuthError();
  return userId;
}

/** Whether the change set's originating Athena session belongs to the caller. */
async function ownsOriginSession(
  ownerUserId: string,
  sessionId: string | undefined,
): Promise<boolean> {
  if (!sessionId) return false;
  const rows = await db
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
  return rows[0] !== undefined;
}

/** Whether the plan draft the change set confirmed belongs to the caller. */
async function ownsOriginPlan(ownerUserId: string, planId: string | undefined): Promise<boolean> {
  if (!planId) return false;
  const rows = await db
    .select({ id: planDraft.id })
    .from(planDraft)
    .where(and(eq(planDraft.id, planId), eq(planDraft.ownerUserId, ownerUserId)))
    .limit(1);
  return rows[0] !== undefined;
}

/** An authorized change set: where it ran, and whether it confirmed a plan. */
interface OwnedChangeSet {
  readonly organizationId: string;
  /**
   * The caller-owned plan the change set confirmed, or null for a session's change. A plan commit
   * is reversed differently and reopens its nodes on the plan afterwards.
   */
  readonly planId: string | null;
}

/** Resolve the organization a change set ran in, only for an origin the caller owns. */
async function loadOwnedChangeSet(
  ownerUserId: string,
  changeSetId: string,
): Promise<OwnedChangeSet> {
  const rows = await db
    .select({ organizationId: changeSet.organizationId, origin: changeSet.origin })
    .from(changeSet)
    .where(eq(changeSet.id, changeSetId))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('Change set not found');
  const fromPlan = await ownsOriginPlan(ownerUserId, row.origin.planId);
  const owned = fromPlan || (await ownsOriginSession(ownerUserId, row.origin.sessionId));
  if (!owned) throw new NotFoundError('Change set not found');
  return {
    organizationId: row.organizationId,
    planId: fromPlan ? (row.origin.planId ?? null) : null,
  };
}

/** Personal Athena undo route. */
const meAthenaChanges = new Hono<AppEnv>().post(
  '/:changeSetId/undo',
  apiDoc({
    tag: 'Athena',
    summary: 'Undo one Athena change',
    response: AthenaUndoOut,
    description:
      'Reverse one change made in a caller-owned Athena session or confirmed from a caller-owned planning draft, only when nothing later touched the same rows. This is what backs the Undo on the line a plan commit writes: pass the `changeSetId` that `POST /v1/me/plans/{id}/commit` returned. Undoing a plan commit also returns the nodes it created to `draft` on that plan, so `GET /v1/me/plans/{id}` shows them ready to confirm again. A change set that traces back to another user, or to neither a session nor a plan, or that was already undone, is reported as not found.',
  }),
  zParam(undoParam),
  async (c) => {
    const owner = requestOwner(c);
    const { changeSetId } = c.req.valid('param');
    const { organizationId, planId } = await loadOwnedChangeSet(owner, changeSetId);
    // A plan commit creates initiatives and projects as well as tasks, and the atomic reversal
    // understands only tasks and the edges between them — it refuses a container outright. The
    // reporting reversal is the one Athena's own `undo` tool already runs for `organize`, which
    // produces the same mixed shape, so a plan commit unwinds through the same path.
    if (planId === null) {
      await undoChangeSetAtomically(organizationId, changeSetId);
    } else {
      const { outcomes } = await undoChangeSet(organizationId, changeSetId);
      await reopenUndoneNodes(planId, outcomes);
    }
    return ok(c, AthenaUndoOut, { changeSetId, undone: true });
  },
);

export default meAthenaChanges;
