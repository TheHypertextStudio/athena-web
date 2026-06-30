'use client';

import { Button, Skeleton, Stack } from '@docket/ui/primitives';
import { type JSX } from 'react';

import NextUp from '@/components/today/next-up';
import { TodayPrompt } from '@/components/today/today-prompt';

import { useTodayData } from './use-today-data';

/**
 * TodayPage — the caller's calm daily landing.
 *
 * @remarks
 * A single focused column: a large "Today" over the date, the hybrid capture / ask-Athena box, and
 * "Next up" (the next few timeboxed blocks, or tasks due today). The day's full agenda is not on this
 * surface — it lives in the shell's portable agenda rail (registered globally, rides along on every
 * page), so the Today page itself just renders its masthead + capture + the "Next up" peek.
 */
export default function TodayPage(): JSX.Element {
  const { data, loading, error, refetch, taskTitle, orgName, heading, activeOrgId } = useTodayData();

  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col gap-10 px-6 py-10 @2xl:px-10 @2xl:py-14 @4xl:px-12">
      <Stack as="header" gap={3}>
        {/* "Today" at display size over the date at headline size. The in-app type scale tops out at
            text-h1, so these editorial sizes are a deliberate, surface-specific choice for the daily
            landing (a fixed display size, not the marketing clamp which grows much larger). */}
        <h1 className="text-on-surface text-[3rem] leading-[1.1] font-semibold tracking-[-0.01em]">
          Today
        </h1>
        <p className="text-on-surface-variant text-2xl">{heading}</p>
      </Stack>

      <TodayPrompt
        orgId={activeOrgId}
        orgLabel={activeOrgId ? orgName(activeOrgId) : 'your space'}
        onCaptured={refetch}
      />

      {error ? (
        <div
          role="alert"
          className="border-destructive/40 bg-destructive/5 text-destructive text-body flex items-center justify-between gap-4 rounded-lg border p-4"
        >
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={refetch}>
            Try again
          </Button>
        </div>
      ) : null}

      {loading ? (
        <div className="flex flex-col gap-4" aria-hidden="true">
          <Skeleton className="h-6 w-28" />
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      ) : (
        <NextUp
          blocks={data?.calendar ?? []}
          dueToday={data?.needsAttention.dueToday ?? []}
          taskTitle={taskTitle}
          orgName={orgName}
        />
      )}
    </div>
  );
}
