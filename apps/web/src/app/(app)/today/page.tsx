'use client';

import { Button } from '@docket/ui/primitives';
import { type JSX } from 'react';

import { GhostProposals } from '@/components/today/ghost-proposals';
import NeedsYou from '@/components/today/needs-you';
import TodaysWork from '@/components/today/todays-work';
import { TodayPrompt } from '@/components/today/today-prompt';

import { useTodayData } from './use-today-data';

/**
 * TodayPage — where the day starts: what is waiting on you, and what you meant to do.
 *
 * @remarks
 * Two jobs, in this order:
 *
 * 1. **Start something.** The prompt is the first thing under the date, because the most common
 *    reason to open this page is that you arrived with something in your head.
 * 2. **See where things stand.** Athena's proposals, then what is waiting on your approval or
 *    blocked, then the day's own tasks.
 *
 * The order is deliberate and it is not chronological: a proposal or an approval will not move
 * without you, and a plan you wrote yesterday will. Anything with nothing in it renders nothing —
 * a clear day should be a short page, not a column of empty panels.
 *
 * **Not a three-pane cockpit.** `docs/core/mvp-plan.md` §8.1 specifies Plan · Calendar ·
 * Needs-Attention side by side. The calendar pane is gone because the shell's agenda rail renders
 * the same day on every route, and the remaining two read better stacked in one column than split
 * into panes that each get a third of the width.
 *
 * **No Athena door of its own.** Athena is the engine behind every door rather than a place to be
 * opened, and this page already has two — the prompt, and the global pill.
 */
export default function TodayPage(): JSX.Element {
  const { data, loading, error, refetch, orgName, heading, activeOrgId } = useTodayData();

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

      <TodayPrompt
        orgId={activeOrgId}
        orgLabel={activeOrgId ? orgName(activeOrgId) : 'your workspace'}
        onCaptured={refetch}
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
    </div>
  );
}
