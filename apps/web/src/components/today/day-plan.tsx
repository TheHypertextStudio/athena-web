'use client';

/**
 * `today/day-plan` — every task accepted into today's plan.
 *
 * @remarks
 * The page fetched `plan[]` and rendered exactly two entries from it, through a separate
 * "Now / After this" section, and only while `planState === 'active'`. An unplanned day therefore
 * showed no tasks at all.
 *
 * One list, first entry promoted. The current task renders as {@link FocusCard}, carrying the
 * timer, complete, timebox, and defer actions that apply only to the task being worked on.
 * Everything after it is an ordinary row. Nothing is hidden behind a rule about which two entries
 * qualify.
 *
 * Grouping is by workspace, and only when the plan spans more than one, because a person working
 * across several organizations needs each line attributed to the one it belongs to.
 *
 * **Row actions sit beside the row, not inside it.** Each row is an `<a>`, and a `<button>` nested
 * in an anchor is invalid HTML regardless of how its click is handled. So each entry is a flex
 * container holding the link and its actions as siblings, and the hover reveal is driven from that
 * container rather than from the row.
 *
 * Timebox positions are not drawn here. The shell's agenda rail renders the same day on every
 * route, and two grids of one day on one screen is the duplication that rail was extracted to end.
 */
import type { HubTodayPlanItem } from '../../lib/contracts/hub';
import { EmptyState, EntityList } from '@docket/ui/components';
import { Check, ListChecks } from '@docket/ui/icons';
import {
  Button,
  Card,
  CardContent,
  ControlGroup,
  Row,
  Skeleton,
  Stack,
} from '@docket/ui/primitives';
import {
  type DailyExecutionEvent,
  selectDailyExecution,
} from '@docket/planning/daily-plan-execution';
import type { CalendarEventOut } from '@docket/planning/calendar-contract';
import { addDays, instantAt } from '@docket/planning/zoned-time';
import Link from '@/components/docket-link';
import type { JSX } from 'react';
import { useMemo } from 'react';

import { FocusCard } from './focus-card';
import HubTaskRow from './hub-task-row';
import { TodaySection } from './today-section';
import { useDailyPlanningDay } from '../daily-planning/daily-planning-queries';

/** Props for {@link DayPlan}. */
export interface DayPlanProps {
  /** Every task on today's plan, across workspaces, in accepted order. */
  readonly plan: readonly HubTodayPlanItem[];
  /** The task to promote — the one being worked on now, or null when none is actionable. */
  readonly now?: HubTodayPlanItem | null;
  /** Resolve a workspace's display name. */
  readonly orgName: (orgId: string) => string;
  /** Whether the first Hub read is still in flight. */
  readonly loading: boolean;
  /** Whether no plan has been accepted yet, which is what makes planning the empty-state action. */
  readonly unplanned?: boolean;
  /** Whether a completion is in flight. */
  readonly completing?: boolean;
  readonly onComplete?: ((item: HubTodayPlanItem) => void) | undefined;
  readonly onDefer?: ((item: HubTodayPlanItem) => void) | undefined;
  readonly onPromote?: ((item: HubTodayPlanItem, beforeSort: number) => void) | undefined;
  readonly onTimebox?:
    ((item: HubTodayPlanItem, startsAt: string, endsAt: string) => void) | undefined;
  /** The day being rendered, for the timebox form. */
  readonly date?: string;
  /** The timezone times are read in. */
  readonly displayTimezone?: string;
}

/** One workspace's slice of the day. */
interface PlanGroup {
  readonly orgId: string;
  readonly orgLabel: string;
  readonly tasks: HubTodayPlanItem[];
}

function acceptedPlanningHref(
  day: ReturnType<typeof useDailyPlanningDay>,
  date: string,
): string | undefined {
  return day.data?.accepted ? `/plan?view=day&date=${date}` : undefined;
}

function activeTaskFromEvidence(
  day: ReturnType<typeof useDailyPlanningDay>,
  plan: readonly HubTodayPlanItem[],
): string | null {
  // The Hub read refreshes before the day ledger after a timer starts.
  return (
    plan.find((item) => item.reason === 'Timer running')?.id ??
    day.data?.actual.find((interval) => interval.endedAt === null)?.taskId ??
    null
  );
}

function acceptedCalendarEvent(
  event: CalendarEventOut,
  day: NonNullable<ReturnType<typeof useDailyPlanningDay>['data']>,
): DailyExecutionEvent | null {
  if (event.blocksTime === false) return null;
  if (event.startsAt && event.endsAt)
    return { title: event.title, startsAt: event.startsAt, endsAt: event.endsAt };
  if (
    !event.allDayStartDate ||
    !event.allDayEndDate ||
    event.allDayStartDate > day.date ||
    event.allDayEndDate <= day.date
  )
    return null;
  return {
    title: event.title,
    startsAt: instantAt(day.date, 0, day.timezone).toISOString(),
    endsAt: instantAt(addDays(day.date, 1), 0, day.timezone).toISOString(),
  };
}

function AcceptedEvent({
  day,
  plan,
  displayTimezone,
}: {
  readonly day: ReturnType<typeof useDailyPlanningDay>;
  readonly plan: readonly HubTodayPlanItem[];
  readonly displayTimezone: string;
}): JSX.Element | null {
  const data = day.data;
  const snapshot = data?.accepted?.current.snapshot;
  if (!snapshot) return null;
  const events = data.agenda.entries.flatMap((entry) => {
    if (entry.kind !== 'google_calendar_event') return [];
    const event = acceptedCalendarEvent(entry.event, data);
    return event ? [event] : [];
  });
  const execution = selectDailyExecution({
    sessions: snapshot.sessions,
    taskBudgets: snapshot.tasks,
    now: Date.now(),
    actionableTaskIds: plan
      .filter((item) => item.planStatus === 'planned' && !item.blocked)
      .map((item) => item.id),
    actual: data.actual,
    activeTaskId: activeTaskFromEvidence(day, plan),
    events,
  });
  const event = execution.event;
  if (!event) return null;
  const time = new Intl.DateTimeFormat(undefined, {
    timeZone: displayTimezone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(event.startsAt));
  return (
    <Card role="article" aria-label={`Next event: ${event.title}`}>
      <CardContent className="space-y-1 py-5">
        <p className="text-primary text-label-large">
          {Date.parse(event.startsAt) <= Date.now() ? 'Now' : 'Next'}
        </p>
        <p className="text-on-surface text-title-medium">{event.title}</p>
        <p className="text-on-surface-variant text-body-small">{time}</p>
      </CardContent>
    </Card>
  );
}

function PlanRowActions({
  item,
  now,
  planningHref,
  completing,
  onPromote,
  onComplete,
}: {
  readonly item: HubTodayPlanItem;
  readonly now: HubTodayPlanItem | null;
  readonly planningHref: string | undefined;
  readonly completing: boolean;
  readonly onPromote: DayPlanProps['onPromote'];
  readonly onComplete: DayPlanProps['onComplete'];
}): JSX.Element {
  return (
    // Overlaid, not reserved. At `opacity-0` in the flow these still occupied their full width,
    // which is the gap that opened between every row's metadata and the list's right edge.
    <ControlGroup
      controlSize="sm"
      className="bg-surface-container-high absolute inset-y-1 right-1 rounded-md pl-2 opacity-0 transition-opacity group-focus-within/planrow:opacity-100 group-hover/planrow:opacity-100"
    >
      {/* Promoting is only meaningful relative to a task already ahead of this one. */}
      {planningHref ? (
        <Button asChild type="button" variant="ghost">
          <Link href={`${planningHref}&task=${encodeURIComponent(item.id)}`}>Adjust plan</Link>
        </Button>
      ) : now && onPromote ? (
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            onPromote(item, now.sort);
          }}
        >
          Make next
        </Button>
      ) : null}
      {onComplete ? (
        <Button
          type="button"
          variant="ghost"
          iconOnly
          disabled={completing}
          aria-label={`Mark ${item.title} complete`}
          onClick={() => {
            onComplete(item);
          }}
        >
          <Check aria-hidden="true" />
        </Button>
      ) : null}
    </ControlGroup>
  );
}

/** The accepted plan: the current task promoted, the rest as rows grouped by workspace. */
export default function DayPlan({
  plan,
  now = null,
  orgName,
  loading,
  unplanned = false,
  completing = false,
  onComplete,
  onDefer,
  onPromote,
  onTimebox,
  date = '',
  displayTimezone = 'UTC',
}: DayPlanProps): JSX.Element {
  const day = useDailyPlanningDay(date, Boolean(date));
  const planningHref = acceptedPlanningHref(day, date);
  // The promoted task is not repeated as a row. Everything else keeps its accepted order — the
  // server already sorted `plan`, and re-sorting here would disagree with the order the person
  // accepted.
  // Only skipped when the promoted card is actually rendered. `FocusCard` needs all three action
  // handlers, and every one of them is optional, so skipping unconditionally dropped the task from
  // the page entirely whenever a host supplied fewer.
  const promoted = now && onComplete && onDefer && onTimebox ? now : null;

  const groups = useMemo<PlanGroup[]>(() => {
    const byOrg = new Map<string, PlanGroup>();
    for (const item of plan) {
      if (item.planItemId === promoted?.planItemId) continue;
      const group = byOrg.get(item.organizationId);
      if (group) group.tasks.push(item);
      else
        byOrg.set(item.organizationId, {
          orgId: item.organizationId,
          orgLabel: orgName(item.organizationId),
          tasks: [item],
        });
    }
    return [...byOrg.values()];
  }, [plan, promoted, orgName]);

  // placeholder: the tasks planned for today, across every workspace.
  return (
    <Stack gap={3}>
      <AcceptedEvent day={day} plan={plan} displayTimezone={displayTimezone} />
      <TodaySection
        id="today-work-heading"
        heading="Plan"
        count={plan.length > 0 ? plan.length : undefined}
      >
        {loading ? (
          <Stack gap={1} aria-hidden="true">
            {[0, 1, 2].map((row) => (
              <Skeleton key={row} className="h-9 w-full rounded-lg" />
            ))}
          </Stack>
        ) : plan.length === 0 ? (
          <EmptyState
            icon={ListChecks}
            tone="accent"
            title={unplanned ? 'No plan for today yet' : 'No tasks left on today’s plan'}
            action={
              <Button asChild variant="ghost" controlSize="sm">
                <Link href="/tasks">Browse all tasks</Link>
              </Button>
            }
          />
        ) : (
          <Stack gap={2}>
            {promoted && onComplete && onDefer && onTimebox ? (
              <FocusCard
                item={promoted}
                orgName={orgName}
                completing={completing}
                onComplete={onComplete}
                onDefer={onDefer}
                onTimebox={onTimebox}
                date={date}
                displayTimezone={displayTimezone}
                planningHref={planningHref}
              />
            ) : null}
            {groups.map((group) => (
              <Stack key={group.orgId} gap={1}>
                {/* Only worth a workspace heading when the plan spans more than one. */}
                {groups.length > 1 ? (
                  <h3 className="text-on-surface-variant text-label-large">{group.orgLabel}</h3>
                ) : null}
                <EntityList aria-label={group.orgLabel} tone="tonal">
                  {group.tasks.map((item) => (
                    <Row key={item.planItemId} className="group/planrow relative rounded-lg">
                      <HubTaskRow
                        task={item}
                        orgLabel={group.orgLabel}
                        className="min-w-0 flex-1"
                        displayTimezone={displayTimezone}
                      />
                      <PlanRowActions
                        item={item}
                        now={now}
                        planningHref={planningHref}
                        completing={completing}
                        onPromote={onPromote}
                        onComplete={onComplete}
                      />
                    </Row>
                  ))}
                </EntityList>
              </Stack>
            ))}
          </Stack>
        )}
      </TodaySection>
    </Stack>
  );
}
