'use client';

import { Button, Stack } from '@docket/ui/primitives';
import { type JSX, useMemo } from 'react';

import { DayRecapEntry } from '@/components/today/day-recap-entry';
import SuggestedTasks from '@/components/today/suggested-tasks';
import NeedsAttention from '@/components/today/needs-attention';
import { TodayPrompt } from '@/components/today/today-prompt';
import DayPlan from '@/components/today/day-plan';
import ProjectStatus from '@/components/today/project-status';
import { useAthenaPanel } from '@/components/athena/athena-panel-provider';

import { useTodayData } from './use-today-data';
import { useTodayActions } from './use-today-actions';

/**
 * TodayPage — the daily operating surface, with Athena as its first interaction.
 *
 * @remarks
 * **At rest** it answers where things stand in a fixed order: the Athena field, work that needs a
 * decision and is not on the plan, the accepted plan itself, and the Projects and Initiatives that
 * work belongs to. Inline actions cover quick execution; entity links defer detailed workflows to
 * their canonical pages.
 *
 * **Engaged**, it keeps the plan visible and reveals Athena in the shared utility rail. The rail
 * receives the workspace and draft while Today remains the planning surface, so a person can return
 * to the plan without maintaining a second conversation host.
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
  const { openAthena } = useAthenaPanel();
  // Once per payload rather than once per render: Today re-renders on every query settle, timer
  // tick and inline mutation, and fresh array identities here would defeat memoisation downstream.
  const attention = useMemo(() => {
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
  const openTodayAthena = (draft: string): void => {
    if (!activeOrgId) return;
    openAthena({ workspaceId: activeOrgId, workspaceName: orgName(activeOrgId) }, draft);
  };

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col gap-10 px-5 pt-10 pb-20 @2xl:px-8 @2xl:pt-14">
      {/* The date used to sit inline at the title's own size, differing only in weight — thirty
          characters of 22px text reading as one run-on rather than as a title with a date under it.
          Two lines, two sizes: the title carries the page, the date supports it. */}
      <Stack gap={1} className="shrink-0">
        <h1 aria-label="Today" className="text-on-surface text-title-large font-semibold">
          Today
        </h1>
        <p className="text-on-surface-variant text-body-medium">{heading}</p>
      </Stack>

      <TodayPrompt
        orgId={activeOrgId}
        orgLabel={activeOrgId ? orgName(activeOrgId) : 'your workspace'}
        onCaptured={refetch}
      />

      {error ? (
        <div
          role="alert"
          className="border-error/40 bg-error-container text-on-error-container text-body-medium flex items-center justify-between gap-4 rounded-xl border p-4"
        >
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={refetch}>
            Try again
          </Button>
        </div>
      ) : null}

      {actions.error ? (
        <p role="alert" className="text-error text-body-small -mt-4">
          {actions.error}
        </p>
      ) : null}

      {/* Approvals outrank anything self-scheduled: an agent that paused for a signature is
          blocked on this person, and so is a task waiting on a dependency. A deadline landing on a
          task that never made it onto the plan is the third, and the only one the plan below
          cannot show.

          Blocked and due-today are filtered against the plan, because a plan row already carries
          its own Blocked marker and its own due date. Approvals are not: nothing on a plan row says
          an agent is holding for a signature, so filtering them left an approval on a planned task
          with nowhere on the page to appear. */}
      {data ? (
        <NeedsAttention
          approvals={attention.approvals}
          blocked={attention.blocked}
          dueToday={attention.dueToday}
          orgName={orgName}
        />
      ) : null}

      <DayPlan
        plan={data?.plan ?? []}
        now={data?.focus.now ?? null}
        orgName={orgName}
        loading={loading}
        unplanned={data?.planState === 'unplanned'}
        onPlan={() => {
          openTodayAthena('Plan today');
        }}
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

      <ProjectStatus cards={data?.statusCards ?? []} orgName={orgName} />

      {data &&
      (data.planState === 'cleared' || (data.planState === 'active' && data.focus.now === null)) ? (
        <SuggestedTasks
          suggestions={data.suggestions}
          orgName={orgName}
          blockedPlan={data.planState === 'active'}
          onAdd={actions.add}
          onStart={actions.start}
          busy={actions.suggestionBusy}
          onAskAthena={() => {
            openTodayAthena('What else can I move today?');
          }}
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
