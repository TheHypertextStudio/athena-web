'use client';

/** Compact, directly editable work rows shared by planning and review. */
import { Ellipsis, GripVertical } from '@docket/ui/icons';
import { EntityList, EntityListRow } from '@docket/ui/components';
import {
  Button,
  Card,
  CardContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
} from '@docket/ui/primitives';
import { useEffect, useState } from 'react';
import Link from '@/components/docket-link';
import { EditableTitle } from '@/components/editor/editable-title';
import { useDraggable } from '@/components/dnd/use-draggable';
import type { DailyPlanTask } from '@docket/planning/daily-plan-flow';
import type { JSX } from 'react';

import type { ReadyPlanningController } from './daily-planning-controller';
import { movePlannedTask, unplacedMinutes, setPlannedMinutes } from './daily-planning-model';
import { useWorkRowDropTarget } from '@/components/dnd';

function WorkSchedulingActions({
  plan,
  entry,
  remaining,
}: {
  readonly plan: ReadyPlanningController;
  readonly entry: DailyPlanTask;
  readonly remaining: number;
}): JSX.Element {
  const session = plan.draft.sessions.find((value) =>
    value.allocations.some((part) => part.taskId === entry.taskId),
  );
  return (
    <>
      {session ? (
        <DropdownMenuItem
          className="coarse:min-h-10"
          onSelect={() => {
            plan.setEditing({ taskId: entry.taskId, sessionId: session.id });
          }}
        >
          Move block
        </DropdownMenuItem>
      ) : null}
      {remaining > 0 ? (
        <DropdownMenuItem
          className="coarse:min-h-10"
          onSelect={() => {
            plan.setEditing({ taskId: entry.taskId });
          }}
        >
          {session ? 'Add session' : 'Schedule'}
        </DropdownMenuItem>
      ) : null}
    </>
  );
}

function WorkRowMenu({
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
  const index = plan.draft.tasks.findIndex((task) => task.taskId === entry.taskId);
  const previous = plan.draft.tasks[index - 1];
  const next = plan.draft.tasks[index + 1];
  const reorder = (targetId: string, placement: 'before' | 'after'): void => {
    plan.editDraft(movePlannedTask(plan.draft, entry.taskId, targetId, placement));
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          className="min-h-10 min-w-10 sm:min-h-8 sm:min-w-8"
          aria-label={`Actions for ${title}`}
        >
          <Ellipsis aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" width="md">
        <WorkSchedulingActions plan={plan} entry={entry} remaining={remaining} />
        {previous ? (
          <DropdownMenuItem
            onSelect={() => {
              reorder(previous.taskId, 'before');
            }}
          >
            Move earlier
          </DropdownMenuItem>
        ) : null}
        {next ? (
          <DropdownMenuItem
            onSelect={() => {
              reorder(next.taskId, 'after');
            }}
          >
            Move later
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem asChild>
          <Link href={`/orgs/${entry.organizationId}/tasks/${entry.taskId}`}>
            Open task details
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            plan.removeTask(entry.taskId);
          }}
        >
          Remove from today
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function WorkRowContents({
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
  const projectName = plan.allTasks.get(entry.taskId)?.projectName;
  return (
    <span className="flex w-full min-w-0 flex-wrap items-center gap-1">
      <span className="min-w-0 flex-1">
        <WorkRowTitle plan={plan} entry={entry} title={title} />
      </span>
      <PlannedTime plan={plan} entry={entry} title={title} />
      <WorkRowMenu plan={plan} entry={entry} title={title} remaining={remaining} />
      {projectName || entry.selectionSource === 'suggested' ? (
        <span className="text-on-surface-variant text-body-small min-w-0 basis-full truncate">
          {projectName ?? ''}
          {entry.selectionSource === 'suggested'
            ? `${projectName ? ' · ' : ''}${plan.proposalContext?.tasks.find((value) => value.taskId === entry.taskId)?.reason ?? 'Suggested'}`
            : ''}
        </span>
      ) : null}
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
    </span>
  );
}

function WorkRowTitle({
  plan,
  entry,
  title,
}: {
  readonly plan: ReadyPlanningController;
  readonly entry: DailyPlanTask;
  readonly title: string;
}): JSX.Element {
  return (
    <EditableTitle
      value={title}
      onSave={(value) => {
        void plan.renameTask(entry, value);
      }}
      canEdit
      ariaLabel={`Task title: ${title}`}
      className="text-on-surface text-label-medium sm:text-label-large min-h-10 min-w-0 flex-1 py-2.5 sm:min-h-8 sm:py-1.5"
    />
  );
}

function PlannedTime({
  plan,
  entry,
  title,
}: {
  readonly plan: ReadyPlanningController;
  readonly entry: DailyPlanTask;
  readonly title: string;
}): JSX.Element {
  const [value, setValue] = useState(String(entry.plannedMinutes));
  useEffect(() => {
    setValue(String(entry.plannedMinutes));
  }, [entry.plannedMinutes]);
  const commit = (text: string): void => {
    const minutes = Number(text);
    if (!Number.isInteger(minutes) || minutes < 1) {
      setValue(String(entry.plannedMinutes));
      return;
    }
    if (minutes !== entry.plannedMinutes) {
      const next = setPlannedMinutes(plan.draft, entry.taskId, minutes);
      const kept =
        next.tasks.find((task) => task.taskId === entry.taskId)?.plannedMinutes ?? minutes;
      setValue(String(kept));
      plan.editDraft(next);
      if (kept > minutes)
        plan.setError(
          `${kept} minutes are in pinned or elapsed blocks. Remove or unpin future blocks before reducing this time.`,
        );
    }
  };
  return (
    <label className="text-on-surface-variant text-body-small inline-flex shrink-0 items-center gap-1 tabular-nums">
      <Input
        type="number"
        min={1}
        step={1}
        inputMode="numeric"
        variant="outlined"
        controlSize="sm"
        className="min-h-10 w-12 px-1.5 text-right tabular-nums sm:min-h-8"
        aria-label={`Planned time for ${title}`}
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
        }}
        onBlur={(event) => {
          commit(event.currentTarget.value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            setValue(String(entry.plannedMinutes));
            event.currentTarget.value = String(entry.plannedMinutes);
            event.currentTarget.blur();
          }
        }}
      />
      <span aria-hidden="true">min</span>
    </label>
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
  const remaining = unplacedMinutes(plan.draft, entry.taskId, plan.dayQ.data?.actual ?? []);
  const drag = useDraggable({
    object: { kind: 'task', id: entry.taskId, organizationId: entry.organizationId, title },
    actionScope: 'all',
    surfaceId: 'daily-planning',
  });
  const drop = useWorkRowDropTarget({
    taskId: entry.taskId,
    title,
    onReorder: (taskId, targetId, placement) => {
      plan.editDraft(movePlannedTask(plan.draft, taskId, targetId, placement));
    },
  });
  return (
    <Card
      variant="outlined"
      ref={drop.ref}
      data-drop-state={drop.isOver ? 'accept' : 'idle'}
      data-drop-placement={drop.isOver ? drop.placement : undefined}
      className={`hover:bg-surface-container-high relative rounded-xl transition-[background-color,opacity] duration-(--dur-fast) ${drag['data-drag-state'] === 'dragging' ? 'opacity-45' : ''} ${drop.isOver ? `bg-secondary-container before:bg-primary before:absolute before:right-3 before:left-3 before:z-10 before:h-1 before:rounded-full ${drop.placement === 'before' ? 'before:-top-1.5' : 'before:-bottom-1.5'}` : ''}`}
    >
      <EntityListRow
        interactive={false}
        className="min-w-0 gap-1 px-2 py-1"
        leading={
          <Button
            ref={drag.ref}
            variant="ghost"
            size="sm"
            iconOnly
            className={`${drag.className} coarse:min-w-10 min-h-10 min-w-10 sm:min-h-8 sm:min-w-6`}
            data-object-id={entry.taskId}
            data-drag-state={drag['data-drag-state']}
            aria-label={`Drag ${title} to reorder or schedule`}
          >
            <GripVertical aria-hidden="true" />
          </Button>
        }
        title={<WorkRowContents plan={plan} entry={entry} title={title} remaining={remaining} />}
      />
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
    </>
  );
}

/** Edit chosen work while the agenda stays visible beside it. */
export function WorkColumn({ plan }: { readonly plan: ReadyPlanningController }): JSX.Element {
  const completed = plan.dayQ.data?.tasks.filter((task) => task.completedAt !== null) ?? [];
  return (
    <section className="min-w-0 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-title-large">Work</h2>
        {plan.stage !== 'confirmed' ? (
          <Button
            variant="secondary"
            disabled={plan.deferPending}
            onClick={() => {
              plan.setStage('add');
            }}
          >
            Add work
          </Button>
        ) : null}
      </div>
      <WorkSignals plan={plan} />
      <div>
        {plan.draft.tasks.length === 0 ? (
          <Card>
            <CardContent className="pt-5">
              No work selected. Add work to build this plan.
            </CardContent>
          </Card>
        ) : (
          <EntityList aria-label="Work selected for today" className="gap-2 bg-transparent p-0">
            {plan.draft.tasks.map((entry) => (
              <WorkRow key={entry.taskId} plan={plan} entry={entry} />
            ))}
          </EntityList>
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
    </section>
  );
}
