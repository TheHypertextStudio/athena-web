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
import type { HubTodayPlanItem } from '@docket/types';
import { EmptyState, EntityList } from '@docket/ui/components';
import { Check, ListChecks } from '@docket/ui/icons';
import { Button, ControlGroup, Row, Skeleton, Stack } from '@docket/ui/primitives';
import Link from '@/components/docket-link';
import type { JSX } from 'react';
import { useMemo } from 'react';

import { FocusCard } from './focus-card';
import HubTaskRow from './hub-task-row';
import { TodaySection } from './today-section';

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
  /** Ask Athena to build a plan. Rendered as the empty state's primary action. */
  readonly onPlan?: (() => void) | undefined;
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

/** The accepted plan: the current task promoted, the rest as rows grouped by workspace. */
export default function DayPlan({
  plan,
  now = null,
  orgName,
  loading,
  unplanned = false,
  onPlan,
  completing = false,
  onComplete,
  onDefer,
  onPromote,
  onTimebox,
  date = '',
  displayTimezone = 'UTC',
}: DayPlanProps): JSX.Element {
  // The promoted task is not repeated as a row. Everything else keeps its accepted order — the
  // server already sorted `plan`, and re-sorting here would disagree with the order the person
  // accepted.
  const groups = useMemo<PlanGroup[]>(() => {
    const byOrg = new Map<string, PlanGroup>();
    for (const item of plan) {
      if (item.planItemId === now?.planItemId) continue;
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
  }, [plan, now, orgName]);

  const rowActions = (item: HubTodayPlanItem): JSX.Element => (
    <ControlGroup
      controlSize="sm"
      className="shrink-0 opacity-0 transition-opacity group-focus-within/planrow:opacity-100 group-hover/planrow:opacity-100"
    >
      {/* Promoting is only meaningful relative to a task already ahead of this one. */}
      {now && onPromote ? (
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

  return (
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
          body="Athena drafts a plan from today's deadlines and the time left. Nothing changes until you approve it."
          {...(onPlan ? { cta: { label: 'Plan today with Athena', onClick: onPlan } } : {})}
          action={
            <Button asChild variant="ghost" controlSize="sm">
              <Link href="/tasks">Browse all tasks</Link>
            </Button>
          }
        />
      ) : (
        <Stack gap={2}>
          {now && onComplete && onDefer && onTimebox ? (
            <FocusCard
              item={now}
              orgName={orgName}
              completing={completing}
              onComplete={onComplete}
              onDefer={onDefer}
              onTimebox={onTimebox}
              date={date}
              displayTimezone={displayTimezone}
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
                  <Row key={item.planItemId} gap={1} className="group/planrow rounded-lg">
                    <HubTaskRow
                      task={item}
                      orgLabel={group.orgLabel}
                      className="min-w-0 flex-1"
                      displayTimezone={displayTimezone}
                    />
                    {rowActions(item)}
                  </Row>
                ))}
              </EntityList>
            </Stack>
          ))}
        </Stack>
      )}
    </TodaySection>
  );
}
