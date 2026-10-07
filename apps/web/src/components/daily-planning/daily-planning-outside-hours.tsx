'use client';

import { dailyAllocations } from '@docket/planning/daily-plan-execution';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@docket/ui/primitives';
import type { JSX } from 'react';
import type { ReadyPlanningController } from './daily-planning-controller';

/** Keep an earlier finish visible when retained blocks still extend beyond it. */
export function OutsideWorkHours({
  plan,
}: {
  readonly plan: ReadyPlanningController;
}): JSX.Element | null {
  const draft = plan.preview?.draft ?? plan.draft;
  const finish = Date.parse(draft.finishAt);
  const allocations = dailyAllocations(draft.sessions).filter(
    (part) => Date.parse(part.endsAt) > finish && !plan.allTasks.get(part.taskId)?.completedAt,
  );
  if (!allocations.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>After finish time</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {allocations.map((part) => (
          <div key={`${part.sessionId}:${part.taskId}`} className="space-y-1">
            <p className="text-label-large">{plan.titleFor(part.taskId)}</p>
            <p className="text-body-small text-on-surface-variant">
              {Math.ceil(
                (Date.parse(part.endsAt) - Math.max(finish, Date.parse(part.startsAt))) / 60_000,
              )}{' '}
              minutes scheduled after Finish.
            </p>
            <Button
              size="sm"
              variant="secondary"
              disabled={Boolean(plan.preview)}
              onClick={() => {
                plan.setEditing({ taskId: part.taskId, sessionId: part.sessionId });
              }}
            >
              Move or shorten block
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
