/**
 * `@docket/api` — how an approved action and the run around it settle once the work has run.
 *
 * @remarks
 * An approved action whose tool answers with an error result changed nothing, so it settles
 * `failed` rather than `applied`, and a run whose executed changes all failed settles its session
 * `failed` rather than `completed`. Neither may be shown as success.
 */
import { db, sessionActivity } from '@docket/db';
import { and, eq, inArray } from 'drizzle-orm';

/** The session's recorded reason when every approved change it executed failed. */
export const NOTHING_APPLIED = 'Every approved change failed; nothing was applied.';

/** The arguments a finished run settles with: its status, plus the reason when it failed. */
export type FinishedSettlement = [
  status: 'completed' | 'awaiting_approval' | 'failed',
  lastError?: string,
];

/**
 * The terminal approval state of an approved action once it has run.
 *
 * @param failed - Whether its tool reported an error.
 * @returns `failed` when nothing changed, otherwise `applied`.
 */
export function approvalOutcome(failed: boolean): 'applied' | 'failed' {
  return failed ? 'failed' : 'applied';
}

/**
 * Whether an action has already run, successfully or not, so its stored result is final.
 *
 * @param status - The action's approval state.
 */
export function hasRun(status: string | null): boolean {
  return status === 'applied' || status === 'failed';
}

/**
 * Whether any still-proposed action remains (suggest-mode leftovers included).
 *
 * @param sessionId - The session to check.
 */
export async function finalStatus(sessionId: string): Promise<'completed' | 'awaiting_approval'> {
  const remaining = await db
    .select({ id: sessionActivity.id })
    .from(sessionActivity)
    .where(
      and(
        eq(sessionActivity.sessionId, sessionId),
        eq(sessionActivity.type, 'action'),
        eq(sessionActivity.approvalStatus, 'proposed'),
      ),
    )
    .limit(1);
  return remaining.length > 0 ? 'awaiting_approval' : 'completed';
}

/**
 * How a finished run settles: `awaiting_approval` while anything is still proposed, `failed` when
 * it executed approved changes and every one of them failed, otherwise `completed`.
 *
 * @param sessionId - The session whose run just ended.
 * @returns the arguments to settle the run with.
 */
export async function finishedSettlement(sessionId: string): Promise<FinishedSettlement> {
  const pending = await finalStatus(sessionId);
  if (pending === 'awaiting_approval') return [pending];
  const executed = await db
    .select({ approvalStatus: sessionActivity.approvalStatus })
    .from(sessionActivity)
    .where(
      and(
        eq(sessionActivity.sessionId, sessionId),
        eq(sessionActivity.type, 'action'),
        inArray(sessionActivity.approvalStatus, ['applied', 'failed']),
      ),
    );
  const allFailed = executed.length > 0 && executed.every((row) => row.approvalStatus === 'failed');
  return allFailed ? ['failed', NOTHING_APPLIED] : ['completed'];
}
