'use client';

import { Button } from '@docket/ui/primitives';
import Link from 'next/link';
import { type JSX, useCallback, useState } from 'react';

import { DayRecapEntry } from '@/components/today/day-recap-entry';
import FocusSequence from '@/components/today/focus-sequence';
import KeepTheMomentum from '@/components/today/keep-the-momentum';
import PlanTodayCard from '@/components/today/plan-today-card';
import TodaySession from '@/components/today/today-session';
import { TodayPrompt } from '@/components/today/today-prompt';
import WorkInMotion from '@/components/today/work-in-motion';
import { startViewTransition } from '@/lib/view-transition';

import { useTodayData } from './use-today-data';
import { useTodayActions } from './use-today-actions';

/**
 * TodayPage — the daily operating surface, with Athena as its first interaction.
 *
 * @remarks
 * **At rest** it answers where things stand in a deliberately finite hierarchy: the standing
 * Athena field, a prominent planning action when the day is untouched, Now and After this for an
 * accepted plan, grounded Project/Initiative status stories, and feasible extra work only after
 * the accepted plan is clear. Inline actions cover quick execution; entity links defer detailed
 * workflows to their canonical pages.
 *
 * **Engaged**, it is the conversation. Starting something with Athena does not navigate: the
 * prompt expands in place and the resting content steps out of the way, so the page you were
 * reading becomes the session you are in. `startViewTransition` plus a shared
 * `view-transition-name` on the prompt and the session makes that one box growing rather than two
 * screens swapping — the app's standing rule, and the reason it degrades to an instant change under
 * `prefers-reduced-motion` for free.
 *
 * It is still only **one** conversation. The session rendered here is the same persistent thread
 * the ⌘J dock and `/athena` open; Today is another door onto it, not a place that grows its own.
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
  const [session, setSession] = useState<{ draft: string } | null>(null);

  const openSession = useCallback((draft: string) => {
    startViewTransition(() => {
      setSession({ draft });
    });
  }, []);
  const closeSession = useCallback(() => {
    startViewTransition(() => {
      setSession(null);
    });
    // The day may have moved while the conversation was open — Athena files work as it goes.
    refetch();
  }, [refetch]);

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

      {session && activeOrgId ? (
        <TodaySession orgId={activeOrgId} onClose={closeSession} initialDraft={session.draft} />
      ) : (
        <>
          <TodayPrompt
            orgId={activeOrgId}
            orgLabel={activeOrgId ? orgName(activeOrgId) : 'your workspace'}
            onCaptured={refetch}
            onStartSession={activeOrgId ? openSession : undefined}
          />

          {data?.brief ? (
            data.brief.href ? (
              <Link
                href={data.brief.href}
                className="text-on-surface-variant hover:text-primary focus-visible:ring-ring -mt-5 w-fit text-sm underline-offset-4 hover:underline focus-visible:rounded focus-visible:ring-2 focus-visible:outline-none"
              >
                {data.brief.text}
              </Link>
            ) : (
              <p className="text-on-surface-variant -mt-5 text-sm">{data.brief.text}</p>
            )
          ) : null}

          {error ? (
            <div
              role="alert"
              className="border-error/40 bg-error/5 text-error text-body-medium flex items-center justify-between gap-4 rounded-lg border p-4"
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

          {loading ? (
            <div className="flex flex-col gap-3" aria-label="Loading today">
              <div className="bg-surface-container-high h-36 animate-pulse rounded-2xl" />
              <div className="bg-surface-container-high h-24 animate-pulse rounded-xl" />
            </div>
          ) : null}

          {data?.planState === 'unplanned' ? (
            <PlanTodayCard
              onPlan={() => {
                openSession('Plan today');
              }}
            />
          ) : null}

          {data?.planState === 'active' ? (
            <FocusSequence
              focus={data.focus}
              orgName={orgName}
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
          ) : null}

          <WorkInMotion cards={data?.statusCards ?? []} orgName={orgName} />

          {data &&
          (data.planState === 'cleared' ||
            (data.planState === 'active' && data.focus.now === null)) ? (
            <KeepTheMomentum
              suggestions={data.suggestions}
              orgName={orgName}
              blockedPlan={data.planState === 'active'}
              onAdd={actions.add}
              onStart={actions.start}
              busy={actions.suggestionBusy}
              onAskAthena={() => {
                openSession('What else can I move today?');
              }}
            />
          ) : null}

          {/* Last, and only from mid-afternoon: this is the one backward-looking thing on a
              forward-looking page, so it must not open the day on the past. */}
          {/* No date: which day it is now is the server's to say, from the Hub timezone. The browser's
              clock disagrees whenever somebody travels, and asking for its today from a zone behind
              it asks for a day that has not happened. */}
          <DayRecapEntry />
        </>
      )}
    </div>
  );
}
