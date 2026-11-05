'use client';

/** Final screen after a person accepts or adjusts the day. */
import { Button, Card, CardContent, IconButton } from '@docket/ui/primitives';
import { EntityList, EntityListRow } from '@docket/ui/components';
import { Edit, Undo } from '@docket/ui/icons';
import { useState, type JSX } from 'react';
import {
  selectDailyExecution,
  remainingDailyTaskIds,
  dailyAllocations,
} from '@docket/planning/daily-plan-execution';

import CalendarItemDrawer from '@/components/calendar/calendar-item-drawer';
import Link from '@/components/docket-link';
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
    eventAllDay: plan.fixed.some((event) => event === execution.event && event.allDay),
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
        {next.event.title}
        {next.eventAllDay ? ' · All day' : ` at ${clock(next.event.startsAt, plan.timezone)}`}
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
      aria-label={label}
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
      {next.continueTask ? 'Continue working' : 'Start working'}
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

function AcceptedWork({ plan }: { readonly plan: ReadyPlanningController }): JSX.Element {
  const minutes = plan.draft.tasks.reduce((sum, task) => sum + task.plannedMinutes, 0);
  return (
    <section aria-label="Accepted work" className="min-w-0 space-y-3">
      <h2 className="text-title-medium">Planned work</h2>
      {plan.draft.tasks.length ? (
        <>
          <p className="text-body-small text-on-surface-variant">
            {plan.draft.tasks.length} {plan.draft.tasks.length === 1 ? 'task' : 'tasks'} ·{' '}
            <span>{minutes} min planned</span>
          </p>
          <EntityList aria-label="Accepted tasks">
            {plan.draft.tasks.map((task) => (
              <EntityListRow
                key={task.taskId}
                interactive={false}
                title={
                  <Link
                    href={`/orgs/${task.organizationId}/tasks/${task.taskId}`}
                    className="hover:underline"
                  >
                    {plan.titleFor(task.taskId)}
                  </Link>
                }
                subtitle={plan.allTasks.get(task.taskId)?.projectName ?? undefined}
                trailing={
                  <span className="text-body-small text-on-surface-variant">
                    {task.plannedMinutes} min
                  </span>
                }
              />
            ))}
          </EntityList>
        </>
      ) : (
        <p className="text-body-medium text-on-surface-variant">
          No work was selected for this day.
        </p>
      )}
    </section>
  );
}

function acceptedAgendaItems(plan: ReadyPlanningController, remaining: ReadonlySet<string>) {
  return [
    ...plan.fixed.map((event, index) => ({
      id: `event-${index}`,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      title: event.title,
      allDay: event.allDay,
      eventId: event.id,
      sessionId: undefined as string | undefined,
      taskId: undefined as string | undefined,
    })),
    ...dailyAllocations(plan.draft.sessions)
      .filter((part) => remaining.has(part.taskId))
      .map((part) => ({
        id: `${part.sessionId}-${part.taskId}`,
        startsAt: part.startsAt,
        endsAt: part.endsAt,
        title: plan.titleFor(part.taskId),
        allDay: false,
        eventId: undefined as string | undefined,
        sessionId: part.sessionId,
        taskId: part.taskId,
      })),
  ]
    .filter((item) => Date.parse(item.endsAt) > Date.now())
    .sort((left, right) => left.startsAt.localeCompare(right.startsAt));
}

function AcceptedAgenda({
  plan,
  remaining,
}: {
  readonly plan: ReadyPlanningController;
  readonly remaining: ReadonlySet<string>;
}): JSX.Element {
  const [eventId, setEventId] = useState<string | null>(null);
  const entries = acceptedAgendaItems(plan, remaining);
  return (
    <section aria-label="Upcoming agenda" className="min-w-0 space-y-3">
      <h2 className="text-title-medium">Coming up</h2>
      {entries.length ? (
        <EntityList aria-label="Accepted day agenda">
          {entries.map((item) => (
            <EntityListRow
              key={item.id}
              interactive={false}
              title={
                item.eventId || item.taskId ? (
                  <Button
                    variant="link"
                    className="h-auto min-h-10 w-full justify-start px-0 text-left whitespace-normal"
                    onClick={() => {
                      if (item.eventId) setEventId(item.eventId);
                      else if (item.taskId) {
                        plan.setStage('plan');
                        plan.setEditing({
                          taskId: item.taskId,
                          ...(item.sessionId ? { sessionId: item.sessionId } : {}),
                        });
                      }
                    }}
                  >
                    {item.title}
                  </Button>
                ) : (
                  item.title
                )
              }
              leading={
                <span className="text-body-small text-on-surface-variant w-16 tabular-nums">
                  {item.allDay ? 'All day' : clock(item.startsAt, plan.timezone)}
                </span>
              }
            />
          ))}
        </EntityList>
      ) : (
        <p className="text-body-medium text-on-surface-variant">
          No calendar events or work blocks are scheduled.
        </p>
      )}
      {eventId ? (
        <CalendarItemDrawer
          itemId={eventId}
          displayTimezone={plan.timezone}
          onClose={() => {
            setEventId(null);
            void plan.dayQ.refetch();
          }}
          onOpenTask={(orgId, taskId) => {
            window.location.assign(`/orgs/${orgId}/tasks/${taskId}`);
          }}
        />
      ) : null}
    </section>
  );
}

function ConfirmationActions({
  plan,
  next,
}: {
  readonly plan: ReadyPlanningController;
  readonly next: NextFocus;
}): JSX.Element {
  return (
    <div className="flex flex-wrap gap-2">
      <StartTaskAction plan={plan} next={next} />
      <GoToTodayAction plan={plan} />
      <IconButton
        label="Adjust plan"
        onClick={() => {
          plan.setStage('plan');
        }}
      >
        <Edit />
      </IconButton>
      {plan.wasAdjustment && plan.previousAccepted ? (
        <IconButton
          label="Undo update"
          onClick={() => {
            void plan.undoAdjustment();
          }}
        >
          <Undo />
        </IconButton>
      ) : null}
    </div>
  );
}

/** Show the accepted day and offer an explicit start while leaving confirmation timer-free. */
export function ConfirmedStage({ plan }: { readonly plan: ReadyPlanningController }): JSX.Element {
  const next = nextFocus(plan);
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-6">
        <Card>
          <CardContent className="space-y-3 p-4 sm:p-5">
            <h2 className="text-label-large text-on-surface-variant">
              {next.continueTask
                ? 'Current session'
                : plan.draft.tasks.length
                  ? 'Next'
                  : 'Day kept clear'}
            </h2>
            <div className="text-title-large">
              <NextDescription plan={plan} next={next} />
            </div>
            <ConfirmationActions plan={plan} next={next} />
          </CardContent>
        </Card>
        <AcceptedWork plan={plan} />
      </div>
      <AcceptedAgenda plan={plan} remaining={next.remaining} />
    </div>
  );
}
