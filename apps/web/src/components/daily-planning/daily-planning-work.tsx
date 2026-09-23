'use client';

/** Compact, directly editable work rows shared by planning and review. */
import { instantAt } from '@docket/planning/zoned-time';
import { GripVertical, OpenInNew, Schedule, X } from '@docket/ui/icons';
import { Button, Card, CardContent, Input, Select, Text } from '@docket/ui/primitives';
import Link from '@/components/docket-link';
import { EditableTitle } from '@/components/editor/editable-title';
import { useDraggable } from '@/components/dnd/use-draggable';
import type { DailyPlanTask } from '@docket/planning/daily-plan-flow';
import type { JSX } from 'react';

import type { ReadyPlanningController } from './daily-planning-controller';
import { clockValue } from './daily-planning-agenda';
import { remainingMinutes, setPlannedMinutes } from './daily-planning-model';

function WorkRowActions({
  plan,
  entry,
  title,
  remaining,
}: {
  readonly plan: ReadyPlanningController;
  readonly entry: DailyPlanTask;
  readonly title: string;
  readonly remaining: number;
}): JSX.Element {
  return (
    <>
      <div className="flex shrink-0 gap-0.5">
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          disabled={remaining === 0}
          aria-label={`Schedule ${title}`}
          onClick={() => {
            plan.setEditing({ taskId: entry.taskId });
          }}
        >
          <Schedule aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          aria-label={`Remove ${title} from today`}
          onClick={() => {
            plan.removeTask(entry.taskId);
          }}
        >
          <X aria-hidden="true" />
        </Button>
        <Button asChild variant="ghost" size="sm" iconOnly>
          <Link
            href={`/orgs/${entry.organizationId}/tasks/${entry.taskId}`}
            aria-label={`Open ${title} details`}
          >
            <OpenInNew aria-hidden="true" />
          </Link>
        </Button>
      </div>
      {plan.failedTitle?.taskId === entry.taskId ? (
        <Button
          size="sm"
          onClick={() => {
            void plan.renameTask(entry, plan.failedTitle?.title ?? title);
          }}
        >
          Retry rename
        </Button>
      ) : null}
    </>
  );
}

function WorkRow({
  plan,
  entry,
}: {
  readonly plan: ReadyPlanningController;
  readonly entry: DailyPlanTask;
}): JSX.Element {
  const title = plan.titleFor(entry.taskId);
  const task = plan.allTasks.get(entry.taskId);
  const remaining = remainingMinutes(plan.draft, entry.taskId);
  const durationOptions = [...new Set([entry.plannedMinutes, 15, 30, 45, 60, 90, 120, 180])].sort(
    (a, b) => a - b,
  );
  const drag = useDraggable({
    object: { kind: 'task', id: entry.taskId, organizationId: entry.organizationId, title },
    actionScope: 'all',
    surfaceId: 'daily-planning',
    disabled: remaining === 0,
  });
  return (
    <Card>
      <CardContent className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 py-2">
        <Button
          ref={drag.ref}
          variant="ghost"
          size="sm"
          iconOnly
          className={drag.className}
          data-object-id={entry.taskId}
          data-drag-state={drag['data-drag-state']}
          aria-label={`Drag ${title} to agenda`}
          disabled={remaining === 0}
        >
          <GripVertical aria-hidden="true" />
        </Button>
        <div className="min-w-0 flex-1">
          <EditableTitle
            value={title}
            onSave={(value) => {
              void plan.renameTask(entry, value);
            }}
            canEdit
            ariaLabel={`Task title: ${title}`}
            className="text-on-surface text-title-small"
          />
          {task?.completedAt ? (
            <span className="text-on-surface-variant text-label-small">Completed</span>
          ) : null}
        </div>
        <label
          className="text-on-surface-variant text-body-small w-20 shrink-0"
          title="Planned time"
        >
          <span className="sr-only">Planned time</span>
          <Select
            aria-label={`Planned time for ${title}`}
            value={entry.plannedMinutes}
            onChange={(event) => {
              plan.editDraft(
                setPlannedMinutes(plan.draft, entry.taskId, Number(event.target.value)),
              );
            }}
          >
            {durationOptions.map((minutes) => (
              <option key={minutes} value={minutes}>
                {minutes}m
              </option>
            ))}
          </Select>
        </label>
        <WorkRowActions plan={plan} entry={entry} title={title} remaining={remaining} />
      </CardContent>
    </Card>
  );
}

function WorkSignals({ plan }: { readonly plan: ReadyPlanningController }): JSX.Element {
  const actual = plan.dayQ.data?.actual ?? [];
  const recorded = actual.reduce((sum, interval) => sum + interval.recordedMinutes, 0);
  return (
    <>
      {recorded > 0 ? (
        <p className="text-on-surface-variant text-body-small">{recorded} minutes recorded today</p>
      ) : null}
      {plan.timer.phase === 'running' && plan.timer.record ? (
        <p className="text-on-surface-variant text-body-small">
          Tracking{' '}
          {plan.timer.record.taskId ? plan.titleFor(plan.timer.record.taskId) : plan.timer.title}
        </p>
      ) : null}
      {plan.total > plan.capacity ? (
        <Text as="p" token="body-medium" tone="error">
          {plan.total - plan.capacity} minutes over capacity
        </Text>
      ) : (
        <p className="text-on-surface-variant text-body-small">
          {plan.total} minutes planned · {plan.capacity} minutes available
        </p>
      )}
    </>
  );
}

/** Edit chosen work while the agenda stays visible beside it. */
export function WorkColumn({ plan }: { readonly plan: ReadyPlanningController }): JSX.Element {
  const completed = plan.dayQ.data?.tasks.filter((task) => task.completedAt !== null) ?? [];
  return (
    <section
      className={
        plan.stage === 'review' ? 'order-1 min-w-0 space-y-4 lg:order-2' : 'min-w-0 space-y-4'
      }
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-title-large">Work</h2>
        {plan.stage === 'plan' ? (
          <Button
            variant="secondary"
            onClick={() => {
              plan.setStage('add');
            }}
          >
            Add work
          </Button>
        ) : null}
      </div>
      <WorkSignals plan={plan} />
      <p className="text-on-surface-variant text-label-small text-right">Planned time</p>
      <div className="space-y-2">
        {plan.draft.tasks.length === 0 ? (
          <Card>
            <CardContent className="pt-5">No tasks selected.</CardContent>
          </Card>
        ) : (
          plan.draft.tasks.map((entry) => <WorkRow key={entry.taskId} plan={plan} entry={entry} />)
        )}
      </div>
      {completed.length > 0 ? (
        <div className="space-y-1">
          <h3 className="text-label-medium">Completed today</h3>
          {completed.map((task) => (
            <p key={task.taskId} className="text-on-surface-variant text-body-small">
              ✓ {task.title}
            </p>
          ))}
        </div>
      ) : null}
      <label className="text-on-surface-variant text-body-small flex items-center justify-between gap-3">
        Finish work at
        <Input
          className="w-28"
          type="time"
          value={clockValue(plan.draft.finishAt, plan.timezone)}
          onChange={(event) => {
            const [hours, minutes] = event.target.value.split(':').map(Number);
            plan.editDraft({
              ...plan.draft,
              finishAt: instantAt(
                plan.date,
                (hours ?? 17) * 60 + (minutes ?? 0),
                plan.timezone,
              ).toISOString(),
            });
          }}
        />
      </label>
    </section>
  );
}
