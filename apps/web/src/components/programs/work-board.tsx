'use client';

/**
 * The Program work board — the program's work grouped by Cycle, segmented by Project.
 *
 * @remarks
 * Renders the `GET …/programs/:id/work` payload faithfully to its shape (§8.4): work is
 * first grouped by *cycle* (cadence), and within each cycle segmented by *project*. The
 * "no cycle" group holds unscheduled work; the "no project" segment holds tasks attached
 * straight to the program. Each cycle is a `<section>` with a heading; each project segment
 * a sub-heading; each task a keyboard-activatable row leading with a token-colored
 * {@link StatusIcon} (so workflow state reads by shape *and* color) and opening the task
 * detail. Loading uses {@link Skeleton} rows; the empty state invites attaching work; a
 * failed load is announced via `role="alert"`.
 *
 * Entity nouns ("cycle"/"project") are resolved by the caller through `useVocabulary` and
 * passed in, so an agency sees "Sprint"/"Retainer" where a startup sees "Cycle"/"Project".
 */
import type { ProgramWorkOut } from '@docket/types';
import { StatusIcon, type WorkflowStateType } from '@docket/ui/components';
import { Skeleton } from '@docket/ui/primitives';
import type { JSX } from 'react';

import { EditableTitle } from '@/components/editor/editable-title';
import { QuickAddTaskRow } from '@/components/tasks/quick-add-task-row';
import { stateTypeOf } from '@/lib/work-state';

/** Props for {@link WorkBoard}. */
export interface WorkBoardProps {
  /** The cycle-grouped, project-segmented work payload, or `null` while unloaded. */
  work: ProgramWorkOut | null;
  /** Whether the work is still loading. */
  loading: boolean;
  /** A load error to announce, if any. */
  error: string | null;
  /** Capitalized singular noun for a cycle (vocabulary-skinned). */
  cycleLabel: string;
  /** Lower-cased singular noun for a task (vocabulary-skinned), for the quick-add placeholder. */
  taskNoun: string;
  /** Lower-cased plural noun for a task (vocabulary-skinned), for empty copy. */
  taskNounPlural: string;
  /** Lower-cased singular noun for a project (vocabulary-skinned), for the "no project" label. */
  projectNoun: string;
  /** Whether the viewer may rename tasks in place and add work to a cycle column. */
  canEdit: boolean;
  /** Open the task detail for a row. */
  onOpenTask: (taskId: string) => void;
  /** Rename a task in place (double-click its title). Omitted → titles are read-only. */
  onRename?: (taskId: string, title: string) => void;
  /**
   * Create a task in a given cycle from a typed title, resolving once persisted. When provided (and
   * {@link WorkBoardProps.canEdit}), each real cycle column grows an inline quick-add row. Omitted
   * (e.g. no team to attach to) → no quick-add is offered.
   */
  onAddTask?: (cycleId: string, title: string) => Promise<void>;
}

/**
 * The Program work board body.
 *
 * @param props - The {@link WorkBoardProps}.
 * @returns the rendered board.
 */
export function WorkBoard({
  work,
  loading,
  error,
  cycleLabel,
  taskNoun,
  taskNounPlural,
  projectNoun,
  canEdit,
  onOpenTask,
  onRename,
  onAddTask,
}: WorkBoardProps): JSX.Element {
  if (loading) {
    return (
      <div className="flex flex-col gap-3" aria-hidden="true">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-10 w-full rounded-lg" />
        <Skeleton className="h-10 w-full rounded-lg" />
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-10 w-full rounded-lg" />
      </div>
    );
  }

  if (error) {
    return (
      <p
        role="alert"
        className="border-outline-variant text-destructive text-body-medium rounded-xl border p-4"
      >
        {error}
      </p>
    );
  }

  const groups = work?.groups ?? [];
  const totalTasks = groups.reduce(
    (sum, group) => sum + group.segments.reduce((s, seg) => s + seg.tasks.length, 0),
    0,
  );

  if (totalTasks === 0) {
    return (
      <div className="border-outline-variant text-on-surface-variant text-body-medium rounded-xl border border-dashed p-8 text-center">
        No {taskNounPlural} under this program yet. Attach work to a {projectNoun} or a{' '}
        {cycleLabel.toLowerCase()} to see it flow here.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {groups.map((group, groupIndex) => {
        const cycleId = group.cycle.id;
        const cycleTitle = cycleId
          ? (group.cycle.name ??
            (group.cycle.number != null ? `${cycleLabel} ${group.cycle.number}` : cycleLabel))
          : `No ${cycleLabel.toLowerCase()}`;
        const groupCount = group.segments.reduce((s, seg) => s + seg.tasks.length, 0);

        return (
          <section
            key={group.cycle.id ?? `no-cycle-${groupIndex}`}
            aria-label={cycleTitle}
            className="flex flex-col gap-3"
          >
            <div className="flex items-center gap-2">
              <h3 className="text-on-surface text-base font-semibold tracking-tight">
                {cycleTitle}
              </h3>
              <span className="bg-surface-container text-on-surface-variant inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-medium tabular-nums">
                {groupCount}
              </span>
            </div>

            <div className="flex flex-col gap-6">
              {group.segments.map((segment, segmentIndex) => {
                const projectTitle = segment.project.id
                  ? (segment.project.name ?? projectNoun)
                  : `No ${projectNoun}`;
                return (
                  <div
                    key={segment.project.id ?? `no-project-${segmentIndex}`}
                    className="flex flex-col gap-1.5"
                  >
                    <p className="text-on-surface-variant text-xs font-medium">{projectTitle}</p>
                    <ul className="border-outline-variant overflow-hidden rounded-lg border">
                      {segment.tasks.map((task) => (
                        <li key={task.id}>
                          <TaskLine
                            title={task.title}
                            stateType={stateTypeOf(task.state)}
                            canEdit={canEdit}
                            onOpen={() => {
                              onOpenTask(task.id);
                            }}
                            {...(onRename
                              ? {
                                  onRename: (title: string) => {
                                    onRename(task.id, title);
                                  },
                                }
                              : {})}
                          />
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>

            {cycleId && onAddTask ? (
              <QuickAddTaskRow
                canEdit={canEdit}
                placeholder={`Add a ${taskNoun} to this ${cycleLabel.toLowerCase()}…`}
                onAdd={(title) => onAddTask(cycleId, title)}
              />
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

/**
 * One task row: a token-colored status glyph and the title, with keyboard activation.
 *
 * @remarks
 * When {@link TaskLineProps.onRename} is supplied (and {@link TaskLineProps.canEdit}) the title is an
 * inline editor — a single click opens the task, a double-click renames it — and the row is a plain
 * container so the edit `<input>` never nests inside a `<button>`. Otherwise the whole row is a
 * single button that opens the task on click, as before.
 */
function TaskLine({ title, stateType, canEdit, onOpen, onRename }: TaskLineProps): JSX.Element {
  const rowClass =
    'group border-outline-variant hover:bg-surface-container-high focus-visible:bg-surface-container-high focus-visible:ring-ring flex min-h-10 w-full items-center gap-2 border-b px-3 text-left transition-colors outline-none last:border-b-0 focus-visible:ring-1 focus-visible:ring-inset';

  if (canEdit && onRename) {
    return (
      <div className={rowClass}>
        <StatusIcon type={stateType} className="size-4 shrink-0" />
        <EditableTitle
          value={title}
          onSave={onRename}
          canEdit
          activate="doubleClick"
          onActivate={onOpen}
          ariaLabel="Task title"
          className="text-on-surface text-body-medium min-w-0 flex-1 truncate"
        />
      </div>
    );
  }

  return (
    <button type="button" onClick={onOpen} className={rowClass}>
      <StatusIcon type={stateType} className="size-4 shrink-0" />
      <span className="text-on-surface text-body-medium min-w-0 flex-1 truncate">{title}</span>
    </button>
  );
}

/** Props for {@link TaskLine}. */
interface TaskLineProps {
  /** The task's title. */
  title: string;
  /** The task's canonical workflow-state type, coloring the leading glyph. */
  stateType: WorkflowStateType;
  /** Whether the viewer may rename the task in place. */
  canEdit: boolean;
  /** Open the task detail. */
  onOpen: () => void;
  /** Persist a renamed title. Enables the inline title editor when provided with `canEdit`. */
  onRename?: (title: string) => void;
}
