/**
 * `time/timer-join` — the sub-minute continuation rule.
 *
 * @remarks
 * A person who stops tracking to answer a question and starts again twenty seconds later did not
 * take a break; they were interrupted. Recording that as two segments with a gap between them
 * turns a normal working rhythm into a jagged, untrue history, which is precisely the complaint
 * this rule answers: *"if the timer is started less than a minute after beginning a task, the
 * system just automatically joins the segments together instead of treating that as a break."*
 *
 * The rule is a pure predicate over segments so it can be reasoned about — and tested — without
 * a clock, a transaction or a database. Storage stays honest: a joined resume **reopens the
 * existing segment row** rather than writing a second row and hiding the seam at read time, so
 * the persisted segments are exactly the segments a report will sum.
 */

/**
 * The longest gap that still counts as the same stretch of work.
 *
 * @remarks
 * The author's words are "less than a minute", so the comparison is strictly `<`. That makes the
 * boundary deterministic and states it in one place: a 59,999 ms gap joins, 60,000 ms exactly
 * does not. Placing the boundary on the *exclusive* side means "a minute later" is always a new
 * segment, which is the reading that never surprises anyone.
 */
export const TIMER_JOIN_WINDOW_MS = 60_000;

/** The minimum a segment must know about itself for the join rule to apply. */
export interface JoinCandidate {
  readonly id: string;
  readonly taskId: string;
  readonly endedAt: Date | null;
}

/**
 * Decide whether resuming `taskId` at `now` continues `candidate` instead of starting a segment.
 *
 * @remarks
 * Three conditions, all required, none of them incidental:
 *
 * 1. **Same task.** A join across a task change would move time from one subject to another,
 *    which is the one thing a time ledger may never do. The check is on the segment's own
 *    `taskId`, not its record's, so it holds even for a record whose anchor was resolved
 *    elsewhere.
 * 2. **Actually closed.** An open segment (`endedAt === null`) is already accruing; "joining" it
 *    would be a no-op dressed up as a decision.
 * 3. **Gap strictly under {@link TIMER_JOIN_WINDOW_MS}.** A negative gap — a clock that moved
 *    backwards — is not a join either: reopening a segment that ends in the future would let it
 *    swallow time nobody worked.
 *
 * @param candidate - The most recent segment for this user, or null when there is none.
 * @param taskId - The task tracking is resuming on.
 * @param now - The server clock at resume.
 * @returns whether `candidate` should be reopened rather than a new segment written.
 */
export function shouldJoinSegment(
  candidate: JoinCandidate | null | undefined,
  taskId: string,
  now: Date,
): boolean {
  if (!candidate?.endedAt) return false;
  if (candidate.taskId !== taskId) return false;
  const gapMs = now.getTime() - candidate.endedAt.getTime();
  return gapMs >= 0 && gapMs < TIMER_JOIN_WINDOW_MS;
}
