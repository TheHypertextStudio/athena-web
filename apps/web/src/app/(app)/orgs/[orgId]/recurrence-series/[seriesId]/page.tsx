'use client';

/** Management surface for one repeating task or project series. */
import type {
  ProcessTrigger,
  OccurrenceResolution,
  RecurrenceSeriesDetailOut,
  RecurrenceSeriesLifecycle,
  RecurrenceSeriesOut,
  SeriesEdit,
} from '@docket/types';
import { Calendar, CheckCircle2, Pause, Play, RefreshCw, Stop } from '@docket/ui/icons';
import { Badge, Button, Skeleton } from '@docket/ui/primitives';
import Link from 'next/link';
import { useAppParams } from '@/lib/app-location';
import { type JSX, useEffect, useMemo, useState } from 'react';

import { DatePicker } from '@/components/date-picker';
import {
  RepeatTaskControl,
  taskRepeatSummary,
  type TaskRepeatDraft,
} from '@/components/recurrence/repeat-task-control';
import { api } from '@/lib/api';
import { apiQueryOptions, queryKeys, unwrap, useApiMutation, useApiQuery } from '@/lib/query';
import { userErrorMessage } from '@/lib/problem';

/** Convert a persisted trigger to the editor's task-shaped discriminated value. */
function repeatDraft(trigger: ProcessTrigger): TaskRepeatDraft | null {
  if (trigger.kind === 'calendar') {
    return {
      kind: 'calendar',
      schedule: trigger.schedule,
      missedPolicy: trigger.missedPolicy,
      materialization: trigger.materialization,
    };
  }
  if (trigger.kind === 'after_completion') {
    return {
      kind: 'after_completion',
      schedule: { kind: 'after_completion', interval: trigger.interval, unit: trigger.unit },
    };
  }
  return null;
}

/** Convert the editor value back to the general persisted process trigger. */
function processTrigger(value: TaskRepeatDraft): ProcessTrigger | null {
  if (value.kind === 'calendar') {
    return {
      kind: 'calendar',
      schedule: value.schedule,
      missedPolicy: value.missedPolicy,
      materialization: value.materialization,
    };
  }
  if (value.kind === 'after_completion') {
    return {
      kind: 'after_completion',
      interval: value.schedule.interval,
      unit: value.schedule.unit,
    };
  }
  return null;
}

/** Readable trigger copy for schedules not edited by the compact recurrence control. */
function triggerSummary(trigger: ProcessTrigger): string {
  const editable = repeatDraft(trigger);
  if (editable) return taskRepeatSummary(editable);
  if (trigger.kind === 'manual') return 'Started when you choose';
  return 'Started by a matching event';
}

/** Short, stable civil-date presentation. */
function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T12:00:00.000Z`));
}

/** Return the earliest valid boundary for the next immutable schedule revision. */
function nextRevisionBoundary(
  today: string,
  revisions: RecurrenceSeriesDetailOut['revisions'],
): string {
  const latest = revisions.reduce<string | null>(
    (result, revision) =>
      result === null || revision.effectiveFrom > result ? revision.effectiveFrom : result,
    null,
  );
  if (latest === null || latest < today) return today;
  const date = new Date(`${latest}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/** Status label used by occurrence rows. */
function occurrenceLabel(
  status: RecurrenceSeriesDetailOut['occurrences'][number]['status'],
): string {
  return status === 'needs_resolution'
    ? 'Needs a decision'
    : status === 'materialized'
      ? 'Scheduled'
      : status === 'superseded'
        ? 'Replaced'
        : status.replace('_', ' ');
}

/** RecurrenceSeriesPage renders the authenticated series-management page. */
export default function RecurrenceSeriesPage(): JSX.Element {
  const { orgId, seriesId } = useAppParams<{ orgId: string; seriesId: string }>();
  const key = queryKeys.recurrenceSeriesDetail(orgId, seriesId);
  const detailQ = useApiQuery(
    apiQueryOptions(
      key,
      () =>
        api.v1.orgs[':orgId']['recurrence-series'][':id'].$get({
          param: { orgId, id: seriesId },
        }),
      'Could not load this repeating work.',
    ),
  );
  const detail = detailQ.data ?? null;
  const today = new Date().toISOString().slice(0, 10);
  const [draft, setDraft] = useState<TaskRepeatDraft | null>(null);
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const earliestEffectiveFrom = useMemo(
    () => nextRevisionBoundary(today, detail?.revisions ?? []),
    [detail?.revisions, today],
  );

  useEffect(() => {
    if (detail) {
      setDraft(repeatDraft(detail.trigger));
      setEffectiveFrom(earliestEffectiveFrom);
    }
  }, [detail, earliestEffectiveFrom]);

  const lifecycle = useApiMutation<RecurrenceSeriesOut, RecurrenceSeriesLifecycle>({
    mutationFn: (json) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId']['recurrence-series'][':id'].lifecycle.$post({
            param: { orgId, id: seriesId },
            json,
          }),
        'Could not change this repeating work.',
      ),
    invalidateKeys: [key, queryKeys.recurrenceSeries(orgId)],
  });
  const edit = useApiMutation<RecurrenceSeriesDetailOut, SeriesEdit>({
    mutationFn: (json) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId']['recurrence-series'][':id'].edits.$post({
            param: { orgId, id: seriesId },
            json,
          }),
        'Could not update future occurrences.',
      ),
    invalidateKeys: [key, queryKeys.recurrenceSeries(orgId)],
  });

  const groups = useMemo(() => {
    const occurrences = detail?.occurrences ?? [];
    return {
      needsAttention: occurrences.filter((value) => value.status === 'needs_resolution'),
      upcoming: occurrences.filter(
        (value) =>
          value.scheduledFor >= today && ['expected', 'materialized'].includes(value.status),
      ),
      history: occurrences.filter(
        (value) =>
          value.scheduledFor < today ||
          !['expected', 'materialized', 'needs_resolution'].includes(value.status),
      ),
    };
  }, [detail, today]);

  if (detailQ.isPending) {
    return (
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-6">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </main>
    );
  }
  if (detailQ.isError || !detail) {
    return (
      <p role="alert" className="text-error mx-auto max-w-5xl p-6">
        {userErrorMessage(detailQ.error, 'Could not load this repeating work.')}
      </p>
    );
  }

  const timezone =
    detail.trigger.kind === 'calendar'
      ? detail.trigger.schedule.timezone
      : Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const next = groups.upcoming[0];

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 @2xl:p-6 @4xl:p-8">
      <header className="flex flex-col gap-4">
        <Link
          href={`/orgs/${orgId}/projects`}
          className="text-body-small text-on-surface-variant hover:text-on-surface flex min-h-10 w-fit items-center"
        >
          Repeating work
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-title-large text-on-surface truncate">{detail.name}</h1>
              <Badge variant={detail.status === 'active' ? 'secondary' : 'outline'}>
                {detail.status}
              </Badge>
            </div>
            <p className="text-body-medium text-on-surface-variant mt-1">
              {triggerSummary(detail.trigger)}
              {next ? ` · Next ${formatDate(next.scheduledFor)}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2 [&_button]:min-h-10">
            {detail.status === 'active' ? (
              <Button
                variant="outline"
                onClick={() => {
                  lifecycle.mutate({ action: 'pause' });
                }}
                disabled={lifecycle.isPending}
              >
                <Pause className="size-4" /> Pause
              </Button>
            ) : detail.status === 'paused' ? (
              <Button
                variant="outline"
                onClick={() => {
                  lifecycle.mutate({ action: 'resume' });
                }}
                disabled={lifecycle.isPending}
              >
                <Play className="size-4" /> Resume
              </Button>
            ) : null}
            {detail.status !== 'ended' ? (
              <Button
                variant="ghost"
                onClick={() => {
                  lifecycle.mutate({ action: 'end' });
                }}
                disabled={lifecycle.isPending}
              >
                <Stop className="size-4" /> End
              </Button>
            ) : null}
          </div>
        </div>
      </header>

      {groups.needsAttention.length > 0 ? (
        <section
          className="border-tertiary bg-tertiary-container rounded-xl border p-4"
          aria-labelledby="attention-heading"
        >
          <h2 id="attention-heading" className="text-title-small text-on-tertiary-container">
            Needs a decision
          </h2>
          <p className="text-body-small text-on-tertiary-container mt-1">
            These dates passed without a recorded outcome. Choose whether each happened, moved, or
            should be skipped.
          </p>
          <OccurrenceRows
            orgId={orgId}
            items={groups.needsAttention}
            onResolve={(scheduledFor, resolution) => {
              edit.mutate({ scope: 'occurrence', scheduledFor, resolution });
            }}
          />
        </section>
      ) : null}

      <div className="grid gap-6 @2xl:grid-cols-[minmax(0,1fr)_20rem]">
        <aside className="bg-surface-container-low flex h-fit flex-col gap-4 rounded-xl p-4 @2xl:sticky @2xl:top-4 @2xl:col-start-2 @2xl:row-start-1 [&_button]:min-h-10 [&_input]:min-h-10">
          <div>
            <h2 className="text-title-small text-on-surface">Schedule</h2>
            <p className="text-body-small text-on-surface-variant">
              Changes apply from the selected date forward. Existing history stays unchanged.
            </p>
          </div>
          {draft ? (
            <>
              <RepeatTaskControl
                value={draft}
                onChange={setDraft}
                today={today}
                timezone={timezone}
                disabled={edit.isPending || detail.status === 'ended'}
              />
              <div className="flex flex-col gap-1.5">
                <span className="text-label-medium text-on-surface">Apply from</span>
                <DatePicker
                  value={effectiveFrom}
                  onChange={(next) => {
                    if (next) setEffectiveFrom(next);
                  }}
                  placeholder="Choose an effective date"
                  ariaLabel="Apply from"
                  min={earliestEffectiveFrom}
                  triggerVariant="outline"
                  triggerClassName="min-h-10 w-full justify-between"
                  disabled={edit.isPending || detail.status === 'ended'}
                />
              </div>
              <Button
                onClick={() => {
                  const trigger = processTrigger(draft);
                  if (trigger) edit.mutate({ scope: 'future', effectiveFrom, trigger });
                }}
                disabled={draft.kind === 'none' || edit.isPending || detail.status === 'ended'}
              >
                <RefreshCw className="size-4" /> Save future schedule
              </Button>
            </>
          ) : (
            <p className="text-body-small text-on-surface-variant">
              This series is started by an event or explicit action rather than a calendar rule.
            </p>
          )}
          {lifecycle.isError || edit.isError ? (
            <p role="alert" className="text-error text-body-small">
              We couldn&apos;t save that change. Please try again.
            </p>
          ) : null}
        </aside>

        <section
          className="flex min-w-0 flex-col gap-3 @2xl:col-start-1 @2xl:row-start-1"
          aria-labelledby="upcoming-heading"
        >
          <div className="flex items-center gap-2">
            <Calendar className="text-on-surface-variant size-5" />
            <h2 id="upcoming-heading" className="text-title-medium text-on-surface">
              Upcoming
            </h2>
          </div>
          {groups.upcoming.length > 0 ? (
            <div className="rounded-xl @2xl:max-h-[min(40rem,calc(100dvh-15rem))] @2xl:overflow-y-auto">
              <OccurrenceRows
                orgId={orgId}
                items={groups.upcoming}
                onResolve={(scheduledFor, resolution) => {
                  edit.mutate({ scope: 'occurrence', scheduledFor, resolution });
                }}
              />
            </div>
          ) : (
            <p className="border-outline-variant text-body-small text-on-surface-variant rounded-xl border border-dashed p-5">
              No future occurrences are currently scheduled.
            </p>
          )}
        </section>
      </div>

      <section className="flex flex-col gap-3" aria-labelledby="history-heading">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="text-on-surface-variant size-5" />
          <h2 id="history-heading" className="text-title-medium text-on-surface">
            History
          </h2>
        </div>
        {groups.history.length > 0 ? (
          <OccurrenceRows orgId={orgId} items={groups.history} />
        ) : (
          <p className="text-body-small text-on-surface-variant">No occurrence history yet.</p>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="schedule-history-heading">
        <div className="flex items-center justify-between gap-3">
          <h2 id="schedule-history-heading" className="text-title-medium text-on-surface">
            Schedule history
          </h2>
          <span className="text-label-medium text-on-surface-variant tabular-nums">
            {detail.revisions.length} version{detail.revisions.length === 1 ? '' : 's'}
          </span>
        </div>
        <ol className="border-outline-variant divide-outline-variant divide-y overflow-hidden rounded-xl border">
          {[...detail.revisions].reverse().map((revision, index) => (
            <li
              key={revision.id}
              className="bg-surface-container-low flex flex-wrap items-start justify-between gap-3 px-4 py-3"
            >
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-body-medium text-on-surface">Version {revision.number}</p>
                  {index === 0 ? <Badge variant="outline">Current</Badge> : null}
                </div>
                <p className="text-body-small text-on-surface-variant">
                  From {formatDate(revision.effectiveFrom)}
                </p>
              </div>
              <p className="text-body-small text-on-surface-variant max-w-md text-right">
                {triggerSummary(revision.trigger)}
              </p>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}

/** Props for one occurrence list. */
interface OccurrenceRowsProps {
  readonly orgId: string;
  readonly items: RecurrenceSeriesDetailOut['occurrences'];
  readonly onResolve?: (scheduledFor: string, resolution: OccurrenceResolution) => void;
}

/** Calm rows linking generated ordinary tasks back into the rest of Docket. */
function OccurrenceRows({ orgId, items, onResolve }: OccurrenceRowsProps): JSX.Element {
  return (
    <ul className="border-outline-variant divide-outline-variant divide-y overflow-hidden rounded-xl border">
      {items.map((item) => (
        <OccurrenceRow key={item.id} orgId={orgId} item={item} onResolve={onResolve} />
      ))}
    </ul>
  );
}

/** Props for one occurrence row and its optional missed-work actions. */
interface OccurrenceRowProps {
  readonly orgId: string;
  readonly item: RecurrenceSeriesDetailOut['occurrences'][number];
  readonly onResolve?:
    | ((scheduledFor: string, resolution: OccurrenceResolution) => void)
    | undefined;
}

/** One durable occurrence, including explicit actions only when it needs a decision. */
function OccurrenceRow({ orgId, item, onResolve }: OccurrenceRowProps): JSX.Element {
  const [changing, setChanging] = useState(false);
  const [moving, setMoving] = useState(false);
  const [replacementDate, setReplacementDate] = useState(item.scheduledFor);
  const needsResolution = item.status === 'needs_resolution' && onResolve !== undefined;
  const canChangeUpcoming =
    onResolve !== undefined && ['expected', 'materialized'].includes(item.status);
  return (
    <li className="bg-surface-container-low flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div>
        <p className="text-body-medium text-on-surface">{formatDate(item.scheduledFor)}</p>
        <p className="text-body-small text-on-surface-variant capitalize">
          {occurrenceLabel(item.status)}
          {item.originalScheduledFor
            ? ` · moved from ${formatDate(item.originalScheduledFor)}`
            : ''}
        </p>
      </div>
      {(needsResolution || canChangeUpcoming) && moving ? (
        <div className="flex flex-wrap items-center justify-end gap-1.5 [&_button]:min-h-10 [&_input]:min-h-10">
          <DatePicker
            value={replacementDate}
            onChange={(next) => {
              if (next) setReplacementDate(next);
            }}
            placeholder="Choose a new date"
            ariaLabel={`New date for ${item.scheduledFor}`}
            triggerVariant="outline"
            triggerClassName="min-h-10 w-40"
          />
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setMoving(false);
            }}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => {
              onResolve(item.scheduledFor, {
                kind: 'reschedule',
                scheduledFor: replacementDate,
              });
              setMoving(false);
              setChanging(false);
            }}
          >
            Save date
          </Button>
        </div>
      ) : needsResolution ? (
        <div className="flex flex-wrap items-center justify-end gap-1.5 [&_button]:min-h-10">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              onResolve(item.scheduledFor, { kind: 'skip' });
            }}
          >
            Skip
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setMoving(true);
            }}
          >
            Move
          </Button>
          <Button
            size="sm"
            onClick={() => {
              onResolve(item.scheduledFor, { kind: 'complete' });
            }}
          >
            Mark complete
          </Button>
        </div>
      ) : canChangeUpcoming && changing ? (
        <div className="flex flex-wrap items-center justify-end gap-1.5 [&_button]:min-h-10">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setChanging(false);
            }}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              onResolve(item.scheduledFor, { kind: 'skip' });
              setChanging(false);
            }}
          >
            Skip this occurrence
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setMoving(true);
            }}
          >
            Move this occurrence
          </Button>
        </div>
      ) : canChangeUpcoming ? (
        <div className="flex flex-wrap items-center justify-end gap-1.5 [&_button]:min-h-10">
          {item.taskId ? (
            <Button asChild variant="ghost" size="sm">
              <Link href={`/orgs/${orgId}/tasks/${item.taskId}`}>Open task</Link>
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Change ${formatDate(item.scheduledFor)}`}
            onClick={() => {
              setChanging(true);
            }}
          >
            Change
          </Button>
        </div>
      ) : item.taskId ? (
        <Button asChild variant="ghost" size="sm" className="min-h-10">
          <Link href={`/orgs/${orgId}/tasks/${item.taskId}`}>Open task</Link>
        </Button>
      ) : null}
    </li>
  );
}
