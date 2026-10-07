'use client';

import { Button, Card, CardContent, CardHeader, CardTitle } from '@docket/ui/primitives';
import type { JSX } from 'react';
import type { DailyPlanTask } from '@docket/planning/daily-plan-flow';
import type { ReadyPlanningController } from './daily-planning-controller';
import { unplacedMinutes } from './daily-planning-model';

/** Show which work cannot fit and keep the decisions beside its scheduling context. */
export function UnplacedWork({
  plan,
}: {
  readonly plan: ReadyPlanningController;
}): JSX.Element | null {
  const draft = plan.preview?.draft ?? plan.draft;
  const entries = draft.tasks.filter(
    (task) => unplacedMinutes(draft, task.taskId, plan.dayQ.data?.actual ?? []) > 0,
  );
  if (!entries.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Unscheduled</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {entries.map((task) => (
          <UnplacedTask key={task.taskId} plan={plan} task={task} />
        ))}
      </CardContent>
    </Card>
  );
}

function UnplacedTask({
  plan,
  task,
}: {
  readonly plan: ReadyPlanningController;
  readonly task: DailyPlanTask;
}): JSX.Element {
  const draft = plan.preview?.draft ?? plan.draft;
  const reason = plan.proposalContext?.unplaced.find(
    (value) => value.taskId === task.taskId,
  )?.reason;
  return (
    <div key={task.taskId} className="space-y-1">
      <p className="text-label-large">{plan.titleFor(task.taskId)}</p>
      <p className="text-body-small text-on-surface-variant">
        {unplacedMinutes(draft, task.taskId, plan.dayQ.data?.actual ?? [])} minutes{' '}
        {reason === 'blocked'
          ? 'blocked by unfinished work'
          : reason === 'no_availability'
            ? 'outside available work hours'
            : 'still need a block'}
      </p>
      <div className="flex flex-wrap gap-1">
        <Button
          size="sm"
          variant="secondary"
          disabled={Boolean(plan.preview)}
          onClick={() => {
            plan.setEditing({ taskId: task.taskId });
          }}
        >
          Schedule
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={plan.deferPending || plan.confirming || Boolean(plan.preview)}
          onClick={() => {
            void plan.moveTaskToTomorrow(task.taskId, task.organizationId);
          }}
        >
          Move to tomorrow
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={Boolean(plan.preview)}
          onClick={() => {
            plan.removeTask(task.taskId);
          }}
        >
          Remove
        </Button>
      </div>
    </div>
  );
}
