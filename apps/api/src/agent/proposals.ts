/**
 * `@docket/api` — the ghost projection: pending proposals as reviewable data.
 *
 * @remarks
 * The UI contract behind the ghost system: still-`proposed` actions are grouped by
 * `proposalGroupId` (one batch per assistant turn) and each member's stored
 * `toolCall` is projected into a surface-shaped ghost — a proposal that resolves to exactly one
 * task becomes a translucent, editable task row in the workspace views; anything without a spatial
 * home, such as a multi-node `organize` plan, falls back to the session proposal card
 * (`ghost: null`). Editing a ghost
 * PATCHes the stored `toolCall.input` (only while `proposed`); approval executes
 * exactly what is stored.
 */
import { db, sessionActivity } from '@docket/db';
import type { GhostTaskOut, ProposalGroupOut, ProposalItemOut } from '@docket/types';
import { and, asc, eq, isNotNull } from 'drizzle-orm';
import type { z } from 'zod';

import { ConflictError, NotFoundError } from '../error';
import { deriveCaptureTitle } from '../lib/capture-title';
import type { ActivityRow } from '../routes/agent-session-helpers';

/** Every id in Docket is a 26-char Crockford-base32 ULID. */
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/**
 * Read a proposed reference, keeping only what the workspace can actually resolve.
 *
 * @remarks
 * The write tools accept names wherever they accept ids, so a proposal may carry "Platform
 * Migration" where the ghost's contract wants a project id. A ghost renders inside the workspace
 * views, which look up by id — so a name is dropped rather than passed through, and the ghost shows
 * the field as unset instead of pointing at nothing. The name still reaches the reviewer in the
 * proposal `summary` and the editable `input`.
 *
 * @param value - The proposed reference.
 * @returns the id, or null when it was a name or absent.
 */
function ghostRef(value: unknown): string | null {
  return typeof value === 'string' && ULID.test(value) ? value : null;
}

/** Read a proposed date, which is a plain `YYYY-MM-DD` on every tool that takes one. */
function ghostDate(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Project one stored tool call into its workspace ghost, when it has one.
 *
 * @remarks
 * A ghost is a translucent, editable task row rendered in place, so only proposals that resolve to
 * exactly one task get one. `capture` always does; `organize` does when its plan happens to be a
 * single task, which is the common shape for "add a task from what we discussed". A multi-node
 * plan has no single spatial home and falls back to the session proposal card — the tree ghost is
 * a separate surface, not something to fake by picking the first item.
 *
 * @param tool - The proposed tool.
 * @param input - Its stored, still-editable input.
 * @returns the ghost, or null when the proposal has no spatial home.
 */
function projectGhost(
  tool: string,
  input: Record<string, unknown>,
): z.input<typeof GhostTaskOut> | null {
  if (tool === 'capture') {
    const text = input['text'];
    if (typeof text !== 'string' || text.trim().length === 0) return null;
    // The same derivation `capture` itself uses, so the preview and the write agree on the title.
    return { title: deriveCaptureTitle(text), teamId: null, projectId: null, dueDate: null };
  }

  if (tool !== 'organize') return null;
  const items = input['items'];
  if (!Array.isArray(items) || items.length !== 1) return null;
  const only: unknown = items[0];
  if (typeof only !== 'object' || only === null) return null;
  const item = only as Record<string, unknown>;
  if (item['kind'] !== 'task') return null;
  const title = typeof item['title'] === 'string' ? item['title'] : '';
  if (!title) return null;
  return {
    title,
    teamId: ghostRef(item['team']),
    projectId: ghostRef(item['project']),
    dueDate: ghostDate(item['dueDate']),
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
