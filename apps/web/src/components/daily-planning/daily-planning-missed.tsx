'use client';

/** A missed timed block on Today with three concrete next actions. */
import { Button, Card, CardContent } from '@docket/ui/primitives';
import Link from '@/components/docket-link';
import { useState, type JSX } from 'react';

import { useActiveOrg } from '@/components/active-org';
import { TimeAddPastDialog } from '@/components/time-tracking/time-add-past-dialog';

import { clock } from './daily-planning-agenda';
import type { useDailyPlanningDay } from './daily-planning-queries';

type Day = NonNullable<ReturnType<typeof useDailyPlanningDay>['data']>;

function missedSession(day: Day) {
  const now = Date.now();
  return day.accepted?.current.snapshot.sessions.find((session) => {
    if (session.pinned || Date.parse(session.endsAt) > now) return false;
    const taskId = session.allocations[0]?.taskId;
    if (!taskId || day.tasks.find((task) => task.taskId === taskId)?.completedAt) return false;
    return !day.actual.some(
      (interval) =>
        interval.taskId === taskId &&
        Date.parse(interval.startedAt) < Date.parse(session.endsAt) &&
        Date.parse(interval.endedAt ?? new Date().toISOString()) > Date.parse(session.startsAt),
    );
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
  const session = missedSession(day);
  const taskId = session?.allocations[0]?.taskId;
  const task = day.tasks.find((item) => item.taskId === taskId);
  if (!session || !task) return null;
  return (
    <>
      <Card>
        <CardContent className="space-y-2 pt-5">
          <p className="text-title-medium">{task.title}</p>
          <p className="text-on-surface-variant text-body-small">
            Planned for {clock(session.startsAt, day.timezone)}
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
              <Link href="/focus">Still working</Link>
            </Button>
            <Button asChild>
              <Link
                href={`/plan?view=day&date=${day.date}&missed=${encodeURIComponent(session.id)}`}
              >
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
        initialStartsAt={session.startsAt}
        initialEndsAt={session.endsAt}
        onSaved={onRecorded}
      />
    </>
  );
}
