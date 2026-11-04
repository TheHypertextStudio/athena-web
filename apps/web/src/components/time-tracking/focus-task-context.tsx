'use client';

/** Task metadata and progress shared by both Focus surfaces. */
import type { TaskDetail } from '@docket/work/task-model';
import type { WorkflowState } from '@docket/work/workflow';
import { Button, Text } from '@docket/ui/primitives';
import type { JSX } from 'react';

import Link from '@/components/docket-link';
import { StaticMarkdown } from '@/components/editor/static-markdown';
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
  readonly project?: { id: string; name: string } | null | undefined;
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
  project = null,
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

      <FocusDetails task={task} expanded={expanded} project={project} />

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
                      <Link
                        href={`/orgs/${task.organizationId}/tasks/${subtask.id}`}
                        className="hover:underline"
                      >
                        {subtask.title}
                      </Link>
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

function FocusDescription({
  task,
  expanded,
}: {
  readonly task: TaskDetail;
  readonly expanded: boolean;
}): JSX.Element | null {
  if (task.description)
    return expanded ? (
      <StaticMarkdown value={task.description} className="max-w-prose" />
    ) : (
      <p className="text-body-small text-on-surface-variant line-clamp-2 whitespace-pre-wrap">
        {task.description}
      </p>
    );
  return expanded ? (
    <Button variant="ghost" className="w-fit" asChild>
      <Link href={`/orgs/${task.organizationId}/tasks/${task.id}`}>Add task details</Link>
    </Button>
  ) : null;
}

function FocusRelations({ task }: { readonly task: TaskDetail }): JSX.Element {
  const groups = [
    { label: 'Blocked by', tasks: task.blockedBy },
    { label: 'Unblocks', tasks: task.blocking },
    { label: 'Related work', tasks: task.relatedTasks },
  ].filter((group) => group.tasks.length > 0);
  return (
    <>
      {groups.map((group) => (
        <section key={group.label} className="space-y-2">
          <h3 className="text-label-large">{group.label}</h3>
          <ul className="space-y-2">
            {group.tasks.map((ref) => (
              <li key={ref.id}>
                <Link
                  className="text-body-medium text-primary hover:underline"
                  href={`/orgs/${task.organizationId}/tasks/${ref.id}`}
                >
                  {ref.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

function FocusDetails({
  task,
  expanded,
  project,
}: Pick<FocusTaskContextProps, 'task' | 'project'> & { readonly expanded: boolean }): JSX.Element {
  return (
    <>
      {' '}
      {expanded && project ? (
        <Link
          href={`/orgs/${task.organizationId}/projects/${project.id}`}
          className="text-body-small text-primary hover:underline"
        >
          {project.name}
        </Link>
      ) : null}
      <FocusDescription task={task} expanded={expanded} />
      {expanded ? <FocusRelations task={task} /> : null}
    </>
  );
}
