'use client';
import type { JSX } from 'react';
import type {
  WorkScheduleFailureCode,
  WorkScheduleOut,
  WorkScheduleRunOut,
} from '@docket/work/work-schedule-management';
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Surface,
} from '@docket/ui/primitives';
import { InlineBanner } from '@docket/ui/components';
import { useState } from 'react';
import Link from '@/components/docket-link';
import { useApiQuery, useInfiniteApiQuery } from '@/lib/query';
import { userErrorMessage } from '@/lib/problem';
import { workTemplateIdentityDef } from '@/components/templates/work-template-identity-queries';
import { workScheduleRunsDef, useWorkScheduleWrites } from './work-schedule-queries';
import { scheduleDateLabel } from './schedule-presentations';

const FAILURE_COPY: Record<WorkScheduleFailureCode, string> = {
  template_unavailable:
    'The selected template or one of its included templates is unavailable. Review the template selection, then retry.',
  permission_changed:
    'Access changed for the schedule owner or its work. Restore the required access, then retry.',
  destination_unavailable:
    'A destination or responsibility choice is no longer available. Review future work and restore the required destination before retrying.',
  invalid_work:
    'Some scheduled work no longer passes validation. Review its starting details and included work before retrying.',
  work_limit:
    'This run includes more work than the creation limit. Reduce its optional work before trying a new run.',
  creation_failed: 'The work could not be created. Your run is kept; retry when you are ready.',
};
const STATUS_COPY: Record<WorkScheduleRunOut['status'], string> = {
  expected: 'Scheduled',
  materialized: 'Created',
  completed: 'Completed',
  skipped: 'Skipped',
  canceled: 'Canceled',
  needs_resolution: 'Needs a decision',
  superseded: 'Replaced',
  failed: 'Failed',
};

/** Bounded history with reviewed missed-work creation and idempotent failed-run retries. */
export function ScheduleHistory({
  orgId,
  schedule,
  open,
  onOpenChange,
}: {
  readonly orgId: string;
  readonly schedule: WorkScheduleOut;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}): JSX.Element {
  const history = useInfiniteApiQuery(workScheduleRunsDef(orgId, schedule.id));
  const writes = useWorkScheduleWrites(orgId);
  const [failure, setFailure] = useState<string | null>(null);
  const retry = async (occurrenceId: string): Promise<void> => {
    setFailure(null);
    try {
      await writes.retry.mutateAsync({ id: schedule.id, occurrenceId });
    } catch (error) {
      setFailure(userErrorMessage(error, 'Could not create work for this run. Try again.'));
    }
  };
  const runs = history.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        presentation={{ kind: 'responsive-fullscreen', size: 'large', height: 'content' }}
      >
        <DialogHeader inset="responsive">
          <DialogTitle>{schedule.name}</DialogTitle>
          <DialogDescription>
            Review missed dates and see the work created by this schedule.
          </DialogDescription>
        </DialogHeader>
        <DialogBody inset="responsive" className="flex flex-col gap-4">
          {failure ? (
            <InlineBanner tone="critical" title="Work was not created">
              {failure}
            </InlineBanner>
          ) : null}
          {history.isPending ? <p role="status">Loading run history…</p> : null}
          {history.isError ? (
            <InlineBanner tone="critical" title="Could not load all run history">
              <Button variant="ghost" onClick={() => void history.refetch()}>
                Try again
              </Button>
            </InlineBanner>
          ) : null}
          {!history.isPending && !history.isError && runs.length === 0 ? (
            <Surface tone="card" shape="large" className="p-6">
              <h2 className="text-title-large">Its first run is still ahead</h2>
              <p className="text-body-large text-on-surface-variant mt-2">
                Created work, completion and any problems will appear here.
              </p>
            </Surface>
          ) : null}
          <ScheduleRunList
            orgId={orgId}
            runs={runs}
            canEdit={schedule.canEdit}
            pending={writes.retry.isPending}
            onRetry={(id) => void retry(id)}
          />
          {history.hasNextPage ? (
            <Button
              variant="secondary"
              disabled={history.isFetchingNextPage}
              onClick={() => void history.fetchNextPage()}
            >
              {history.isFetchingNextPage ? 'Loading…' : 'Earlier runs'}
            </Button>
          ) : null}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
function RunContent({
  orgId,
  run,
}: {
  readonly orgId: string;
  readonly run: WorkScheduleRunOut;
}): JSX.Element {
  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-title-large">{scheduleDateLabel(run.scheduledFor)}</h2>
        <p
          className={`text-label-large ${run.status === 'failed' ? 'text-error' : 'text-on-surface-variant'}`}
        >
          {STATUS_COPY[run.status]}
        </p>
      </div>
      {run.status === 'needs_resolution' ? (
        <p className="text-body-small text-on-surface-variant">
          This date was missed. Create the work using its scheduled dates.
        </p>
      ) : null}
      {run.originalScheduledFor && run.originalScheduledFor !== run.scheduledFor ? (
        <p className="text-body-small text-on-surface-variant">
          Moved from {scheduleDateLabel(run.originalScheduledFor)}
        </p>
      ) : null}
      {run.attempt > 0 ? (
        <p className="text-body-small text-on-surface-variant">
          {run.attempt} {run.attempt === 1 ? 'attempt' : 'attempts'}
          {run.retryAvailableAt
            ? ` · Retry available ${new Date(run.retryAvailableAt).toLocaleString()}`
            : ''}
        </p>
      ) : null}
      {run.roots.length ? (
        <div className="flex flex-wrap gap-3">
          {run.roots.map((root) => (
            <Link
              key={`${root.kind}:${root.id}`}
              className="text-primary underline underline-offset-4"
              href={`/orgs/${orgId}/${root.kind === 'project' ? 'projects' : 'tasks'}/${root.id}`}
            >
              Open created {root.kind}
            </Link>
          ))}
        </div>
      ) : null}
      {run.templates.length ? (
        <div className="flex min-w-0 flex-col gap-1" aria-label="Versions used">
          {run.templates.map((template) => (
            <RunVersion
              key={template.workTypeVersionId}
              orgId={orgId}
              id={template.workTypeId}
              versionId={template.workTypeVersionId}
            />
          ))}
        </div>
      ) : null}
    </>
  );
}
function RunVersion({
  orgId,
  id,
  versionId,
}: {
  readonly orgId: string;
  readonly id: string;
  readonly versionId: string;
}): JSX.Element {
  const identity = useApiQuery(workTemplateIdentityDef(orgId, id, versionId));
  return (
    <p className="text-body-small text-on-surface-variant break-words">
      {identity.data
        ? `${identity.data.name} · Version ${identity.data.versionNumber}${identity.data.archived ? ' · Archived' : ''}`
        : identity.isError
          ? 'Saved version unavailable'
          : 'Loading saved version…'}
    </p>
  );
}

function ScheduleRunList({
  orgId,
  runs,
  canEdit,
  pending,
  onRetry,
}: {
  readonly orgId: string;
  readonly runs: readonly WorkScheduleRunOut[];
  readonly canEdit: boolean;
  readonly pending: boolean;
  readonly onRetry: (id: string) => void;
}): JSX.Element {
  return (
    <ol className="flex min-w-0 flex-col gap-3">
      {runs.map((run) => (
        <Surface
          as="li"
          key={run.id}
          tone="card"
          shape="large"
          className="flex min-w-0 flex-col gap-3 p-4 sm:p-5"
        >
          <RunContent orgId={orgId} run={run} />
          {run.failureCode ? (
            <InlineBanner tone="critical" title="This run needs attention">
              {FAILURE_COPY[run.failureCode]}
            </InlineBanner>
          ) : null}
          {run.canRetry && canEdit ? (
            <Button
              variant="secondary"
              className="self-start"
              disabled={pending}
              onClick={() => {
                onRetry(run.id);
              }}
            >
              {runActionLabel(run.status, pending)}
            </Button>
          ) : null}
        </Surface>
      ))}
    </ol>
  );
}
function runActionLabel(status: WorkScheduleRunOut['status'], pending: boolean): string {
  if (status === 'needs_resolution') return pending ? 'Creating work…' : 'Create work';
  return pending ? 'Retrying…' : 'Retry this run';
}
