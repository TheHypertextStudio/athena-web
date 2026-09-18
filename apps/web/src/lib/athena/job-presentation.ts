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

import {
  presentAthenaActivity,
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

/** The longest an activity's detail can be before it is dropped from the status line. */
const STATUS_LINE_DETAIL_LIMIT = 60;

/** Find the most recent non-reasoning activity's rendered status line, or `null` when there is none. */
function newestActivityLine(detail: PersonalAthenaSessionDetail): string | null {
  let newestTitle: string | null = null;
  let newestDetail: string | undefined;
  let newestCreatedAt: string | null = null;

  for (const activity of detail.activities) {
    const presented = presentAthenaActivity(activity);
    if (!presented) continue;
    if (newestCreatedAt !== null && presented.createdAt <= newestCreatedAt) continue;
    newestTitle = presented.title;
    newestDetail = presented.detail;
    newestCreatedAt = presented.createdAt;
  }

  if (newestTitle === null) return null;
  if (newestDetail !== undefined && newestDetail.length <= STATUS_LINE_DETAIL_LIMIT) {
    return `${newestTitle} · ${newestDetail}`;
  }
  return newestTitle;
}

/**
 * The single line that says what a job is doing right now.
 *
 * @remarks
 * Prefers a decision awaiting the owner, then the newest non-reasoning activity, then the
 * finished result's summary. When the detail has not loaded yet, or has none of those to show,
 * falls back to the job's plain-language state label so the line is never blank.
 */
export function jobStatusLine(
  detail: PersonalAthenaSessionDetail | null,
  summary: PersonalAthenaSessionSummary,
): string {
  if (detail?.decision) return detail.decision.title;

  const activityLine = detail ? newestActivityLine(detail) : null;
  if (activityLine !== null) return activityLine;

  if (detail?.result) return detail.result.summary;

  return jobStateLabel(summary.status);
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
