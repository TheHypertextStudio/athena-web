/**
 * `@docket/api` — the ghost projection: pending proposals as reviewable data.
 *
 * @remarks
 * The UI contract behind the ghost system: still-`proposed` actions are grouped by
 * `proposalGroupId` (one batch per assistant turn) and each member's stored
 * `toolCall` is projected into a surface-shaped ghost — a `create_task` becomes a
 * translucent, editable task row in the workspace views; anything without a spatial
 * home falls back to the session proposal card (`ghost: null`). Editing a ghost
 * PATCHes the stored `toolCall.input` (only while `proposed`); approval executes
 * exactly what is stored.
 */
import { db, sessionActivity } from '@docket/db';
import type { GhostTaskOut, ProposalGroupOut, ProposalItemOut } from '@docket/types';
import { and, asc, eq, isNotNull } from 'drizzle-orm';
import type { z } from 'zod';

import { ConflictError, NotFoundError } from '../error';
import type { ActivityRow } from '../routes/agent-session-helpers';

/** Project one stored tool call into its workspace ghost, when it has one. */
function projectGhost(
  tool: string,
  input: Record<string, unknown>,
): z.input<typeof GhostTaskOut> | null {
  if (tool !== 'create_task') return null;
  const title = typeof input['title'] === 'string' ? input['title'] : '';
  if (!title) return null;
  return {
    title,
    teamId: typeof input['teamId'] === 'string' ? input['teamId'] : null,
    projectId: typeof input['projectId'] === 'string' ? input['projectId'] : null,
    dueDate: typeof input['dueDate'] === 'string' ? input['dueDate'] : null,
  };
}

/** Project one proposed action row into its {@link ProposalItemOut}. */
function toProposalItem(row: ActivityRow): z.input<typeof ProposalItemOut> | null {
  const action = row.body.action;
  const call = action?.toolCall;
  if (!action || !call || !row.proposalGroupId) return null;
  const input =
    call.input && typeof call.input === 'object' && !Array.isArray(call.input)
      ? (call.input as Record<string, unknown>)
      : {};
  return {
    activityId: row.id,
    sessionId: row.sessionId,
    proposalGroupId: row.proposalGroupId,
    tool: call.tool,
    summary: action.summary,
    input,
    mode: action.mode ?? 'proposal',
    ghost: projectGhost(call.tool, input),
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * List a session's pending proposal groups, oldest-first, ghost-projected.
 *
 * @param sessionId - The owning session.
 */
export async function listProposalGroups(
  sessionId: string,
): Promise<z.input<typeof ProposalGroupOut>[]> {
  const rows = await db
    .select()
    .from(sessionActivity)
    .where(
      and(
        eq(sessionActivity.sessionId, sessionId),
        eq(sessionActivity.type, 'action'),
        eq(sessionActivity.approvalStatus, 'proposed'),
        isNotNull(sessionActivity.proposalGroupId),
      ),
    )
    .orderBy(asc(sessionActivity.createdAt));

  const groups = new Map<string, z.input<typeof ProposalGroupOut>>();
  for (const row of rows) {
    const item = toProposalItem(row);
    if (!item) continue;
    const existing = groups.get(item.proposalGroupId);
    if (existing) {
      groups.set(item.proposalGroupId, { ...existing, items: [...existing.items, item] });
    } else {
      groups.set(item.proposalGroupId, {
        proposalGroupId: item.proposalGroupId,
        sessionId,
        items: [item],
      });
    }
  }
  return [...groups.values()];
}

/**
 * Replace a pending proposal's tool input (inline ghost editing).
 *
 * @remarks
 * Only a still-`proposed` action with a stored `toolCall` is editable; approval then
 * executes the edited input verbatim. The summary is left as authored — the edit is a
 * refinement of the same intent, not a new action.
 *
 * @param sessionId - The owning session.
 * @param activityId - The proposed action to edit.
 * @param input - The replacement tool input.
 * @returns the updated activity row.
 * @throws {NotFoundError} When the activity is not found in the org-scoped session.
 * @throws {ConflictError} When the activity is not an editable pending proposal.
 */
export async function editProposalInput(
  sessionId: string,
  activityId: string,
  input: Record<string, unknown>,
): Promise<ActivityRow> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(sessionActivity)
      .where(and(eq(sessionActivity.id, activityId), eq(sessionActivity.sessionId, sessionId)))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundError('Activity not found');
    const action = row.body.action;
    if (row.type !== 'action' || row.approvalStatus !== 'proposed' || !action?.toolCall) {
      throw new ConflictError('Activity is not an editable pending proposal');
    }
    const [updated] = await tx
      .update(sessionActivity)
      .set({
        body: {
          ...row.body,
          action: { ...action, toolCall: { ...action.toolCall, input } },
        },
      })
      .where(eq(sessionActivity.id, activityId))
      .returning();
    /* v8 ignore next -- @preserve defensive: update always returns a row */
    if (!updated) throw new Error('activity update returned no row');
    return updated;
  });
}
