import { Calendar, CheckCircle2, Pause, Play, Stop, X } from '@docket/ui/icons';
import { EmptyState } from '@docket/ui/components';
import { Badge, Button, Surface } from '@docket/ui/primitives';
import Link from '@/components/docket-link';
import { type JSX } from 'react';
import { DatePicker } from '@/components/date-picker';
import { RepeatTaskControl } from './repeat-task-control';
import { OccurrenceRows } from './series-occurrence-rows';
import { formatDate, triggerSummary } from './series-management-values';
import type { SeriesManagementState } from './use-series-management';

/** Properties for a loaded management region. */
interface RegionProps {
  readonly state: SeriesManagementState;
  readonly locked?: boolean | undefined;
}

/** Stable identity and lifecycle actions above the workspace's single scrolling region. */
export function SeriesManagementHeader({
  state,
  overlay,
  onClose,
  locked,
}: RegionProps & {
  readonly overlay: boolean;
  readonly onClose?: (() => void) | undefined;
}): JSX.Element | null {
  const { detail, orgId, groups } = state;
  if (!detail) return null;
  const next = groups.upcoming[0];
  return (
    <header className="flex shrink-0 flex-col gap-4 px-4 py-4 @2xl:px-6">
      {!overlay ? (
        <Link
          href={`/orgs/${orgId}/projects`}
          className="text-body-small text-on-surface-variant hover:text-on-surface flex min-h-10 w-fit items-center"
        >
          Repeating work
        </Link>
      ) : null}
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
          <SeriesLifecycleActions state={state} locked={locked} />
          {onClose ? (
            <Button
              variant="ghost"
              iconOnly
              controlSize="md"
              onClick={onClose}
              aria-label="Close repeating work"
              disabled={state.busy}
            >
              <X className="size-5" />
            </Button>
          ) : null}
        </div>
      </div>
    </header>
  );
}

/** Future schedule fields shared by both management entry points. */
export function SeriesManagementSchedule({ state, locked }: RegionProps): JSX.Element | null {
  const { detail, draft, setDraft, today, effectiveFrom, setEffectiveFrom, earliestEffectiveFrom } =
    state;
  if (!detail) return null;
  const timezone =
    detail.trigger.kind === 'calendar'
      ? detail.trigger.schedule.timezone
      : Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  return (
    <Surface
      as="aside"
      tone="card"
      pad="roomy"
      className="flex h-fit flex-col gap-4 @2xl:col-start-2 @2xl:row-start-1 [&_button]:min-h-10 [&_input]:min-h-10"
    >
      <div>
        <h2 className="text-title-small text-on-surface">Schedule</h2>
        <p className="text-body-small text-on-surface-variant">
          Changes apply from the selected date forward. Existing history stays unchanged.
        </p>
      </div>
      {draft ? (
        <>
          <RepeatTaskControl
            workNoun="work"
            value={draft}
            onChange={setDraft}
            today={today}
            timezone={timezone}
            disabled={(locked ?? false) || state.busy || detail.status === 'ended'}
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
              triggerVariant="secondary"
              triggerClassName="min-h-10 w-full justify-between"
              disabled={(locked ?? false) || state.busy || detail.status === 'ended'}
            />
          </div>
        </>
      ) : (
        <p className="text-body-small text-on-surface-variant">
          This series is started by an event or explicit action rather than a calendar rule.
        </p>
      )}
    </Surface>
  );
}

/** Missed occurrences keep their explicit resolution choices. */
export function SeriesManagementAttention({ state }: RegionProps): JSX.Element | null {
  const { orgId, groups, edit } = state;
  if (!groups.needsAttention.length) return null;
  return (
    <Surface as="section" tone="card" pad="roomy" aria-labelledby="attention-heading">
      <h2 id="attention-heading" className="text-title-small text-on-surface">
        Needs a decision
      </h2>
      <p className="text-body-small text-on-surface mt-1">
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
    </Surface>
  );
}

/** Upcoming ordinary work remains reachable from the management workspace. */
export function SeriesManagementUpcoming({ state }: RegionProps): JSX.Element {
  const { orgId, groups, edit } = state;
  return (
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
        <div className="min-w-0">
          <OccurrenceRows
            orgId={orgId}
            items={groups.upcoming}
            onResolve={(scheduledFor, resolution) => {
              edit.mutate({ scope: 'occurrence', scheduledFor, resolution });
            }}
          />
        </div>
      ) : (
        <p className="text-body-small text-on-surface-variant rounded-xl p-5">
          No future occurrences are currently scheduled.
        </p>
      )}
    </section>
  );
}

/** Past occurrence outcomes remain visible beside future edits. */
export function SeriesManagementHistory({ state }: RegionProps): JSX.Element {
  const { orgId, groups } = state;
  return (
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
        <EmptyState
          icon={CheckCircle2}
          title="No occurrence history yet"
          body="Occurrences move here once their scheduled date has passed."
        />
      )}
    </section>
  );
}

/** Immutable schedule revisions explain when each rule took effect. */
export function SeriesManagementRevisions({ state }: RegionProps): JSX.Element | null {
  const { detail } = state;
  if (!detail) return null;
  return (
    <section className="flex flex-col gap-3" aria-labelledby="schedule-history-heading">
      <div className="flex items-center justify-between gap-3">
        <h2 id="schedule-history-heading" className="text-title-medium text-on-surface">
          Schedule history
        </h2>
        <span className="text-label-medium text-on-surface-variant tabular-nums">
          {detail.revisions.length} version{detail.revisions.length === 1 ? '' : 's'}
        </span>
      </div>
      <ol className="flex flex-col gap-1 overflow-hidden rounded-xl">
        {[...detail.revisions].reverse().map((revision, index) => (
          <Surface
            as="li"
            tone="card"
            key={revision.id}
            className="flex flex-wrap items-start justify-between gap-3 px-4 py-3"
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
          </Surface>
        ))}
      </ol>
    </section>
  );
}

function SeriesLifecycleActions({ state, locked }: RegionProps): JSX.Element | null {
  const { detail, lifecycle } = state;
  if (!detail) return null;
  return (
    <>
      {' '}
      {detail.status === 'active' ? (
        <Button
          variant="secondary"
          onClick={() => {
            lifecycle.mutate({ action: 'pause' });
          }}
          disabled={(locked ?? false) || state.busy}
        >
          <Pause className="size-4" /> Pause
        </Button>
      ) : detail.status === 'paused' ? (
        <Button
          variant="secondary"
          onClick={() => {
            lifecycle.mutate({ action: 'resume' });
          }}
          disabled={(locked ?? false) || state.busy}
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
          disabled={(locked ?? false) || state.busy}
        >
          <Stop className="size-4" /> End
        </Button>
      ) : null}
    </>
  );
}
