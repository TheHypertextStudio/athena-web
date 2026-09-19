'use client';

/**
 * `task-delegated-work` — the task page's "Delegated work" section.
 *
 * @remarks
 * The work handed off from this task, newest first, as the same flat work entries the companion
 * panel's thread renders, capped at their 640px measure and left-aligned in the task's column. It
 * sits directly above Activity rather than inside it: Activity is a server-paginated, filterable
 * history read oldest-first, and a live entry with Approve and Reject would land out of order
 * whenever a page of that history was still unloaded.
 *
 * When the companion panel is open, its thread already holds this task's work (it holds whatever
 * was started from the page it sits beside), so the section shrinks each entry to one line — the
 * objective, its state, and `Open`, which scrolls to and focuses the panel's copy. One live copy of
 * a piece of work per document.
 */
import { Button } from '@docket/ui/primitives';
import type { JSX } from 'react';

import { AthenaJobCard } from '@/components/athena/athena-job-card';
import { useRailShowsConversation } from '@/components/athena/athena-panel-provider';
import { jobsFromQueue, jobStatusLine } from '@/lib/athena/job-presentation';
import type { PersonalAthenaSessionSummary } from '@/lib/athena/presentation';
import { personalAthenaQueueDef, type PersonalAthenaQueuePayload } from '@/lib/athena/query-defs';
import { useLiveApiQuery } from '@/lib/query';

import { TaskSection } from './task-section';

/** How often the task page re-reads the workspace's queue for work delegated from this task. */
const QUEUE_INTERVAL_MS = 10_000;

/** Props for {@link TaskDelegatedWork}. */
export interface TaskDelegatedWorkProps {
  /** The workspace the task lives in; the queue read is scoped to it. */
  readonly orgId: string;
  /** The task whose delegated work to show. */
  readonly taskId: string;
}

/** This task's delegated work, newest first. */
export function jobsForTask(
  payload: PersonalAthenaQueuePayload,
  taskId: string,
): readonly PersonalAthenaSessionSummary[] {
  const matching = jobsFromQueue(payload).filter(
    (job) => job.context?.source?.type === 'task' && job.context.source.id === taskId,
  );
  return [...matching].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Scroll the companion panel's copy of one job into view and move focus to it.
 *
 * @returns whether the panel's copy was found.
 */
export function focusRailEntry(jobId: string): boolean {
  const entry = document.querySelector<HTMLElement>(
    `[data-slot="athena-thread"] [data-athena-job="${jobId}"]`,
  );
  entry?.scrollIntoView({ block: 'center' });
  entry?.focus({ preventScroll: true });
  return entry !== null;
}

/** Props for {@link DelegatedWorkLine}. */
interface DelegatedWorkLineProps {
  readonly job: PersonalAthenaSessionSummary;
}

/** One piece of work as a single line, while the panel beside the page holds its live entry. */
function DelegatedWorkLine({ job }: DelegatedWorkLineProps): JSX.Element {
  return (
    <li data-delegated-job={job.id} className="flex max-w-160 min-w-0 items-center gap-2">
      <span className="text-on-surface text-body-medium min-w-0 truncate">{job.objective}</span>
      <span className="text-on-surface-variant text-body-small min-w-0 shrink truncate">
        {jobStatusLine(null, job)}
      </span>
      <Button
        type="button"
        variant="ghost"
        controlSize="md"
        className="ml-auto shrink-0"
        aria-label={`Open ${job.objective}`}
        onClick={() => {
          focusRailEntry(job.id);
        }}
      >
        Open
      </Button>
    </li>
  );
}

/** The task's delegated work; renders nothing when there is none. */
export function TaskDelegatedWork({ orgId, taskId }: TaskDelegatedWorkProps): JSX.Element | null {
  const queue = useLiveApiQuery(personalAthenaQueueDef(undefined, true, orgId), QUEUE_INTERVAL_MS);
  const railShowsWork = useRailShowsConversation();
  const jobs = queue.data ? jobsForTask(queue.data, taskId) : [];
  if (jobs.length === 0) return null;

  return (
    <TaskSection id="delegated-work" title="Delegated work" gap={4}>
      {railShowsWork ? (
        <ul className="flex flex-col gap-1">
          {jobs.map((job) => (
            <DelegatedWorkLine key={job.id} job={job} />
          ))}
        </ul>
      ) : (
        <div className="flex flex-col gap-8">
          {jobs.map((job) => (
            <AthenaJobCard key={job.id} job={job} />
          ))}
        </div>
      )}
    </TaskSection>
  );
}
