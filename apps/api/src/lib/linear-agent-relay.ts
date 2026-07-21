/**
 * `@docket/api` — the Linear **Agent** outbound relay: mirrors a session's new/changed
 * `session_activity` rows onto the Linear agent session's Activity stream.
 *
 * @remarks
 * The counterpart of `routes/ingest-linear-agent.ts` (inbound): where that handler turns a
 * Linear `AgentSessionEvent` into Docket session state, {@link relayLinearAgentActivity} turns
 * Docket session state back into Linear activity, after every cron-driven {@link driveSession}
 * call (`routes/linear-agent-sweep.ts`).
 *
 * ## The watermark: what counts as "new since last relay"
 *
 * `session_activity` has no ordinal/sequence column beyond `id` (a time-prefixed ULID) /
 * `createdAt` / `updatedAt`. A naive `id > lastRelayedActivityId` cursor looks sufficient — ULIDs
 * sort lexicographically by creation time — but it is NOT: `executeApprovedActions` updates an
 * existing `action` row's `approvalStatus`/`body` IN PLACE on approve/reject rather than
 * inserting a new row (that is exactly why `session_activity.updatedAt` exists — see that
 * column's own remarks in `packages/db/src/schema/agents.ts`). An `id`-only cursor would never
 * re-visit that row, so a `proposed` action's eventual `applied`/`rejected` resolution would
 * never reach Linear.
 *
 * The fix is a standard keyset-pagination cursor over `(updatedAt, id)` rather than `id` alone,
 * persisted as a PAIR on `agent_session_external_link`
 * (`lastRelayedActivityUpdatedAt`, `lastRelayedActivityId`):
 *
 * ```sql
 * WHERE session_id = :sessionId
 *   AND (updated_at, id) > (:watermarkUpdatedAt, :watermarkId)
 * ORDER BY updated_at ASC, id ASC
 * ```
 *
 * This single comparison correctly captures BOTH cases with no special-casing:
 *   - a newly-INSERTED row has `updatedAt = createdAt` at the moment of insert, which is always
 *     `>` a watermark taken before that insert happened;
 *   - an in-place UPDATE (the `action`-approval transition) bumps `updatedAt` past whatever it
 *     was when the row was first (or previously) seen, so it naturally re-qualifies.
 *
 * The `id` tiebreaker matters because Postgres timestamps can collide (two rows written in the
 * same statement can share a `NOW()`); comparing `(updatedAt, id)` as a pair — not `updatedAt`
 * alone — is what makes this a safe, gap-free cursor: no row is ever skipped at a tie, and no
 * row is ever re-emitted once the cursor has passed it.
 *
 * A still-`proposed` action row is deliberately advanced past (see {@link shouldSkipRelay}) even
 * though it is never posted to Linear at that moment — this is safe, NOT a loss, precisely
 * because of the mechanism above: whenever that row's `approvalStatus` later changes, its
 * `updatedAt` is bumped to a value strictly newer than the position the cursor was advanced to,
 * so it automatically re-qualifies on a later sweep tick. No separate "recheck gated actions"
 * pass is needed.
 *
 * ## Partial-failure semantics
 *
 * Rows are relayed to Linear in cursor order, one `agentActivityCreate` call at a time. If a
 * call throws, this function STOPS relaying further rows for this session on this pass (it does
 * not skip ahead to try later rows) and leaves the watermark exactly at the last successfully
 * (or deliberately-skipped) row. This is a deliberate choice, not an oversight: the watermark is
 * a single cursor position, not a per-row relayed-set, so "skip the failed row and keep going"
 * would have no way to avoid DOUBLE-POSTING a later row to Linear on the next sweep tick (the
 * cursor would already sit past it). Stopping at the first failure guarantees every row is
 * posted to Linear at most once, at the cost of later rows in the same pass waiting one more
 * sweep tick behind the retry of the failed one — an acceptable trade since Linear-side ordering
 * matters and duplicate posts would be user-visible.
 */
import { and, asc, eq, gt, or } from 'drizzle-orm';

import { agentSessionExternalLink, db, sessionActivity } from '@docket/db';
import type { SessionActivityBody } from '@docket/db';

import {
  buildLinearAgentPortForIntegration,
  findLinearAgentIntegration,
} from './linear-agent-credential';

/** The selected `session_activity` row shape this module reads/relays. */
type ActivityRow = typeof sessionActivity.$inferSelect;

/**
 * Whether an activity row must never be pushed to Linear — either because it is the visible
 * mirror of an inbound Linear reply (relaying it back would echo the person's own message at
 * them), or because it is a gated action still awaiting a decision (no Linear-side
 * approve/reject affordance exists for it yet; see the module remarks on why skipping here is
 * safe rather than a loss).
 */
function shouldSkipRelay(row: ActivityRow): boolean {
  if (row.type === 'response' && row.body['author'] === 'user') return true;
  if (row.type === 'action' && row.approvalStatus === 'proposed') return true;
  return false;
}

/** Render an `action` row's structured body into the Markdown Linear displays. */
function actionMarkdown(
  body: SessionActivityBody,
  approvalStatus: ActivityRow['approvalStatus'],
): string {
  const action = body.action;
  const summary = action?.summary ?? 'Action';
  if (approvalStatus === 'rejected') {
    return `**${summary}**\n\nRejected by the approver — not executed.`;
  }
  const result = action?.result;
  if (!result) return `**${summary}**`;
  return result.isError
    ? `**${summary}**\n\nFailed: ${result.content}`
    : `**${summary}**\n\n${result.content}`;
}

/**
 * Derive the Markdown body {@link import('@docket/integrations').agentActivityCreate} sends for
 * one activity row.
 *
 * @remarks
 * `thought`/`response`/`elicitation`/`error` rows carry their content as plain `body.text`. An
 * `action` row has no `text` field at all — its content lives in the structured
 * `body.action.{summary,result}` shape (see {@link SessionActivityBody}) — so it is summarized
 * into Markdown separately by {@link actionMarkdown}.
 */
function activityMarkdown(row: ActivityRow): string {
  if (row.type === 'action') return actionMarkdown(row.body, row.approvalStatus);
  return row.body.text ?? '';
}

/**
 * Whether Linear should treat this activity as ephemeral (not persisted in the session's
 * history) or durable.
 *
 * @remarks
 * Per the task's own framing of Linear's documented semantics: `thought`/`action` are
 * in-progress narration and tool-call bookkeeping (ephemeral); `response`/`elicitation`/`error`
 * are the durable deliverable a human should still see after the fact. Returns `undefined`
 * (rather than `false`) for the durable cases so the port's optional `ephemeral` field is
 * omitted entirely, matching {@link import('@docket/integrations').agentActivityCreate}'s own
 * "send it only when defined" contract.
 */
function ephemeralFor(type: ActivityRow['type']): true | undefined {
  return type === 'thought' || type === 'action' ? true : undefined;
}

/**
 * Relay one session's new/changed activity to its linked Linear agent session.
 *
 * @remarks
 * A no-op (immediate return) for any session with no `agent_session_external_link` row — i.e.
 * every non-Linear-originated session `driveSession` might settle elsewhere in this codebase.
 * Safe to call repeatedly (idempotent up to the watermark; see the module remarks for the
 * partial-failure contract).
 *
 * @param orgId - The active organization id.
 * @param sessionId - The session whose new activity should be relayed.
 */
export async function relayLinearAgentActivity(orgId: string, sessionId: string): Promise<void> {
  const [link] = await db
    .select()
    .from(agentSessionExternalLink)
    .where(eq(agentSessionExternalLink.sessionId, sessionId))
    .limit(1);
  if (!link) return; // not a Linear-originated session — nothing to relay.

  const integrationRow = await findLinearAgentIntegration(orgId);
  if (!integrationRow) return; // the org's linear_agent integration was removed after linking.
  const port = await buildLinearAgentPortForIntegration(integrationRow.id);
  if (!port) return; // no (or an unparseable) credential — degrade rather than crash the sweep.

  // The compound keyset cursor described in the module remarks: `(updatedAt, id) > watermark`,
  // or every row for this session on the very first relay pass (both watermark halves null).
  const cursor = link.lastRelayedActivityUpdatedAt
    ? or(
        gt(sessionActivity.updatedAt, link.lastRelayedActivityUpdatedAt),
        and(
          eq(sessionActivity.updatedAt, link.lastRelayedActivityUpdatedAt),
          gt(sessionActivity.id, link.lastRelayedActivityId ?? ''),
        ),
      )
    : undefined;

  const candidates = await db
    .select()
    .from(sessionActivity)
    .where(and(eq(sessionActivity.sessionId, sessionId), cursor))
    .orderBy(asc(sessionActivity.updatedAt), asc(sessionActivity.id));

  let watermarkId = link.lastRelayedActivityId;
  let watermarkUpdatedAt = link.lastRelayedActivityUpdatedAt;
  // Tracked separately from comparing `watermarkId`/`watermarkUpdatedAt` against the link's
  // ORIGINAL values below: an in-place `action` update can revisit the SAME row id this session
  // was already watermarked at (only its `updatedAt` moved), so an id-equality check alone would
  // wrongly conclude "nothing advanced" and skip persisting the newer `updatedAt`.
  let advanced = false;

  for (const row of candidates) {
    if (shouldSkipRelay(row)) {
      watermarkId = row.id;
      watermarkUpdatedAt = row.updatedAt;
      advanced = true;
      continue;
    }
    try {
      await port.agentActivityCreate({
        agentSessionId: link.externalSessionId,
        type: row.type,
        body: activityMarkdown(row),
        ...(ephemeralFor(row.type) !== undefined ? { ephemeral: true } : {}),
      });
    } catch (err) {
      // Stop here (see module remarks): the watermark below only advances up to the LAST
      // successfully-relayed row, so this row — and everything after it — is retried in full,
      // in order, on the next sweep tick.
      console.warn('[linear-agent-relay] activity relay failed; retrying next sweep tick', {
        sessionId,
        activityId: row.id,
        activityType: row.type,
        error: err instanceof Error ? err.message : String(err),
      });
      break;
    }
    watermarkId = row.id;
    watermarkUpdatedAt = row.updatedAt;
    advanced = true;
  }

  if (advanced) {
    await db
      .update(agentSessionExternalLink)
      .set({ lastRelayedActivityId: watermarkId, lastRelayedActivityUpdatedAt: watermarkUpdatedAt })
      .where(eq(agentSessionExternalLink.sessionId, sessionId));
  }
}
