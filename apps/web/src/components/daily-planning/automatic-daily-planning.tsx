'use client';

import { localDateString } from '@docket/planning/zoned-time';
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@docket/ui/primitives';
import { ArrowRight } from '@docket/ui/icons';
import { type JSX, useCallback, useEffect, useState } from 'react';
import { useAppPathname, useAppSearchParams } from '@/lib/app-location';
import { useAppRouter } from '@/lib/interactions/navigation';
import { useSchedulingPreferences } from '@/components/scheduling-plan/use-schedule-plan';
import { useDailyPlanningDay } from './daily-planning-queries';
import {
  dailyPlanningEntryKey,
  dailyPlanningOwnsInput,
  hasEnteredDailyPlanning,
  isDailyPlanningWorkday,
  recordDailyPlanningEntry,
} from './automatic-daily-planning-model';
import { useDailyPlanningForeground } from './use-daily-planning-foreground';

function hasUnacceptedWorkday(
  preferences: ReturnType<typeof useSchedulingPreferences>,
  day: ReturnType<typeof useDailyPlanningDay>,
  now: number,
): boolean {
  return (
    preferences.isSuccess &&
    day.isSuccess &&
    !day.isFetching &&
    !day.data.accepted &&
    isDailyPlanningWorkday(new Date(now), preferences.data)
  );
}

function isDailyPlanner(pathname: string, search: URLSearchParams): boolean {
  return pathname === '/plan/day' || (pathname === '/plan' && search.get('view') === 'day');
}

function remainingSeconds(countdown: { remaining: number } | null): number {
  return countdown ? countdown.remaining : 5;
}

/** Announce automatic entry to the existing daily planner for a live authenticated account. */
export function AutomaticDailyPlanning({
  userId,
}: {
  readonly userId: string;
}): JSX.Element | null {
  const preferences = useSchedulingPreferences();
  const timezone = preferences.data?.timezone ?? 'UTC';
  const [date, setDate] = useState(() => localDateString(new Date(), timezone));
  const day = useDailyPlanningDay(date, preferences.isSuccess);
  const recheck = useCallback(async (): Promise<void> => {
    await Promise.all([day.refetch(), preferences.refetch()]);
  }, [day.refetch, preferences.refetch]);
  const clock = useDailyPlanningForeground(recheck);
  const pathname = useAppPathname();
  const search = useAppSearchParams();
  const router = useAppRouter();
  const key = dailyPlanningEntryKey(userId, timezone, date);
  const dailyPlanner = isDailyPlanner(pathname, search);
  const [countdown, setCountdown] = useState<{ key: string; remaining: number } | null>(null);
  const [requestedFrom, setRequestedFrom] = useState<string | null>(null);
  const today = localDateString(new Date(clock.now), timezone);
  const eligible =
    clock.active &&
    date === today &&
    hasUnacceptedWorkday(preferences, day, clock.now) &&
    !dailyPlanner &&
    !hasEnteredDailyPlanning(key) &&
    requestedFrom !== `${key}:${pathname}` &&
    !dailyPlanningOwnsInput();

  useEffect(() => {
    if (!clock.active) setRequestedFrom(null);
  }, [clock.active]);
  useEffect(() => {
    setDate(today);
  }, [today]);
  useEffect(() => {
    if (dailyPlanner && date === today && search.get('date') === today && preferences.isSuccess) {
      recordDailyPlanningEntry(key);
    }
  }, [dailyPlanner, date, today, key, preferences.isSuccess, search]);
  useEffect(() => {
    if (!eligible) {
      setCountdown(null);
      return;
    }
    if (countdown?.key === key) return;
    setCountdown({ key, remaining: 5 });
  }, [eligible, key, clock.now, countdown]);

  const enter = useCallback((): void => {
    if (!eligible || document.visibilityState !== 'visible' || !document.hasFocus()) return;
    if (dailyPlanningOwnsInput()) return;
    setRequestedFrom(`${key}:${pathname}`);
    setCountdown(null);
    router.push(`/plan/day?date=${date}`);
  }, [eligible, router, date, key, pathname]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      setCountdown((value) =>
        value ? { ...value, remaining: Math.max(0, value.remaining - 1) } : null,
      );
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [countdown?.key]);
  const remaining = remainingSeconds(countdown);
  useEffect(() => {
    if (countdown && remaining === 0) enter();
  }, [countdown, remaining, enter]);
  if (!eligible || !countdown) return null;

  return <DailyPlanningAnnouncement remaining={remaining} enter={enter} />;
}

function DailyPlanningAnnouncement({
  remaining,
  enter,
}: {
  readonly remaining: number;
  readonly enter: () => void;
}): JSX.Element {
  return (
    <Dialog open onOpenChange={() => undefined}>
      <DialogContent
        data-daily-planning-entry=""
        showClose={false}
        presentation={{ kind: 'centered', size: 'large', height: 'medium' }}
        onInteractOutside={(event) => {
          event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          enter();
        }}
      >
        <DialogBody>
          <div className="flex h-full flex-col items-center justify-center gap-6 px-4 text-center sm:px-8">
            <DialogTitle className="text-display-small sm:text-display-medium max-w-lg text-balance">
              It’s time to plan your day.
            </DialogTitle>
            <DialogDescription className="text-body-large sm:text-title-large">
              <span className="sr-only">Opening planner in five seconds.</span>
              <span aria-hidden="true" className="tabular-nums">
                Opening planner in {remaining} {remaining === 1 ? 'second' : 'seconds'}.
              </span>
            </DialogDescription>
            <Button controlSize="xl" className="w-full max-w-xs" onClick={enter}>
              Plan now <ArrowRight aria-hidden="true" className="size-5" />
            </Button>
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
