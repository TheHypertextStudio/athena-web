'use client';

/** Final screen after a person accepts or adjusts the day. */
import { Button, Card, CardContent } from '@docket/ui/primitives';
import { EntityList, EntityListRow } from '@docket/ui/components';
import { useState, type JSX } from 'react';
import {
  selectDailyExecution,
  remainingDailyTaskIds,
  dailyAllocations,
} from '@docket/planning/daily-plan-execution';

import { clock } from './daily-planning-agenda';
import type { ReadyPlanningController } from './daily-planning-controller';

function focusTitle(
  plan: ReadyPlanningController,
  taskId: string | null | undefined,
  workingTaskId: string | null,
): string | null {
  if (!taskId) return null;
  if (taskId === workingTaskId) return plan.timer.title || plan.titleFor(taskId);
  return plan.titleFor(taskId);
}

function blockedTaskIds(plan: ReadyPlanningController): Set<string> {
  return new Set([
    ...(plan.proposalContext?.unplaced ?? [])
      .filter((task) => task.reason === 'blocked')
      .map((task) => task.taskId),
    ...[...plan.allTasks.values()]
      .filter((task) => task.state === 'blocked')
      .map((task) => task.taskId),
  ]);
}

function unfinishedUnblockedTasks(plan: ReadyPlanningController, blocked: Set<string>) {
  return plan.draft.tasks.filter(
    (task) => !plan.allTasks.get(task.taskId)?.completedAt && !blocked.has(task.taskId),
  );
}

function firstBlockedTaskId(
  plan: ReadyPlanningController,
  blocked: Set<string>,
): string | undefined {
  return plan.draft.tasks.find((task) => blocked.has(task.taskId))?.taskId;
}

function nextFocus(plan: ReadyPlanningController) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: plan.timezone });
  const workingTaskId = plan.date === today ? (plan.timer.record?.taskId ?? null) : null;
  const blocked = blockedTaskIds(plan);
  const actionable = unfinishedUnblockedTasks(plan, blocked);
  const executionInput = {
    sessions: plan.draft.sessions,
    taskBudgets: plan.draft.tasks,
    now: Date.now(),
    events: plan.fixed.filter((event) => event.blocksTime !== false),
    actionableTaskIds: actionable.map((task) => task.taskId),
    actual: plan.dayQ.data?.actual ?? [],
    activeTaskId: workingTaskId,
  };
  const execution = selectDailyExecution(executionInput);
  const remaining = new Set(remainingDailyTaskIds(executionInput));
  const available = actionable.filter((task) => remaining.has(task.taskId));
  const placed = new Set(
    plan.draft.sessions.flatMap((session) => session.allocations.map((part) => part.taskId)),
  );
  const taskId =
    workingTaskId ??
    execution.now?.taskId ??
    (execution.event ? null : available.find((task) => !placed.has(task.taskId))?.taskId);
  return {
    remaining,
    blockedTitle: firstBlockedTaskId(plan, blocked),
    taskId,
    title: focusTitle(plan, taskId, workingTaskId),
    event: execution.event,
    eventFirst: Boolean(execution.event),
    continueTask: Boolean(taskId && workingTaskId === taskId),
  };
}

type NextFocus = ReturnType<typeof nextFocus>;

function NextDescription({
  plan,
  next,
}: {
  readonly plan: ReadyPlanningController;
  readonly next: NextFocus;
}): JSX.Element {
  if (next.eventFirst && next.event)
    return (
      <p>
        {next.event.title} at {clock(next.event.startsAt, plan.timezone)}
      </p>
    );
  if (next.taskId) return <p>{next.title}</p>;
  if (next.blockedTitle)
    return <p>{plan.titleFor(next.blockedTitle)} is blocked by unfinished work.</p>;
  return <p>This plan has no remaining tasks.</p>;
}

function StartTaskAction({
  plan,
  next,
}: {
  readonly plan: ReadyPlanningController;
  readonly next: NextFocus;
}): JSX.Element | null {
  const [starting, setStarting] = useState(false);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: plan.timezone });
  if (next.eventFirst || !next.taskId || plan.date !== today) return null;
  const taskId = next.taskId;
  const label = `${next.continueTask ? 'Continue' : 'Start'} ${next.title}`;
  return (
    <Button
      className="h-auto min-h-10 max-w-full text-left whitespace-normal"
      disabled={starting}
      onClick={() => {
        void (async () => {
          setStarting(true);
          try {
            if (next.continueTask) {
              if (plan.timer.phase === 'paused') await plan.timerControls.resume();
            } else {
              await plan.timerControls.start({ taskId, label: plan.titleFor(taskId) });
            }
            window.location.assign('/focus');
          } catch {
            plan.setError('Could not start tracking. Your plan is still saved.');
            setStarting(false);
          }
        })();
      }}
    >
      {label}
    </Button>
  );
}

function GoToTodayAction({ plan }: { readonly plan: ReadyPlanningController }): JSX.Element {
  return (
    <Button
      variant="secondary"
      disabled={plan.confirming || plan.deferPending}
      onClick={() => {
        if (plan.confirming || plan.isMovingTask() || !plan.isCurrentDate()) return;
        // The shell transport can retain PlanRouteContent after clearing its day query.
        window.location.assign('/today');
      }}
    >
      Go to Today
    </Button>
  );
}

/** Offer an explicit start while leaving confirmation itself timer-free. */
export function ConfirmedStage({ plan }: { readonly plan: ReadyPlanningController }): JSX.Element {
  const next = nextFocus(plan);
  const upcoming = [
    ...plan.fixed.map((event) => ({
      id: `event-${event.startsAt}`,
      startsAt: event.startsAt,
      title: event.title,
      kind: 'Event',
    })),
    ...dailyAllocations(plan.draft.sessions)
      .filter((part) => next.remaining.has(part.taskId))
      .map((part) => ({
        id: `${part.sessionId}-${part.taskId}`,
        startsAt: part.startsAt,
        title: plan.titleFor(part.taskId),
        kind: 'Work',
      })),
  ]
    .filter((item) => Date.parse(item.startsAt) >= Date.now())
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .slice(0, 4);
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)]">
      <Card className="bg-primary-container min-w-0">
        <CardContent className="space-y-6 py-8">
          <span className="text-primary text-display-small" aria-hidden="true">
            ✳
          </span>
          <div className="space-y-2">
            <h2 className="text-on-primary-container text-title-large">Next</h2>
            <div className="text-on-primary-container text-body-large break-words">
              <NextDescription plan={plan} next={next} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <StartTaskAction plan={plan} next={next} />
            <GoToTodayAction plan={plan} />
            {plan.wasAdjustment && plan.previousAccepted ? (
              <Button
                variant="ghost"
                onClick={() => {
                  void plan.undoAdjustment();
                }}
              >
                Undo update
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
      <section className="min-w-0 space-y-3" aria-label="Upcoming agenda">
        <h2 className="text-title-large">Coming up</h2>
        {upcoming.length > 0 ? (
          <EntityList aria-label="Upcoming agenda">
            {upcoming.map((item) => (
              <EntityListRow
                key={item.id}
                interactive={false}
                title={item.title}
                leading={
                  <span className="text-on-surface-variant text-label-small w-16 tabular-nums">
                    {clock(item.startsAt, plan.timezone)}
                  </span>
                }
                trailing={
                  <span className="text-on-surface-variant text-label-small">{item.kind}</span>
                }
              />
            ))}
          </EntityList>
        ) : (
          <p className="text-on-surface-variant text-body-medium">No timed blocks are coming up.</p>
        )}
      </section>
    </div>
  );
}
