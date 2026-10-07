'use client';

/** One retrospective before choosing today's work. */
import { Button, Card, CardContent, CardHeader, CardTitle, Select } from '@docket/ui/primitives';
import { addDays } from '@docket/planning/zoned-time';
import type { DailyPlanSnapshot } from '@docket/planning/daily-plan-flow';
import { DatePicker, formatDay } from '@/components/date-picker';
import type { JSX } from 'react';

import type { DayData, ReadyPlanningController, Task } from './daily-planning-controller';

type ReviewTask = Pick<Task, 'taskId' | 'title' | 'organizationId' | 'planItemId'> & {
  plannedDate?: string;
};

function reviewChoice(plan: ReadyPlanningController, taskId: string) {
  return (
    plan.reviewChoices[taskId] ??
    (plan.draft.tasks.some((task) => task.taskId === taskId) ? 'today' : 'backlog')
  );
}

function ReviewRow({
  plan,
  task,
  targetLabel,
}: {
  readonly plan: ReadyPlanningController;
  readonly task: ReviewTask;
  readonly targetLabel: string;
}): JSX.Element {
  const choice = reviewChoice(plan, task.taskId);
  return (
    <Card className="bg-surface-container-low">
      <CardContent className="flex flex-wrap items-center justify-between gap-2 p-3">
        <span className="min-w-0 basis-full sm:flex-1 sm:basis-0">
          {task.title}
          {task.plannedDate && task.plannedDate !== plan.previousDate ? (
            <span className="text-on-surface-variant text-label-small ml-2">
              {task.plannedDate}
            </span>
          ) : null}
        </span>
        <div className="w-36 shrink-0">
          <Select
            aria-label={`Decision for ${task.title}`}
            value={choice}
            onChange={(event) => {
              plan.setReviewChoices((current) => ({
                ...current,
                [task.taskId]: event.target.value as 'today' | 'backlog' | 'done' | 'another',
              }));
            }}
          >
            <option value="today">{targetLabel}</option>
            <option value="backlog">Backlog</option>
            <option value="another">Another date</option>
            {task.planItemId ? <option value="done">Done</option> : null}
          </Select>
        </div>
        {choice === 'another' ? (
          <DatePicker
            ariaLabel={`New date for ${task.title}`}
            placeholder="Choose a date"
            triggerVariant="secondary"
            min={addDays(plan.date, 1)}
            value={plan.reviewDates[task.taskId] ?? null}
            onChange={(value) => {
              plan.setReviewDates((current) => ({ ...current, [task.taskId]: value ?? '' }));
            }}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

function reviewedDraft(
  plan: ReadyPlanningController,
  unfinished: DayData['carryover'],
): DailyPlanSnapshot {
  const retainedIds = new Set(
    unfinished
      .filter((task) => reviewChoice(plan, task.taskId) === 'today')
      .map((task) => task.taskId),
  );
  const removedIds = new Set(
    unfinished.filter((task) => !retainedIds.has(task.taskId)).map((task) => task.taskId),
  );
  const kept = plan.draft.tasks.filter((task) => !removedIds.has(task.taskId));
  const additions = unfinished.filter(
    (task) => retainedIds.has(task.taskId) && !kept.some((item) => item.taskId === task.taskId),
  );
  return {
    ...plan.draft,
    mainTaskId: removedIds.has(plan.draft.mainTaskId ?? '') ? null : plan.draft.mainTaskId,
    settings: {
      ...plan.draft.settings,
      excludedTaskIds: [
        ...new Set([...(plan.draft.settings?.excludedTaskIds ?? []), ...removedIds]),
      ].filter((id) => !retainedIds.has(id)),
    },
    tasks: [
      ...kept,
      ...additions.map((task) => ({
        taskId: task.taskId,
        organizationId: task.organizationId,
        plannedMinutes: 45,
        sort: 0,
        durationSource: 'default' as const,
        selectionSource: 'explicit' as const,
      })),
    ].map((task, sort) => ({ ...task, sort })),
    sessions: plan.draft.sessions
      .map((session) => ({
        ...session,
        allocations: session.allocations.filter((part) => !removedIds.has(part.taskId)),
      }))
      .filter((session) => session.allocations.length > 0),
  };
}

async function finishYesterdayReview(
  plan: ReadyPlanningController,
  unfinished: DayData['carryover'],
): Promise<void> {
  try {
    for (const task of unfinished) {
      if (reviewChoice(plan, task.taskId) === 'done' && task.planItemId) {
        await plan.completeReview.mutateAsync(task.planItemId);
      }
    }
    await plan.applyReview.mutateAsync(
      unfinished.map((task) => ({
        planItemId: task.planItemId,
        action: reviewChoice(plan, task.taskId),
        ...(reviewChoice(plan, task.taskId) === 'another'
          ? { targetDate: plan.reviewDates[task.taskId] }
          : {}),
      })),
    );
    const next = reviewedDraft(plan, unfinished);
    plan.editDraft(next);
    await plan.go('plan', next);
  } catch {
    plan.setError('Could not finish this day’s review. Try again.');
  }
}

function ReviewActions({
  plan,
  unfinished,
  targetLabel,
}: {
  readonly plan: ReadyPlanningController;
  readonly unfinished: DayData['carryover'];
  readonly targetLabel: string;
}): JSX.Element {
  return (
    <div className="flex flex-wrap gap-2">
      {unfinished.length > 0 ? (
        <Button
          variant="secondary"
          onClick={() => {
            plan.setReviewChoices(
              Object.fromEntries(unfinished.map((task) => [task.taskId, 'today'])),
            );
          }}
        >
          Move all to {targetLabel.toLowerCase()}
        </Button>
      ) : null}
      <Button
        variant="ghost"
        onClick={() => {
          void plan.go('plan');
        }}
      >
        Skip
      </Button>
      <Button
        disabled={
          plan.completeReview.isPending ||
          plan.applyReview.isPending ||
          unfinished.some(
            (task) =>
              reviewChoice(plan, task.taskId) === 'another' &&
              (plan.reviewDates[task.taskId] ?? '') <= plan.date,
          )
        }
        onClick={() => {
          void finishYesterdayReview(plan, unfinished);
        }}
      >
        Continue
      </Button>
    </div>
  );
}

/** Show recorded work and let unfinished commitments move to the new draft. */
export function YesterdayStage({ plan }: { readonly plan: ReadyPlanningController }): JSX.Element {
  const previous = plan.previousQ.data;
  const unfinished =
    plan.dayQ.data?.carryover.filter(
      (task) =>
        plan.dayReview || !plan.draft.tasks.some((selected) => selected.taskId === task.taskId),
    ) ?? [];
  const recorded =
    previous?.actual.reduce((sum, interval) => sum + interval.recordedMinutes, 0) ?? 0;
  const completed = previous?.tasks.filter((task) => task.completedAt !== null) ?? [];
  const today = new Date().toLocaleDateString('en-CA', { timeZone: plan.timezone });
  const targetLabel = plan.date === addDays(today, 1) ? 'Tomorrow' : 'Today';
  return (
    <section className="max-w-3xl space-y-5">
      <p className="text-on-surface-variant">
        {formatDay(plan.previousDate, {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
        })}
      </p>
      <Card>
        <CardHeader>
          <CardTitle>
            {plan.reviewLabel === 'Review today' ? 'Work from today' : 'Work from yesterday'}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>{recorded ? `${recorded} minutes recorded` : 'No time recorded.'}</p>
          {completed.map((task) => (
            <p key={task.taskId}>✓ {task.title}</p>
          ))}
          {unfinished.length === 0 ? (
            <p>No unfinished tasks.</p>
          ) : (
            <>
              <h3 className="text-label-medium">Unfinished work</h3>
              {unfinished.map((task) => (
                <ReviewRow key={task.taskId} plan={plan} task={task} targetLabel={targetLabel} />
              ))}
            </>
          )}
        </CardContent>
      </Card>
      <ReviewActions plan={plan} unfinished={unfinished} targetLabel={targetLabel} />
    </section>
  );
}
