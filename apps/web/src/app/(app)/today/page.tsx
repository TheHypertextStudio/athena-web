'use client';

import { Stack } from '@docket/ui/primitives';
import { type JSX, useMemo } from 'react';

import { PartialLoadBanner } from '@/components/feedback';
import { DayRecapEntry } from '@/components/today/day-recap-entry';
import { DailyPlanningEntry } from '@/components/daily-planning/daily-planning-entry';
import SuggestedTasks from '@/components/today/suggested-tasks';
import NeedsAttention from '@/components/today/needs-attention';
import { TodayPrompt } from '@/components/today/today-prompt';
import DayPlan from '@/components/today/day-plan';
import ProjectStatus from '@/components/today/project-status';
import { useAthenaPanel } from '@/components/athena/athena-panel-provider';

import { useTodayData } from './use-today-data';
import { useTodayActions } from './use-today-actions';

/** Today's payload, once loaded. */
type TodayPayload = NonNullable<ReturnType<typeof useTodayData>['data']>;

function showSuggestions(data: TodayPayload): boolean {
  return (
    data.planState === 'cleared' ||
    (data.planState === 'active' && data.focus.now === null && data.focus.after === null)
  );
}

/** The needs-attention lists Today shows, each without the tasks the plan already carries. */
interface TodayAttention {
  readonly approvals: TodayPayload['needsAttention']['approvals'];
  readonly blocked: TodayPayload['needsAttention']['blocked'];
  readonly dueToday: TodayPayload['needsAttention']['dueToday'];
}

/**
 * Derive the needs-attention lists once per payload rather than once per render: Today re-renders
 * on every query settle, timer tick and inline mutation, and fresh array identities here would
 * defeat memoisation downstream.
 */
function useTodayAttention(data: TodayPayload | null | undefined): TodayAttention {
  return useMemo(() => {
    const planned = new Set((data?.plan ?? []).map((item) => item.id));
    const needs = data?.needsAttention;
    return {
      // Approvals are NOT deduped against the plan. A plan row shows a task's blocked state and
      // its due date, so repeating those would be noise — but it says nothing about an agent
      // holding for a signature, so filtering these hid the approval with nowhere else to see it.
      approvals: needs?.approvals ?? [],
      blocked: (needs?.blocked ?? []).filter((task) => !planned.has(task.id)),
      dueToday: (needs?.dueToday ?? []).filter((task) => !planned.has(task.id)),
    };
  }, [data]);
}

/** Execution stays above the attention backlog once the caller has an active plan. */
function TodayWork({
  data,
  loading,
  orgName,
  date,
  displayTimezone,
  attention,
  actions,
}: Pick<
  ReturnType<typeof useTodayData>,
  'data' | 'loading' | 'orgName' | 'date' | 'displayTimezone'
> & {
  readonly attention: TodayAttention;
  readonly actions: ReturnType<typeof useTodayActions>;
}): JSX.Element {
  const plan = (
    <DayPlan
      plan={data?.plan ?? []}
      now={data?.focus.now ?? null}
      orgName={orgName}
      loading={loading}
      unplanned={data?.planState === 'unplanned'}
      completing={actions.completing}
      onComplete={actions.complete}
      onDefer={actions.defer}
      onPromote={actions.promote}
      onTimebox={(item, startsAt, endsAt) => {
        void actions.timebox(item, startsAt, endsAt);
      }}
      date={date}
      displayTimezone={displayTimezone}
    />
  );
  // Accepted execution must remain reachable above a long backlog. Approvals still appear below
  // it, including approvals for planned tasks, because a plan row cannot request a signature.
  const needsAttention = data ? (
    <NeedsAttention
      approvals={attention.approvals}
      blocked={attention.blocked}
      dueToday={attention.dueToday}
      orgName={orgName}
    />
  ) : null;
  return data?.planState === 'active' ? (
    <>
      {plan}
      {needsAttention}
    </>
  ) : (
    <>
      {needsAttention}
      {plan}
    </>
  );
}

/**
 * TodayPage — the daily operating surface, with a distinct planning entry.
 *
 * @remarks
 * **At rest** it offers Plan day or Resume planning, then shows the Athena field, work that needs a
 * decision, and the Projects and Initiatives that work belongs to. An active plan opens directly
 * on Now, with Athena available in the rail and the attention backlog below execution. Inline actions
 * cover quick execution; entity links defer detailed workflows to their canonical pages.
 *
 * **Engaged**, it keeps the plan visible and reveals Athena in the shared utility rail. The rail
 * receives the workspace and draft while Today remains the execution surface. The planner lives at
 * `/plan?view=day` and returns here after confirmation.
 *
 * It is still only **one** conversation. The session rendered here is the same persistent thread
 * the ⌘J rail and `/athena` open; Today is another door onto it, not a place that grows its own.
 *
 * **What this ordering fixes.** The page previously opened on a text box, a sentence counting
 * `approvals + blocked + dueToday + inbox` into one number, and a banner advertising Athena — then
 * four status cards. It rendered *no tasks* unless a plan was already active, and even then only
 * two of them, while `plan[]`, `needsAttention.approvals`, and `.blocked` were all fetched and
 * dropped. Work now precedes portfolio, and the summed count is gone entirely: every task it
 * counted is now a row somebody can act on.
 *
 * **Not a three-pane cockpit.** `docs/core/mvp-plan.md` §8.1 specifies Plan · Calendar ·
 * Needs-Attention side by side. The calendar pane is gone because the shell's agenda rail renders
 * the same day on every route, and the remaining two read better stacked in one column than split
 * into panes that each get a third of the width.
 */
export default function TodayPage(): JSX.Element {
  const { data, loading, error, refetch, orgName, heading, activeOrgId, date, displayTimezone } =
    useTodayData();
  const actions = useTodayActions(date);
  const { railVisible } = useAthenaPanel();
  const attention = useTodayAttention(data);

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col gap-10 px-5 pt-10 pb-20 @2xl:px-8 @2xl:pt-14">
      {/* The date used to sit inline at the title's own size, differing only in weight — thirty
          characters of 22px text reading as one run-on rather than as a title with a date under it.
          Two lines, two sizes: the title carries the page, the date supports it. */}
      <Stack gap={1} className="shrink-0">
        <h1 aria-label="Today" className="text-on-surface text-title-large">
          Today
        </h1>
        <p className="text-on-surface-variant text-body-medium">{heading}</p>
      </Stack>

      <DailyPlanningEntry date={date} />

      {data?.planState !== 'active' ? (
        <TodayPrompt
          orgId={activeOrgId}
          orgLabel={activeOrgId ? orgName(activeOrgId) : 'your workspace'}
          onCaptured={refetch}
          captureOnly={railVisible}
        />
      ) : null}

      {error ? (
        <PartialLoadBanner title="Today did not load" onRetry={refetch}>
          {error}
        </PartialLoadBanner>
      ) : null}

      <TodayWork
        data={data}
        loading={loading}
        orgName={orgName}
        date={date}
        displayTimezone={displayTimezone}
        attention={attention}
        actions={actions}
      />

      <ProjectStatus cards={data?.statusCards ?? []} orgName={orgName} />

      {data && showSuggestions(data) ? (
        <SuggestedTasks
          suggestions={data.suggestions}
          orgName={orgName}
          blockedPlan={data.planState === 'active'}
          onAdd={actions.add}
          onStart={actions.start}
          busy={actions.suggestionBusy}
        />
      ) : null}

      {/* Last, and only from mid-afternoon: this is the one backward-looking thing on a
            forward-looking page, so it must not open the day on the past. */}
      {/* No date: which day it is now is the server's to say, from the Hub timezone. The browser's
            clock disagrees whenever somebody travels, and asking for its today from a zone behind
            it asks for a day that has not happened. */}
      <DayRecapEntry />
    </div>
  );
}
