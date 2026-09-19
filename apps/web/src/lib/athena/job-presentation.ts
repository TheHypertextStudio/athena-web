/**
 * Pure helpers that describe one piece of delegated work in an entry's words.
 *
 * @remarks
 * These sit on top of {@link presentAthenaActivity} and the personal Athena presentation
 * contracts: a job's tone, the single state line that says where it stands, the changes a finished
 * job made, and what a stopped one did not do. They also decide which jobs belong in the panel's
 * thread and merge them with the thread's own activity stream into one chronological list.
 */
import type { ElicitationOut } from '@docket/athena/elicitation-api';
import type { SessionActivityOut } from '@docket/athena/agent-contract';
import { relativeTime } from '@docket/ui';

import { describeToolActivity } from './describe-proposal';
import type { PersonalAthenaQueuePayload } from './query-defs';
import {
  athenaQueueState,
  failedToolSentence,
  presentAthenaActivity,
  type AthenaActivityPresentation,
  type PersonalAthenaActivity,
  type PersonalAthenaSessionDetail,
  type PersonalAthenaSessionSummary,
  type PersonalAthenaSource,
  type PersonalAthenaStatus,
} from './presentation';

/** The state a work entry is drawn in: waiting on you, running, finished, or stopped. */
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

/** Map a job's lifecycle status to the tone its entry is drawn in. */
export function jobTone(status: PersonalAthenaStatus): JobTone {
  return JOB_TONE_BY_STATUS[status];
}

/**
 * A count with its noun, singular for exactly one: "1 step", "3 steps", "1 change".
 *
 * @param count - How many.
 * @param singular - The noun for one.
 * @param plural - The noun for any other count; defaults to `singular` plus "s".
 */
export function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${String(count)} ${count === 1 ? singular : plural}`;
}

/** The tool beat of the personal activity union. */
type ToolActivity = Extract<PersonalAthenaActivity, { type: 'tool' }>;

/** The detail's `tool`-type activities, oldest first. */
function toolActivities(activities: readonly PersonalAthenaActivity[]): readonly ToolActivity[] {
  return activities.filter((activity): activity is ToolActivity => activity.type === 'tool');
}

/**
 * The sentence that names a pending decision, for the decision line of a waiting entry.
 *
 * @remarks
 * The API's `decision.title` is a generic label ("update task"). The newest `tool` activity, when
 * it carried its raw call through (`technical.toolName` + `technical.input`), describes the same
 * change through {@link describeToolActivity} — the same helper the batch-review card uses — which
 * reads "Set state to In Progress" instead. Falls back to `decision.title` when the newest tool
 * step carries no raw call, or when the detail has no pending decision at all.
 *
 * This sentence appears on the decision line and nowhere else: the state line above it reads
 * "Waiting on you", so an entry never says the same thing twice.
 *
 * @param detail - The loaded session detail.
 * @returns the plain-language sentence for the detail's pending decision.
 */
export function decisionSentence(detail: PersonalAthenaSessionDetail): string {
  const toolActivity = toolActivities(detail.activities).at(-1);
  if (
    toolActivity?.technical?.toolName !== undefined &&
    toolActivity.technical.input !== undefined
  ) {
    return describeToolActivity(toolActivity);
  }
  return detail.decision?.title ?? '';
}

/** One change a finished job made, for its receipt. */
export interface JobChange {
  /** The step that made the change. */
  readonly id: string;
  /** The change in plain words: "Set state to In Progress". */
  readonly text: string;
}

/** Every gated change that was approved and landed, oldest first. */
export function jobChanges(detail: PersonalAthenaSessionDetail): readonly JobChange[] {
  return toolActivities(detail.activities)
    .filter((activity) => activity.applied === true && activity.failed !== true)
    .map((activity) => ({ id: activity.id, text: describeToolActivity(activity) }));
}

/**
 * What did not happen, from the newest failed step: "Could not set state to In Progress".
 *
 * @remarks
 * Derived from the step's own tool call, never from its result text — that text is the tool's or
 * provider's, and a failure's text is never shown verbatim.
 *
 * @returns the sentence, or `null` when no step failed.
 */
export function jobFailureCause(detail: PersonalAthenaSessionDetail): string | null {
  const failed = toolActivities(detail.activities)
    .filter((activity) => activity.failed === true)
    .at(-1);
  return failed ? failedToolSentence(failed) : null;
}

/** The longest an activity's detail can be before it is dropped from a running state line. */
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

/**
 * A running job's narration: the newest step, naming its object.
 *
 * @remarks
 * A progress beat or Athena's own message is its own sentence ("Drafting email 2 of 3"); any other
 * step reads as its title
 * with a short detail appended, and drops a detail too long to share one line.
 */
function newestActivityLine(detail: PersonalAthenaSessionDetail): string | null {
  const newest = newestActivity(detail);
  if (!newest) return null;
  const narration =
    newest.kind === 'progress' || (newest.kind === 'message' && newest.title !== 'You asked');
  if (narration && newest.detail) return newest.detail;
  if (newest.detail !== undefined && newest.detail.length <= STATUS_LINE_DETAIL_LIMIT) {
    return `${newest.title} · ${newest.detail}`;
  }
  return newest.title;
}

/** The state line a waiting entry shows; the decision line below it names what is waiting. */
const WAITING_LINE = 'Waiting on you';

/** "nothing changed", "1 change", or "3 changes". */
function changesPhrase(detail: PersonalAthenaSessionDetail): string {
  const count = jobChanges(detail).length;
  return count === 0 ? 'nothing changed' : countLabel(count, 'change');
}

/** When a finished job ended: the loaded detail's `updatedAt`, else the summary's. */
function finishedAt(
  detail: PersonalAthenaSessionDetail | null,
  summary: PersonalAthenaSessionSummary,
): string {
  return detail?.updatedAt ?? summary.updatedAt;
}

/** The inputs every state line is derived from. */
interface StateLineInput {
  readonly detail: PersonalAthenaSessionDetail | null;
  readonly summary: PersonalAthenaSessionSummary;
  readonly now: Date;
}

/** A running job's line: its newest step, or when it started. */
function runningLine({ detail, summary, now }: StateLineInput): string {
  const narration = detail ? newestActivityLine(detail) : null;
  return narration ?? `Started ${relativeTime(summary.createdAt, now)}`;
}

/** A finished job's line: when it finished, and how many changes landed. */
function finishedLine({ detail, summary, now }: StateLineInput): string {
  const when = `Finished ${relativeTime(finishedAt(detail, summary), now)}`;
  return detail ? `${when} · ${changesPhrase(detail)}` : when;
}

/**
 * What a stopped job's newest unfinished step would have done: "Did not set state to In Progress".
 *
 * @returns the sentence, or `null` when every step either landed or failed.
 */
function unfinishedStepSentence(detail: PersonalAthenaSessionDetail): string | null {
  const unfinished = toolActivities(detail.activities)
    .filter((activity) => activity.applied !== true && activity.failed !== true)
    .at(-1);
  if (!unfinished) return null;
  const described = describeToolActivity(unfinished);
  return `Did not ${described.charAt(0).toLowerCase()}${described.slice(1)}`;
}

/** Where a stopped job got to when no step names what did not happen. */
function stoppedProgress(detail: PersonalAthenaSessionDetail): string {
  const count = jobChanges(detail).length;
  if (count > 0) return `after ${countLabel(count, 'change')}`;
  const newest = newestActivityLine(detail);
  return newest ? `at ${newest}` : 'before its first step';
}

/**
 * A stopped job's line, always concrete: the step that failed, the step that never ran, or how far
 * the work got — "Stopped · Could not set state to In Progress", "Canceled · Did not send the
 * recap", "Stopped after 2 changes", "Canceled before its first step".
 */
function stoppedLine({ detail, summary }: StateLineInput): string {
  const status = detail?.status ?? summary.status;
  const verb = status === 'canceled' ? 'Canceled' : 'Stopped';
  if (!detail) return verb;
  const cause = jobFailureCause(detail) ?? unfinishedStepSentence(detail);
  if (cause) return `${verb} · ${cause}`;
  return `${verb} ${stoppedProgress(detail)}`;
}

const STATE_LINE_BY_TONE: Readonly<Record<JobTone, (input: StateLineInput) => string>> = {
  attention: () => WAITING_LINE,
  active: runningLine,
  done: finishedLine,
  stopped: stoppedLine,
};

/**
 * The one line that says where a job stands — the only place an entry writes its state.
 *
 * @remarks
 * Waiting: "Waiting on you". Running: the newest step, naming its object. Finished: "Finished 4m
 * ago · 2 changes" or "… · nothing changed". Stopped: "Stopped · Could not set state to In
 * Progress", or the changes that landed when no step failed.
 *
 * @param detail - The loaded detail, or `null` before it loads (or on a host that never loads it).
 * @param summary - The queue row, for the lifecycle status and timestamps.
 * @param now - The reference time for relative phrasing; injectable for tests.
 */
export function jobStatusLine(
  detail: PersonalAthenaSessionDetail | null,
  summary: PersonalAthenaSessionSummary,
  now: Date = new Date(),
): string {
  const tone = jobTone(detail?.status ?? summary.status);
  return STATE_LINE_BY_TONE[tone]({ detail, summary, now });
}

/**
 * Every job in the queue's three lanes, flattened into one list.
 *
 * @remarks
 * Drops the session named by `payload.currentChat`: that session is the person's own conversation,
 * identified by the queue payload rather than by any lane it happens to also appear in, and it is
 * not a piece of delegated work.
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

/** The jobs that are waiting on the person to decide something, in the order given. */
export function jobsNeedingYou(
  jobs: readonly PersonalAthenaSessionSummary[],
): readonly PersonalAthenaSessionSummary[] {
  return jobs.filter((job) => (job.queueState ?? athenaQueueState(job.status)) === 'needs_you');
}

/** Whether two page sources name the same object; two absent sources (a workspace page) match. */
function sameSource(
  a: PersonalAthenaSource | undefined,
  b: PersonalAthenaSource | undefined,
): boolean {
  if (!a || !b) return a === b;
  return a.type === b.type && a.id === b.id;
}

/**
 * The jobs that belong in the panel's thread for the page the person is on.
 *
 * @remarks
 * A job belongs when it was started from this page — its source is the page's source, or both are
 * the workspace itself — or when it was started in this conversation (`startedHere`). Everything
 * else is history, and history lives in the Work ledger on the wide view.
 *
 * @param jobs - The workspace's jobs.
 * @param pageSource - The object the current page is about, or `undefined` on a workspace page.
 * @param startedHere - Ids of jobs started while this conversation was open.
 */
export function threadJobs(
  jobs: readonly PersonalAthenaSessionSummary[],
  pageSource: PersonalAthenaSource | undefined,
  startedHere: ReadonlySet<string>,
): readonly PersonalAthenaSessionSummary[] {
  return jobs.filter(
    (job) => startedHere.has(job.id) || sameSource(job.context?.source, pageSource),
  );
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

/** A question Athena asked, rendered as a thread entry at the time it was asked. */
export interface ThreadQuestionEntry {
  readonly kind: 'question';
  readonly at: string;
  readonly question: ElicitationOut;
}

/** One row in the merged conversation thread. */
export type ThreadEntry = ThreadJobEntry | ThreadActivityEntry | ThreadQuestionEntry;

/** Same-timestamp order: the conversation's own activity, then questions, then work. */
const KIND_ORDER: Readonly<Record<ThreadEntry['kind'], number>> = {
  activity: 0,
  question: 1,
  job: 2,
};

/** Order entries by time, breaking a tie by {@link KIND_ORDER}. */
function compareThreadEntries(a: ThreadEntry, b: ThreadEntry): number {
  if (a.at !== b.at) return a.at < b.at ? -1 : 1;
  return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
}

/**
 * Merge a thread's raw activities, the jobs that belong in it, and its questions into one list,
 * sorted by time ascending.
 */
export function mergeThreadEntries(
  activities: readonly SessionActivityOut[],
  jobs: readonly PersonalAthenaSessionSummary[],
  questions: readonly ElicitationOut[] = [],
): readonly ThreadEntry[] {
  const entries: ThreadEntry[] = [
    ...activities.map((activity): ThreadEntry => ({
      kind: 'activity',
      at: activity.createdAt,
      activity,
    })),
    ...jobs.map((job): ThreadEntry => ({ kind: 'job', at: job.createdAt, job })),
    ...questions.map((question): ThreadEntry => ({
      kind: 'question',
      at: question.createdAt,
      question,
    })),
  ];
  return entries.sort(compareThreadEntries);
}
