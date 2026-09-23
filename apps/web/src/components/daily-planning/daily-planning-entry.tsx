'use client';

/** Entry to the focused planning flow from the default Today page. */
import { Button, Card, CardContent } from '@docket/ui/primitives';
import { addDays, localMinuteOfDay } from '@docket/planning/zoned-time';
import Link from '@/components/docket-link';
import type { JSX } from 'react';

import { useDailyPlanningDay } from './daily-planning-queries';
import { MissedBlock } from './daily-planning-missed';

function entryLabel(draft: boolean, accepted: boolean): string {
  if (draft) return 'Resume planning';
  return accepted ? 'Adjust today' : 'Plan day';
}

function entryStatus(draft: boolean, accepted: boolean, failed: boolean): string {
  if (failed) return 'Could not load your plan.';
  if (draft) return 'Draft saved';
  return accepted ? 'Plan confirmed' : 'No plan yet';
}

/** Name the action from the saved day state. */
export function DailyPlanningEntry({ date }: { readonly date: string }): JSX.Element {
  const day = useDailyPlanningDay(date);
  const label = entryLabel(Boolean(day.data?.draft), Boolean(day.data?.accepted));
  const showTomorrow = day.data?.timezone
    ? localMinuteOfDay(new Date(), day.data.timezone) >= 15 * 60
    : false;
  return (
    <div className="space-y-3">
      <Card className="bg-primary-container">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-5">
          <div>
            <strong className="text-on-primary-container text-title-medium">Daily plan</strong>
            <p className="text-on-primary-container text-body-small">
              {entryStatus(Boolean(day.data?.draft), Boolean(day.data?.accepted), day.isError)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {day.isPending ? (
              <Button disabled>Plan day</Button>
            ) : day.isError ? (
              <Button onClick={() => void day.refetch()}>Retry</Button>
            ) : (
              <Button asChild>
                <Link href={`/plan?view=day&date=${date}`}>{label}</Link>
              </Button>
            )}
            {showTomorrow ? (
              <Button asChild variant="ghost">
                <Link href={`/plan?view=day&date=${addDays(date, 1)}`}>Plan tomorrow</Link>
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
      {day.data ? (
        <MissedBlock
          day={day.data}
          onRecorded={() => {
            void day.refetch();
          }}
        />
      ) : null}
    </div>
  );
}
