'use client';

/**
 * `athena-working-strip` — the panel's pinned list of jobs that are still running or waiting.
 *
 * @remarks
 * Present only while at least one job has not finished (§4.2 point 2 of
 * `docs/superpowers/specs/2026-09-12-athena-companion-design.md`). Each row names the job and its
 * current status line; a row whose job is waiting on the owner also fetches that job's detail —
 * only that row, only for the decision it needs — so an inline Approve/Reject can be answered
 * without leaving the strip. Rows never fetch detail while merely running: the queue summary
 * already carries everything an active row shows.
 */
import { ChevronDown } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import { Button, Collapsible, CollapsibleContent, CollapsibleTrigger } from '@docket/ui/primitives';
import { useQueryClient } from '@tanstack/react-query';
import { type JSX, type ReactNode } from 'react';

import { jobStatusLine, jobTone } from '@/lib/athena/job-presentation';
import type { PersonalAthenaSessionSummary } from '@/lib/athena/presentation';
import {
  personalAthenaDetailDef,
  personalAthenaTransport,
  type PersonalAthenaTransport,
} from '@/lib/athena/query-defs';
import { queryKeys, useApiQuery } from '@/lib/query';

import { useAthenaActions } from './use-athena-actions';

/** Props for {@link AthenaWorkingStrip}. */
export interface AthenaWorkingStripProps {
  /** The full personal queue; the strip filters this down to what is still open. */
  readonly jobs: readonly PersonalAthenaSessionSummary[];
  readonly transport?: PersonalAthenaTransport;
  /** Scroll the thread to this job's card (or open it), invoked with the job's id. */
  readonly onOpen: (jobId: string) => void;
}

/** The two tones a strip row ever renders in — a finished job never appears here. */
type WorkingRowTone = Extract<ReturnType<typeof jobTone>, 'active' | 'attention'>;

/** The tone dot's fill, drawn from the tonal surface system rather than a raw palette class. */
const DOT_CLASS_BY_TONE: Readonly<Record<WorkingRowTone, string>> = {
  active: 'bg-primary',
  attention: 'bg-health-at-risk',
};

/** Props for the shared row shell every strip row renders through. */
interface WorkingStripRowShellProps {
  readonly job: PersonalAthenaSessionSummary;
  readonly tone: WorkingRowTone;
  readonly statusLine: string;
  readonly onOpen: (jobId: string) => void;
  /** An attention row's inline decision, rendered beside (not inside) the row's own button. */
  readonly children?: ReactNode;
}

/**
 * One `<li>`: a button carrying the tone dot, the truncated objective, and the status line, plus
 * whatever the caller renders alongside it (an attention row's decision buttons).
 */
function WorkingStripRowShell({
  job,
  tone,
  statusLine,
  onOpen,
  children,
}: WorkingStripRowShellProps): JSX.Element {
  return (
    <li className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => {
          onOpen(job.id);
        }}
        className="hover:bg-surface-container flex w-full min-w-0 flex-col gap-0.5 rounded-md p-2 text-left"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className={cn('size-2 shrink-0 rounded-full', DOT_CLASS_BY_TONE[tone])}
          />
          <span className="text-on-surface text-body-medium min-w-0 flex-1 truncate">
            {job.objective}
          </span>
        </span>
        <span className="text-on-surface-variant text-body-small truncate pl-4">{statusLine}</span>
      </button>
      {children}
    </li>
  );
}

/** Props for {@link AttentionRow}. */
interface AttentionRowProps {
  readonly job: PersonalAthenaSessionSummary;
  readonly transport: PersonalAthenaTransport;
  readonly onOpen: (jobId: string) => void;
}

/**
 * A row whose job is waiting on the owner: fetches that job's detail so a pending approval can be
 * answered with two buttons right in the strip, without opening the thread.
 */
function AttentionRow({ job, transport, onOpen }: AttentionRowProps): JSX.Element {
  const queryClient = useQueryClient();
  const detail = useApiQuery(personalAthenaDetailDef(job.id, transport, true));
  const actions = useAthenaActions({
    selectedId: job.id,
    transport,
    onSelected: (next) => {
      queryClient.setQueryData(queryKeys.athenaSession(next.id), next);
    },
  });
  const decision = detail.data?.decision ?? null;
  const statusLine = jobStatusLine(detail.data ?? null, job);

  return (
    <WorkingStripRowShell job={job} tone="attention" statusLine={statusLine} onOpen={onOpen}>
      {decision?.kind === 'approval' && decision.options.length > 0 ? (
        <div className="flex flex-wrap gap-2 pl-8">
          {decision.options.map((option, index) => (
            <Button
              key={option.id}
              type="button"
              size="sm"
              variant={index === 0 ? 'default' : 'outline'}
              disabled={actions.pending}
              onClick={() => {
                actions.decide({ id: decision.id, option: option.id, kind: decision.kind });
              }}
            >
              {option.label}
            </Button>
          ))}
        </div>
      ) : null}
    </WorkingStripRowShell>
  );
}

/** A row whose job is simply running: the queue summary already has everything it shows. */
function ActiveRow({
  job,
  onOpen,
}: {
  readonly job: PersonalAthenaSessionSummary;
  readonly onOpen: (jobId: string) => void;
}): JSX.Element {
  return (
    <WorkingStripRowShell
      job={job}
      tone="active"
      statusLine={jobStatusLine(null, job)}
      onOpen={onOpen}
    />
  );
}

/**
 * The panel's Working strip: a collapsible list of jobs still running or waiting, pinned above the
 * thread. Renders nothing once every job has finished.
 */
export function AthenaWorkingStrip({
  jobs,
  transport = personalAthenaTransport,
  onOpen,
}: AthenaWorkingStripProps): JSX.Element | null {
  const open = jobs
    .map((job) => ({ job, tone: jobTone(job.status) }))
    .filter(
      (entry): entry is { job: PersonalAthenaSessionSummary; tone: WorkingRowTone } =>
        entry.tone === 'active' || entry.tone === 'attention',
    );

  if (open.length === 0) return null;

  return (
    <Collapsible defaultOpen>
      <CollapsibleTrigger className="group text-on-surface text-label-large hover:bg-surface-container flex w-full items-center justify-between rounded-md p-2">
        <span>{`Working · ${String(open.length)}`}</span>
        <ChevronDown
          aria-hidden="true"
          className="transition-transform group-data-[state=open]:rotate-180"
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="flex flex-col gap-1 pt-1">
          {open.map(({ job, tone }) =>
            tone === 'attention' ? (
              <AttentionRow key={job.id} job={job} transport={transport} onOpen={onOpen} />
            ) : (
              <ActiveRow key={job.id} job={job} onOpen={onOpen} />
            ),
          )}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}
