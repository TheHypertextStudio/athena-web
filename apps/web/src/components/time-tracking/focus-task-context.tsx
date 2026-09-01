'use client';

/** Task metadata and progress shared by both Focus surfaces. */
import type { TaskDetail } from '@docket/work/task-model';
import type { WorkflowState } from '@docket/work/workflow';
import { Text } from '@docket/ui/primitives';
import type { JSX } from 'react';

import { formatDay } from '@/components/date-picker';
import { PRIORITY_LABEL } from '@/components/task-detail/priority';
import { todayISODate } from '@/lib/today';

/** Props for {@link FocusTaskContext}. */
export interface FocusTaskContextProps {
  readonly task: TaskDetail;
  readonly workflowState: WorkflowState | null;
  readonly workflowStates?: readonly WorkflowState[];
  /** Immersive mode also shows the task description and individual subtasks. */
  readonly expanded?: boolean;
}

/** Convert a due date to the shortest truthful focus label. */
function dueLabel(dueDate: string | null | undefined): string | null {
  if (!dueDate) return null;
  const today = todayISODate();
  if (dueDate === today) return 'Due today';
  if (dueDate < today)
    return `Due ${formatDay(dueDate, { month: 'short', day: 'numeric' }) ?? dueDate}`;
  return `Due ${formatDay(dueDate, { month: 'short', day: 'numeric' }) ?? dueDate}`;
}

/** Present workflow state, priority, date, description, and subtask progress without filler. */
export default function FocusTaskContext({
  task,
  workflowState,
  workflowStates = [],
  expanded = false,
}: FocusTaskContextProps): JSX.Element {
  const workflowAvailable = workflowStates.length > 0;
  const isComplete = (key: string): boolean | null => {
    const type = workflowStates.find((state) => state.key === key)?.type;
    if (!type) return null;
    return type === 'completed' || type === 'canceled';
  };
  const completed = task.subtasks.filter((subtask) => isComplete(subtask.state) === true).length;
  const metadata = [
    workflowState?.name ?? null,
    task.priority === 'none' ? null : `${PRIORITY_LABEL[task.priority]} priority`,
    dueLabel(task.dueDate),
  ].filter((value): value is string => Boolean(value));

  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="focus-task-context">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {metadata.map((item, index) => (
          <span key={item} className="flex items-center gap-2">
            {index > 0 ? (
              <span aria-hidden="true" className="text-outline text-body-small">
                ·
              </span>
            ) : null}
            <Text token="body-small" tone={index === 0 ? undefined : 'muted'}>
              {item}
            </Text>
          </span>
        ))}
      </div>

      {task.description ? (
        expanded ? (
          <p className="text-on-surface text-body-medium max-w-prose whitespace-pre-wrap">
            {task.description}
          </p>
        ) : (
          <p className="text-on-surface-variant text-body-small line-clamp-2 whitespace-pre-wrap">
            {task.description}
          </p>
        )
      ) : null}

      {task.subtasks.length > 0 ? (
        expanded ? (
          <div className="border-outline-variant/40 flex flex-col gap-2 border-t pt-4">
            <Text token="label-large">Subtasks</Text>
            <ul className="flex flex-col gap-2">
              {task.subtasks.map((subtask) => {
                const done = isComplete(subtask.state);
                return (
                  <li key={subtask.id} className="flex min-w-0 items-center gap-2">
                    <span
                      aria-hidden="true"
                      className={
                        done === true
                          ? 'bg-primary size-2 rounded-full'
                          : done === false
                            ? 'border-outline size-2 rounded-full border'
                            : 'bg-outline size-1.5 rounded-full'
                      }
                    />
                    <span
                      className={
                        done === true
                          ? 'text-on-surface-variant text-body-medium line-through'
                          : 'text-on-surface text-body-medium'
                      }
                    >
                      {subtask.title}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <Text token="body-small" tone="muted">
            {workflowAvailable
              ? `${String(completed)} of ${String(task.subtasks.length)} subtasks`
              : `${String(task.subtasks.length)} subtasks`}
          </Text>
        )
      ) : null}
    </div>
  );
}
