/**
 * `components/plan-canvas/plan-result` — what the line after a confirm says, as pure functions.
 *
 * @remarks
 * A commit answers with `createdCounts`, subtasks counted apart from tasks, and the change set
 * the personal undo route accepts. The line names what was created, kind by kind, leaving out
 * every kind the commit created none of, and an undo failure is read by its Problem code so each
 * cause gets its own sentence.
 */
import type { PlanCommitCounts, PlanCommitOut } from '@docket/work/plan-draft-contract';

import type { ProblemCode } from '@/lib/contracts/errors';
import { UserFacingError } from '@/lib/problem';

/** Where the line after a confirm is. */
export type PlanResultPhase = 'created' | 'undoing' | 'undone';

/** The line after a confirm. */
export interface PlanResult {
  readonly counts: PlanCommitCounts;
  /** How many nodes the commit matched to records already in the workspace. */
  readonly matched: number;
  /** The change set Undo reverses, or null when the commit created nothing. */
  readonly changeSetId: string | null;
  readonly phase: PlanResultPhase;
  /** Application-owned copy for the last Undo that failed, or null. */
  readonly error: string | null;
}

/** The kinds the line names, in the order it names them, with their singular and plural. */
const COUNTED_KINDS: readonly (readonly [keyof PlanCommitCounts, string, string])[] = [
  ['initiatives', 'initiative', 'initiatives'],
  ['projects', 'project', 'projects'],
  ['tasks', 'task', 'tasks'],
  ['subtasks', 'subtask', 'subtasks'],
];

/**
 * Name what a commit created: "1 initiative, 3 projects, 7 tasks, 14 subtasks".
 *
 * @param counts - The commit's `createdCounts`.
 * @returns the counted kinds joined by commas, or null when the commit created nothing.
 */
export function createdCountsText(counts: PlanCommitCounts): string | null {
  const parts = COUNTED_KINDS.filter(([key]) => counts[key] > 0).map(([key, one, many]) => {
    const count = counts[key];
    return `${String(count)} ${count === 1 ? one : many}`;
  });
  return parts.length === 0 ? null : parts.join(', ');
}

/** The line's text for a commit: what it created, or what it matched when it created nothing. */
export function planResultText(result: Pick<PlanResult, 'counts' | 'matched'>): string {
  const created = createdCountsText(result.counts);
  if (created !== null) return `Created ${created}`;
  const items = result.matched === 1 ? '1 item' : `${String(result.matched)} items`;
  return `Matched ${items} already in the workspace`;
}

/** Start the line for a commit the API accepted. */
export function planResultFrom(commit: PlanCommitOut): PlanResult {
  const created = commit.placed.filter((item) => item.created).length;
  return {
    counts: commit.createdCounts,
    matched: commit.placed.length - created,
    changeSetId: created > 0 ? commit.changeSetId : null,
    phase: 'created',
    error: null,
  };
}

/** One cause an Undo can fail for: its Problem code, its HTTP status, and what the line says. */
interface UndoFailureCause {
  readonly code: ProblemCode | null;
  readonly status: number;
  readonly copy: string;
}

/** The causes the undo route answers with, most specific first. */
const UNDO_FAILURES: readonly UndoFailureCause[] = [
  {
    code: 'not_found',
    status: 404,
    copy: 'Already undone, or the created work was removed since.',
  },
  {
    code: 'conflict',
    status: 409,
    copy: 'Some of this work changed after it was created, so it was left in place.',
  },
  { code: 'unauthorized', status: 401, copy: 'Your session ended. Sign in, then undo.' },
  {
    code: 'forbidden',
    status: 403,
    copy: 'Your role in this workspace no longer allows removing this work.',
  },
  { code: 'rate_limited', status: 429, copy: 'Too many requests. Undo again shortly.' },
  { code: null, status: 0, copy: 'Offline. Undo again once the connection is back.' },
];

/** What the line says when the server failed without naming a cause. */
const UNDO_SERVER_FAILURE = 'The server did not finish the undo. Undo again shortly.';

/**
 * Say why an Undo failed, by the Problem code first and the HTTP status after it.
 *
 * @param error - What the undo mutation rejected with.
 * @returns application-owned copy naming the cause and what to do about it.
 */
export function planUndoFailure(error: unknown): string {
  if (!(error instanceof UserFacingError)) return UNDO_SERVER_FAILURE;
  const byCode = UNDO_FAILURES.find((cause) => cause.code !== null && cause.code === error.code);
  const byStatus = UNDO_FAILURES.find((cause) => cause.status === error.status);
  return (byCode ?? byStatus)?.copy ?? UNDO_SERVER_FAILURE;
}
