'use client';

import { Button, Stack } from '@docket/ui/primitives';
import { type JSX } from 'react';

import { GhostProposals } from '@/components/today/ghost-proposals';
import NextUp from '@/components/today/next-up';
import { TodayPrompt } from '@/components/today/today-prompt';
import { useNow } from '@/lib/use-now';

import { useTodayData } from './use-today-data';

/** A warm, time-of-day greeting above the masthead. */
function greetingFor(hour: number): string {
  if (hour < 5) return 'Late night';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  if (hour < 21) return 'Good evening';
  return 'Winding down';
}

/**
 * TodayPage — the caller's calm daily landing.
 *
 * @remarks
 * A single focused column: a large "Today" over the date, the capture box, and "Next up" (the next
 * few timeboxed blocks, or tasks due today). The day's full agenda is not on this surface — it
 * lives in the shell's portable agenda rail (registered globally, rides along on every page), so
 * the Today page itself just renders its masthead + capture + the "Next up" peek.
 *
 * The masthead carries no Athena door of its own. Athena is the engine behind every door rather
 * than a place to be opened, and this page already has two of those doors — the capture box and
 * the global pill.
 */
export default function TodayPage(): JSX.Element {
  const { data, loading, error, refetch, taskTitle, orgName, heading, activeOrgId } =
    useTodayData();
  const now = useNow(60_000);

  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col gap-6 px-6 py-8 @2xl:px-10 @2xl:py-10 @4xl:px-12">
      {/* Tightened so the composer sits near the top of the fold. The masthead used to spend a
          `gap-3` stack inside a `gap-10` column on top of `py-14`, which put roughly a quarter of
          a 900px viewport between opening the page and reaching the one thing you came to do. */}
      <Stack
        as="header"
        gap={1}
        className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-700 motion-safe:ease-out"
      >
        {/* "Today" at display size over the date at headline size. The in-app type scale tops out at
            text-title-large, so these editorial sizes are a deliberate, surface-specific choice for the daily
            landing (a fixed display size, not the marketing clamp which grows much larger). */}
        <span className="text-on-surface-variant text-label-large tracking-wide">
          {greetingFor(now.getHours())}
        </span>
        <h1 className="text-on-surface text-[3rem] leading-[1.1] font-semibold tracking-[-0.01em]">
          Today
        </h1>
        <p className="text-on-surface-variant text-title-medium">{heading}</p>
        {/* No "Open Athena for today" door here. Athena is the engine behind every door, not a
            place you go — and the capture box directly below this is already one of those doors,
            with the global pill a third. Three entry points to one engine on a single screen is
            the model leaking into the layout. */}
      </Stack>

      <TodayPrompt
        orgId={activeOrgId}
        orgLabel={activeOrgId ? orgName(activeOrgId) : 'your space'}
        onCaptured={refetch}
      />

      <GhostProposals orgId={activeOrgId} onApplied={refetch} />

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

      {/* No loading branch around this section. `NextUp` paints its own heading immediately and
          confines the placeholder to the rows, so the statically-known "Next up" label is never
          replaced by a grey bar while the Hub read is in flight. */}
      <NextUp
        blocks={data?.calendar ?? []}
        dueToday={data?.needsAttention.dueToday ?? []}
        taskTitle={taskTitle}
        orgName={orgName}
        loading={loading}
      />
    </div>
  );
}
