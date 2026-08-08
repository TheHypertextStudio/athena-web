'use client';

import { Button } from '@docket/ui/primitives';
import { type JSX, useCallback, useState } from 'react';

import { GhostProposals } from '@/components/today/ghost-proposals';
import NeedsYou from '@/components/today/needs-you';
import TodaysWork from '@/components/today/todays-work';
import TodaySession from '@/components/today/today-session';
import { TodayPrompt } from '@/components/today/today-prompt';
import { startViewTransition } from '@/lib/view-transition';

import { useTodayData } from './use-today-data';

/**
 * TodayPage — where the day starts, in two states.
 *
 * @remarks
 * **At rest** it answers where things stand. The prompt sits first, because the usual reason to
 * open this page is that you arrived with something in your head; then Athena's proposals, then
 * what is waiting on your approval or blocked, then the day's own tasks. That order is not
 * chronological — a proposal or an approval will not move without you, and a plan you wrote
 * yesterday will. Anything holding nothing renders nothing, so a clear day is a short page rather
 * than a column of empty panels.
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
  const { data, loading, error, refetch, orgName, heading, activeOrgId } = useTodayData();
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
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col gap-8 px-6 py-8 @2xl:px-10 @2xl:py-10">
      {/* `Today · Friday, August 7` on one line at the app's real page-title size. The 48px display
          heading this replaces was 2.4× the documented ceiling (`design-system.md:293`: "page
          titles are 20px, not a marketing 24px+"), and it sat over a separate date line and a
          time-of-day greeting no spec ever asked for — three lines of masthead before the first
          thing you can act on. */}
      <h1 className="text-on-surface text-title-large shrink-0 font-semibold">
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

          <GhostProposals orgId={activeOrgId} onApplied={refetch} />

          <NeedsYou
            approvals={data?.needsAttention.approvals ?? []}
            blocked={data?.needsAttention.blocked ?? []}
            orgName={orgName}
          />

          <TodaysWork plan={data?.plan ?? []} orgName={orgName} loading={loading} />
        </>
      )}
    </div>
  );
}
