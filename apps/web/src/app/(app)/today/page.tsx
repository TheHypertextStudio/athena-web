'use client';

import { Button } from '@docket/ui/primitives';
import { type JSX } from 'react';

import { DayRecapEntry } from '@/components/today/day-recap-entry';
import KeepTheMomentum from '@/components/today/keep-the-momentum';
import NeedsYou from '@/components/today/needs-you';
import { TodayAttention } from '@/components/today/today-attention';
import { TodayPrompt } from '@/components/today/today-prompt';
import TodaysWork from '@/components/today/todays-work';
import WorkInMotion from '@/components/today/work-in-motion';
import { useAthenaPanel } from '@/components/athena/athena-panel-provider';

import { useTodayData } from './use-today-data';
import { useTodayActions } from './use-today-actions';

/**
 * TodayPage — the daily operating surface, with Athena as its first interaction.
 *
 * @remarks
 * **At rest** it answers where things stand in a deliberately finite hierarchy: the standing
 * Athena field, what is outstanding today broken into its parts, whatever is waiting on this
 * person's own decision, the day's accepted plan, and the larger outcomes that work is moving.
 * Inline actions cover quick execution; entity links defer detailed workflows to their canonical
 * pages.
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
 * dropped. Work now precedes portfolio, and the count is broken back into the parts it was summed
 * from.
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
  const plannedTaskIds = new Set((data?.plan ?? []).map((item) => item.id));
  const openTodayAthena = (draft: string): void => {
    if (!activeOrgId) return;
    openAthena({ workspaceId: activeOrgId, workspaceName: orgName(activeOrgId) }, draft);
  };

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col gap-7 px-5 py-7 @2xl:px-10 @2xl:py-9">
      {/* `Today · Friday, August 7` on one line at the app's real page-title size. The 48px display
          heading this replaces was 2.4× the documented ceiling (`design-system.md:293`: "page
          titles are 20px, not a marketing 24px+"), and it sat over a separate date line and a
          time-of-day greeting no spec ever asked for — three lines of masthead before the first
          thing you can act on. */}
      <h1 aria-label="Today" className="text-on-surface text-title-large shrink-0 font-semibold">
        Today
        <span className="text-on-surface-variant ml-2 font-normal">{heading}</span>
      </h1>

      <TodayPrompt
        orgId={activeOrgId}
        orgLabel={activeOrgId ? orgName(activeOrgId) : 'your workspace'}
        onCaptured={refetch}
      />

      <TodayAttention needsAttention={data?.needsAttention} brief={data?.brief} />

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

      {/* Approvals outrank anything you planned: an agent that paused for your go-ahead is
          blocked on you personally, and so is a task waiting on a dependency.

          Blocked items already on the plan are dropped here, because the plan row below carries
          its own Blocked marker — listing them in both places puts one task on screen twice and
          makes "Needs you" look busier than the day actually is. Approvals are never deduped: a
          plan row says nothing about an agent waiting on a signature, so that one is not a
          repeat. */}
      {data ? (
        <NeedsYou
          approvals={data.needsAttention.approvals}
          blocked={data.needsAttention.blocked.filter((item) => !plannedTaskIds.has(item.id))}
          orgName={orgName}
        />
      ) : null}

      <TodaysWork
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

      <WorkInMotion cards={data?.statusCards ?? []} orgName={orgName} />

      {data &&
      (data.planState === 'cleared' || (data.planState === 'active' && data.focus.now === null)) ? (
        <KeepTheMomentum
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
