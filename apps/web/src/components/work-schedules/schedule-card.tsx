'use client';
import type { JSX } from 'react';
import type { WorkScheduleOut } from '@docket/work/work-schedule-management';
import type { WorkTemplateOut } from '@docket/work/work-template-contract';
import {
  Button,
  Surface,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@docket/ui/primitives';
import { InlineBanner } from '@docket/ui/components';
import { Pause, Play, CalendarToday, Ellipsis } from '@docket/ui/icons';
import { scheduleTriggerSummary } from './schedule-draft';
import { scheduleDateLabel } from './schedule-presentations';
import { ScheduleRetainedIdentity } from './schedule-retained-identity';

interface ScheduleCardProps {
  readonly schedule: WorkScheduleOut;
  readonly orgId: string;
  readonly template: WorkTemplateOut | undefined;
  readonly pending: boolean;
  readonly onEdit: () => void;
  readonly onHistory: () => void;
  readonly onLifecycle: (action: 'pause' | 'resume' | 'end') => void;
  readonly onRun: () => void;
}
/** A schedule is a routine with an upcoming outcome, rather than another configuration row. */
export function ScheduleCard({
  schedule,
  orgId,
  template,
  pending,
  onEdit,
  onHistory,
  onLifecycle,
  onRun,
}: ScheduleCardProps): JSX.Element {
  return (
    <Surface
      as="article"
      tone="card"
      shape="large"
      className="flex min-w-0 flex-col gap-5 p-4 sm:p-6"
      aria-label={schedule.name}
    >
      <div className="grid min-w-0 gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(10rem,auto)]">
        <div className="flex min-w-0 flex-col gap-2">
          <h3 className="text-title-large break-words">{schedule.name}</h3>
          <p className="text-body-large text-on-surface-variant break-words">
            {scheduleTriggerSummary(schedule.revision.trigger)}
          </p>
          <ScheduleTemplateCaption orgId={orgId} schedule={schedule} template={template} />
        </div>
        <Surface
          tone="well"
          shape="medium"
          className="flex min-w-0 flex-col justify-center gap-1 p-4"
        >
          <p className="text-label-medium text-on-surface-variant flex items-center gap-2">
            <CalendarToday className="size-4" aria-hidden="true" />
            {schedule.status === 'active' ? 'Next work' : 'Schedule'}
          </p>
          <p className="text-title-large break-words">
            {nextWorkTitle(schedule) ?? nextRunLabel(schedule)}
          </p>
          {nextWorkTitle(schedule) ? (
            <p className="text-body-large text-on-surface-variant break-words">
              {nextRunLabel(schedule)}
            </p>
          ) : null}
        </Surface>
      </div>
      {schedule.templateArchived ? (
        <p className="text-body-medium text-on-surface-variant">
          Archived template · This schedule continues with its saved versions. History shows the
          version used for each run.
        </p>
      ) : null}
      {(schedule.failedRunCount ?? 0) > 0 ? (
        <ScheduleFailureAttention count={schedule.failedRunCount ?? 0} onReview={onHistory} />
      ) : null}
      <ScheduleActions
        schedule={schedule}
        pending={pending}
        onEdit={onEdit}
        onHistory={onHistory}
        onLifecycle={onLifecycle}
        onRun={onRun}
      />
    </Surface>
  );
}

function ScheduleActions({
  schedule,
  pending,
  onEdit,
  onHistory,
  onLifecycle,
  onRun,
}: Omit<Parameters<typeof ScheduleCard>[0], 'template' | 'orgId'>): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {schedule.canEdit &&
      schedule.revision.document?.kind === 'schedule' &&
      schedule.status !== 'ended' ? (
        <Button
          variant="secondary"
          onClick={onEdit}
          aria-label={`Edit future runs for ${schedule.name}`}
        >
          Edit future runs
        </Button>
      ) : null}
      <Button variant="ghost" onClick={onHistory} aria-label={`Run history for ${schedule.name}`}>
        Run history
      </Button>
      {schedule.canEdit && schedule.status !== 'ended' ? (
        <>
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() => {
              onLifecycle(schedule.status === 'paused' ? 'resume' : 'pause');
            }}
          >
            {schedule.status === 'paused' ? (
              <Play className="size-4" />
            ) : (
              <Pause className="size-4" />
            )}
            {schedule.status === 'paused' ? 'Resume' : 'Pause'}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                iconOnly
                aria-label={`More actions for ${schedule.name}`}
                disabled={pending}
              >
                <Ellipsis className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onRun}>Run for a date</DropdownMenuItem>
              <DropdownMenuItem
                destructive
                onSelect={() => {
                  onLifecycle('end');
                }}
              >
                End schedule
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      ) : null}
    </div>
  );
}
function nextRunLabel(schedule: WorkScheduleOut): string {
  if (schedule.status === 'paused') return 'Paused';
  if (schedule.status === 'ended') return 'Ended';
  if (schedule.nextRunDate) return scheduleDateLabel(schedule.nextRunDate);
  if (schedule.revision.trigger.kind === 'after_completion') return 'After completion';
  if (schedule.revision.trigger.kind === 'manual') return 'When needed';
  return 'Awaiting next run';
}

function ScheduleTemplateCaption({
  orgId,
  schedule,
  template,
}: Pick<ScheduleCardProps, 'orgId' | 'schedule' | 'template'>): JSX.Element {
  const document = schedule.revision.document;
  const native = document?.kind === 'schedule' ? document : null;
  return schedule.templateArchived && schedule.retainedTemplate ? (
    <ScheduleRetainedIdentity orgId={orgId} retained={schedule.retainedTemplate} />
  ) : (
    <p className="text-body-medium text-on-surface-variant break-words">
      {template?.definition.name ?? (native ? 'Saved template' : 'Retained work plan')}
      {native?.template.selection.kind === 'pinned'
        ? ' · Pinned version'
        : native
          ? ' · Latest published version'
          : ''}
    </p>
  );
}

function nextWorkTitle(schedule: WorkScheduleOut): string | null {
  return schedule.nextWorkTitle ?? null;
}

function ScheduleFailureAttention({
  count,
  onReview,
}: {
  readonly count: number;
  readonly onReview: () => void;
}): JSX.Element {
  return (
    <InlineBanner
      tone="warning"
      title={count === 1 ? '1 run needs attention' : `${count} runs need attention`}
    >
      <Button variant="ghost" onClick={onReview}>
        Review failed runs
      </Button>
    </InlineBanner>
  );
}
