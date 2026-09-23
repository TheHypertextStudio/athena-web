'use client';

/** One retrospective before choosing today's work. */
import { Button, Card, CardContent, CardHeader, CardTitle, Select } from '@docket/ui/primitives';
import { addDays } from '@docket/planning/zoned-time';
import { DatePicker, formatDay } from '@/components/date-picker';
import type { JSX } from 'react';

import type { DayData, ReadyPlanningController, Task } from './daily-planning-controller';

type ReviewTask = Pick<Task, 'taskId' | 'title' | 'organizationId' | 'planItemId'> & {
  plannedDate?: string;
};

function ReviewRow({
  plan,
  task,
}: {
  readonly plan: ReadyPlanningController;
  readonly task: ReviewTask;
}): JSX.Element {
  const choice = plan.reviewChoices[task.taskId] ?? 'backlog';
  return (
    <div className="bg-surface-container-low flex flex-wrap items-center justify-between gap-3 rounded-xl p-3">
      <span>
        {task.title}
        {task.plannedDate && task.plannedDate !== plan.previousDate ? (
          <span className="text-on-surface-variant text-label-small ml-2">{task.plannedDate}</span>
        ) : null}
      </span>
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
        <option value="today">Today</option>
        <option value="backlog">Backlog</option>
        <option value="another">Another date</option>
        {task.planItemId ? <option value="done">Done</option> : null}
      </Select>
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
    </div>
  );
}

async function finishYesterdayReview(
  plan: ReadyPlanningController,
  unfinished: DayData['carryover'],
): Promise<void> {
  try {
    for (const task of unfinished) {
      if (plan.reviewChoices[task.taskId] === 'done' && task.planItemId) {
        await plan.completeReview.mutateAsync(task.planItemId);
      }
    }
    await plan.applyReview.mutateAsync(
      unfinished.map((task) => ({
        planItemId: task.planItemId,
        action: plan.reviewChoices[task.taskId] ?? 'backlog',
        ...(plan.reviewChoices[task.taskId] === 'another'
          ? { targetDate: plan.reviewDates[task.taskId] }
          : {}),
      })),
    );
    const additions = unfinished.filter(
      (task) =>
        plan.reviewChoices[task.taskId] === 'today' &&
        !plan.draft.tasks.some((item) => item.taskId === task.taskId),
    );
    const next = {
      ...plan.draft,
      tasks: [
        ...plan.draft.tasks,
        ...additions.map((task, index) => ({
          taskId: task.taskId,
          organizationId: task.organizationId,
          plannedMinutes: 45,
          sort: plan.draft.tasks.length + index,
        })),
      ],
    };
    plan.editDraft(next);
    await plan.go('plan', next);
  } catch {
    plan.setError('Could not finish yesterday’s review. Try again.');
  }
}

/** Show recorded work and let unfinished commitments move to the new draft. */
export function YesterdayStage({ plan }: { readonly plan: ReadyPlanningController }): JSX.Element {
  const previous = plan.previousQ.data;
  const unfinished =
    plan.dayQ.data?.carryover.filter(
      (task) => !plan.draft.tasks.some((selected) => selected.taskId === task.taskId),
    ) ?? [];
  const recorded =
    previous?.actual.reduce((sum, interval) => sum + interval.recordedMinutes, 0) ?? 0;
  const completed = previous?.tasks.filter((task) => task.completedAt !== null) ?? [];
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
          <CardTitle>Work from yesterday</CardTitle>
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
                <ReviewRow key={task.taskId} plan={plan} task={task} />
              ))}
            </>
          )}
        </CardContent>
      </Card>
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
            Move all to today
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
                plan.reviewChoices[task.taskId] === 'another' &&
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
    </section>
  );
}
