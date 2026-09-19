/**
 * Pure helpers that describe one piece of delegated work in a card's words.
 *
 * @remarks
 * These sit on top of {@link presentAthenaActivity} and the personal Athena presentation
 * contracts: a job's tone, its short state label, and the single line that says what it is
 * doing right now. They also merge a thread's raw activity stream with the jobs running
 * alongside it into one chronological list, so the conversation and the Working strip read
 * from the same order.
 */
import type { SessionActivityOut } from '@docket/athena/agent-contract';

import { describeToolActivity } from './describe-proposal';
import type { PersonalAthenaQueuePayload } from './query-defs';
import {
  athenaQueueState,
  presentAthenaActivity,
  type AthenaActivityPresentation,
  type PersonalAthenaActivity,
  type PersonalAthenaSessionDetail,
  type PersonalAthenaSessionSummary,
  type PersonalAthenaStatus,
} from './presentation';

/** The visual weight a job card takes on, driven by its lifecycle status. */
export type JobTone = 'attention' | 'active' | 'done' | 'stopped';

const JOB_TONE_BY_STATUS: Readonly<Record<PersonalAthenaStatus, JobTone>> = {
  pending: 'active',
  running: 'active',
  awaiting_input: 'attention',
  awaiting_approval: 'attention',
  completed: 'done',
  failed: 'stopped',
  canceled: 'stopped',
};

const JOB_STATE_LABEL_BY_TONE: Readonly<Record<JobTone, string>> = {
  attention: 'Needs you',
  active: 'Working',
  done: 'Done',
  stopped: 'Stopped',
};

/** Map a job's lifecycle status to the tone its card is drawn in. */
export function jobTone(status: PersonalAthenaStatus): JobTone {
  return JOB_TONE_BY_STATUS[status];
}

/** The short, plain-language label for a job's current status. */
export function jobStateLabel(status: PersonalAthenaStatus): string {
  return JOB_STATE_LABEL_BY_TONE[jobTone(status)];
}

/** The detail's newest `tool`-type activity, or `null` when it has taken none yet. */
function newestToolActivity(
  activities: readonly PersonalAthenaActivity[],
): Extract<PersonalAthenaActivity, { type: 'tool' }> | null {
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index];
    if (activity?.type === 'tool') return activity;
  }
  return null;
}

/**
 * The sentence that names a pending decision, shared by the status line and the decision block's
 * own heading.
 *
 * @remarks
 * The API's `decision.title` is a generic label ("update task"), which is why a job's status line
 * and its decision block used to repeat the same generic phrase. The newest `tool` activity, when
 * it carried its raw call through (`technical.toolName` + `technical.input`), describes the same
 * change through {@link describeToolActivity} — the same helper the batch-review card uses — which
 * reads "Set state to In Progress" instead. Falls back to `decision.title` when the newest tool
 * step carries no raw call, or when the detail has no pending decision at all.
 *
 * @param detail - The loaded session detail.
 * @returns the plain-language sentence for the detail's pending decision.
 */
export function decisionSentence(detail: PersonalAthenaSessionDetail): string {
  const toolActivity = newestToolActivity(detail.activities);
  if (
    toolActivity?.technical?.toolName !== undefined &&
    toolActivity.technical.input !== undefined
  ) {
    return describeToolActivity(toolActivity);
  }
  return detail.decision?.title ?? '';
}

/** The longest an activity's detail can be before it is dropped from the status line. */
const STATUS_LINE_DETAIL_LIMIT = 60;

/** The most recent non-reasoning activity's own presentation, or `null` when there is none. */
function newestActivity(detail: PersonalAthenaSessionDetail): AthenaActivityPresentation | null {
  let newest: AthenaActivityPresentation | null = null;
  for (const activity of detail.activities) {
    const presented = presentAthenaActivity(activity);
    if (!presented) continue;
    if (newest && presented.createdAt <= newest.createdAt) continue;
    newest = presented;
  }
  return newest;
}

/** Find the most recent non-reasoning activity's rendered status line, or `null` when there is none. */
function newestActivityLine(detail: PersonalAthenaSessionDetail): string | null {
  const newest = newestActivity(detail);
  if (!newest) return null;
  if (newest.detail !== undefined && newest.detail.length <= STATUS_LINE_DETAIL_LIMIT) {
    return `${newest.title} · ${newest.detail}`;
  }
  return newest.title;
}

/**
 * The most recent non-reasoning activity's own text, with no length limit — its detail when it
 * has one, its title otherwise — for a finished job's one status line.
 *
 * @remarks
 * Unlike {@link newestActivityLine}, this never drops a long detail: a finished entry shows this
 * text in place of both the old running-status line and the receipt's own summary, so it needs
 * to carry the full sentence rather than the trimmed one a still-open job can afford to shorten.
 */
function newestActivityText(detail: PersonalAthenaSessionDetail): string | null {
  const newest = newestActivity(detail);
  if (!newest) return null;
  return newest.detail ?? newest.title;
}

/**
 * A finished job's one status line: the result's own summary, or — when it left no result — the
 * newest step's own text.
 *
 * @remarks
 * Never falls back to the bare state label for a finished job that left either one, since the
 * heading badge already says "Done" or "Stopped" and repeating a generic "Progress" line
 * duplicates nothing useful.
 */
function finishedStatusLine(
  detail: PersonalAthenaSessionDetail | null,
  liveStatus: PersonalAthenaStatus,
): string {
  if (detail?.result) return detail.result.summary;
  const stepText = detail ? newestActivityText(detail) : null;
  return stepText ?? jobStateLabel(liveStatus);
}

/**
 * A still-open job's one status line: a decision awaiting the owner, then the newest
 * non-reasoning activity, then the result, then the state label so the line is never blank.
 */
function openStatusLine(
  detail: PersonalAthenaSessionDetail | null,
  summary: PersonalAthenaSessionSummary,
): string {
  if (detail?.decision) return decisionSentence(detail);

  const activityLine = detail ? newestActivityLine(detail) : null;
  if (activityLine !== null) return activityLine;

  if (detail?.result) return detail.result.summary;

  return jobStateLabel(summary.status);
}

/**
 * The single line that says what a job is doing right now — {@link finishedStatusLine} once the
 * job is `done` or `stopped`, {@link openStatusLine} while it is still open.
 */
export function jobStatusLine(
  detail: PersonalAthenaSessionDetail | null,
  summary: PersonalAthenaSessionSummary,
): string {
  const liveStatus = detail?.status ?? summary.status;
  const tone = jobTone(liveStatus);

  if (tone === 'done' || tone === 'stopped') return finishedStatusLine(detail, liveStatus);

  return openStatusLine(detail, summary);
}

/**
 * Every job in the queue's three lanes, flattened into one list.
 *
 * @remarks
 * Drops the session named by `payload.currentChat`: that session is the person's own conversation,
 * identified by the queue payload rather than by any lane it happens to also appear in, and it is
 * not a piece of delegated work — showing it in the Working strip or the thread as a job duplicates
 * the conversation the person is already having.
 */
export function jobsFromQueue(
  payload: PersonalAthenaQueuePayload,
): readonly PersonalAthenaSessionSummary[] {
  const currentChatId = payload.currentChat?.id ?? null;
  const all = [
    ...payload.sessions.needsYou,
    ...payload.sessions.working,
    ...payload.sessions.finished,
  ];
  return currentChatId ? all.filter((job) => job.id !== currentChatId) : all;
}

/**
 * The queue's jobs that are waiting on the person to decide something, in queue order.
 *
 * @remarks
 * Backs the rail's single "N need you" line: rather than a pinned strip of every open job, the
 * rail names only the ones that need a decision, and lets the thread itself carry the rest.
 */
export function jobsNeedingYou(
  jobs: readonly PersonalAthenaSessionSummary[],
): readonly PersonalAthenaSessionSummary[] {
  return jobs.filter((job) => (job.queueState ?? athenaQueueState(job.status)) === 'needs_you');
}

/** The rail's "N need you" line, singular for exactly one job. */
export function needsYouLabel(count: number): string {
  return count === 1 ? '1 needs you' : `${String(count)} need you`;
}

/** A job rendered as a thread entry, ordered by when it started. */
export interface ThreadJobEntry {
  readonly kind: 'job';
  readonly at: string;
  readonly job: PersonalAthenaSessionSummary;
}

/** A raw activity rendered as a thread entry, ordered by when it was appended. */
export interface ThreadActivityEntry {
  readonly kind: 'activity';
  readonly at: string;
  readonly activity: SessionActivityOut;
}

/** One row in the merged conversation thread. */
export type ThreadEntry = ThreadJobEntry | ThreadActivityEntry;

/** Break a tie between entries with the same timestamp: the activity goes first. */
function compareThreadEntries(a: ThreadEntry, b: ThreadEntry): number {
  if (a.at !== b.at) return a.at < b.at ? -1 : 1;
  if (a.kind === b.kind) return 0;
  return a.kind === 'activity' ? -1 : 1;
}

/**
 * Merge a thread's raw activities with the jobs running alongside it into one list, sorted by
 * time ascending. An activity and a job that land on the same timestamp keep the activity first.
 */
export function mergeThreadEntries(
  activities: readonly SessionActivityOut[],
  jobs: readonly PersonalAthenaSessionSummary[],
): readonly ThreadEntry[] {
  const activityEntries: readonly ThreadEntry[] = activities.map((activity) => ({
    kind: 'activity',
    at: activity.createdAt,
    activity,
  }));
  const jobEntries: readonly ThreadEntry[] = jobs.map((job) => ({
    kind: 'job',
    at: job.createdAt,
    job,
  }));
  return [...activityEntries, ...jobEntries].sort(compareThreadEntries);
}
