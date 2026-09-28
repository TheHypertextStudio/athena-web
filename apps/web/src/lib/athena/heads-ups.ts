/**
 * Athena speaks first: the client-derived heads-up shown at the top of the thread.
 *
 * @remarks
 * This is the first slice of §4.5's "Heads-up entries" — computed entirely from the jobs already
 * on the page, with no new API surface. A job that has sat in the needs-you lane past a fixed
 * wait can surface once. Failed work stays in its work entry instead of interrupting a conversation
 * with a second report. Per §2.1 principle 3 ("initiative with restraint"), {@link headsUpsFor}
 * returns at most one heads-up, ever — the oldest waiting job wins. Per-user
 * thresholds, the Settings › Athena switch, and the "rest fold into a digest" behaviour are not
 * built yet; this slice is deliberately narrower than the spec's eventual shape.
 */
import { readStoredJson, writeStoredJson } from '@docket/ui/lib/browser-storage';

import { athenaQueueState, type PersonalAthenaSessionSummary } from './presentation';

/** A short entry Athena posts into the thread when one piece of work needs the person. */
export interface HeadsUp {
  readonly id: string;
  readonly jobId: string;
  readonly text: string;
  readonly action: 'review';
}

/** How long a job may sit in the needs-you lane before its wait becomes a heads-up. */
const WAITING_THRESHOLD_MS = 60 * 60 * 1000;

/** Where dismissed heads-up ids are remembered, per viewer, in this browser only. */
const DISMISSED_STORAGE_KEY = 'docket.athena.headsups.dismissed';

/**
 * The id one job's heads-up carries at its current `updatedAt`.
 *
 * @remarks
 * Keying by `updatedAt` as well as the job id is what makes a dismissal temporary rather than
 * permanent: once a reply (or any other update) moves `updatedAt` forward, a fresh wait starting
 * from that point gets a new id, so it resurfaces even though the earlier wait was dismissed.
 */
function headsUpId(jobId: string, updatedAt: string): string {
  return `${jobId}:${updatedAt}`;
}

/**
 * The dismissed heads-up ids this viewer has already closed.
 *
 * @returns A set of `headsUpId` values; empty when nothing is stored or storage is unreachable.
 */
export function dismissedHeadsUpIds(): ReadonlySet<string> {
  const stored = readStoredJson(DISMISSED_STORAGE_KEY);
  if (!Array.isArray(stored)) return new Set();
  return new Set(stored.filter((value): value is string => typeof value === 'string'));
}

/**
 * Remembers that this viewer closed one heads-up, so it stays closed until its job's `updatedAt`
 * moves again.
 *
 * @param id - The `HeadsUp.id` that was dismissed.
 */
export function dismissHeadsUp(id: string): void {
  const next = new Set(dismissedHeadsUpIds());
  next.add(id);
  writeStoredJson(DISMISSED_STORAGE_KEY, Array.from(next));
}

/** Whether a job has been waiting in the needs-you lane longer than the fixed threshold. */
function isOverdueForReply(job: PersonalAthenaSessionSummary, now: Date): boolean {
  const lane = job.queueState ?? athenaQueueState(job.status);
  if (lane !== 'needs_you') return false;
  return now.getTime() - new Date(job.updatedAt).getTime() > WAITING_THRESHOLD_MS;
}

/** Name the object when possible; job objectives may contain raw agent instructions. */
function waitingText(job: PersonalAthenaSessionSummary): string {
  const subject = job.context?.source?.label;
  return subject ? `${subject} needs review` : 'Work needs review';
}

/** Builds the single heads-up for one job, given which sentence it should read. */
function toHeadsUp(job: PersonalAthenaSessionSummary, text: string): HeadsUp {
  return { id: headsUpId(job.id, job.updatedAt), jobId: job.id, text, action: 'review' };
}

/**
 * Athena's one thing that matters right now, if there is one.
 *
 * @param jobs - The jobs running alongside the thread, in any order.
 * @param now - The instant to measure waits against.
 * @returns Zero or one heads-up. The oldest job that has waited past the threshold wins;
 * dismissed heads-ups (by job id and `updatedAt`) are excluded.
 */
export function headsUpsFor(
  jobs: readonly PersonalAthenaSessionSummary[],
  now: Date,
): readonly HeadsUp[] {
  const dismissed = dismissedHeadsUpIds();
  const eligible = jobs.filter((job) => !dismissed.has(headsUpId(job.id, job.updatedAt)));

  const waiting = eligible.filter((job) => isOverdueForReply(job, now));
  const oldestWaiting = waiting
    .slice()
    .sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime())[0];
  if (oldestWaiting) return [toHeadsUp(oldestWaiting, waitingText(oldestWaiting))];

  return [];
}
