'use client';

/** A missed timed block on Today with three concrete next actions. */
import { Button, Card, CardContent } from '@docket/ui/primitives';
import Link from 'next/link';
import { useState, type JSX } from 'react';
import { missedDailyAllocation } from '@docket/planning/daily-plan-execution';

import { useActiveOrg } from '@/components/active-org';
import { TimeAddPastDialog } from '@/components/time-tracking/time-add-past-dialog';

import { clock } from './daily-planning-agenda';
import type { useDailyPlanningDay } from './daily-planning-queries';

type Day = NonNullable<ReturnType<typeof useDailyPlanningDay>['data']>;

function missedAllocation(day: Day) {
  return missedDailyAllocation({
    sessions: day.accepted?.current.snapshot.sessions ?? [],
    taskBudgets: day.accepted?.current.snapshot.tasks,
    now: Date.now(),
    actionableTaskIds: day.tasks.filter((task) => !task.completedAt).map((task) => task.taskId),
    actual: day.actual,
    activeTaskId: day.actual.find((interval) => interval.endedAt === null)?.taskId ?? null,
  });
}

/** Show a missed block before proposing any change to an accepted day. */
export function MissedBlock({
  day,
  onRecorded,
}: {
  readonly day: Day;
  readonly onRecorded: () => void;
}): JSX.Element | null {
  const [recordOpen, setRecordOpen] = useState(false);
  const { orgs } = useActiveOrg();
  const allocation = missedAllocation(day);
  const taskId = allocation?.taskId;
  const task = day.tasks.find((item) => item.taskId === taskId);
  if (!allocation || !task) return null;
  const recoveryHref = `/plan/day?date=${day.date}&missed=${encodeURIComponent(allocation.sessionId)}&task=${encodeURIComponent(task.taskId)}`;
  return (
    <>
      <Card>
        <CardContent className="space-y-2 pt-5">
          <p className="text-title-medium">{task.title}</p>
          <p className="text-on-surface-variant text-body-small">
            Planned for {clock(allocation.startsAt, day.timezone)}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setRecordOpen(true);
              }}
            >
              Done
            </Button>
            <Button asChild variant="secondary">
              <Link prefetch={false} href={`${recoveryHref}&recovery=still_working`}>
                Still working
              </Link>
            </Button>
            <Button asChild>
              <Link prefetch={false} href={`${recoveryHref}&recovery=not_started`}>
                Not started
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
      <TimeAddPastDialog
        open={recordOpen}
        onOpenChange={setRecordOpen}
        timezone={day.timezone}
        workspaceId={task.organizationId}
        workspaces={orgs}
        initialTaskId={taskId}
        initialStartsAt={allocation.startsAt}
        initialEndsAt={allocation.endsAt}
        onSaved={onRecorded}
      />
    </>
  );
}
