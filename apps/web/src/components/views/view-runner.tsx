'use client';

/**
 * `views` — renders the tasks of an active query (a saved view or the live working query)
 * as a filtered, grouped, sorted {@link ListView}.
 *
 * @remarks
 * The heart of "opening a view" (mvp-plan §8.3d): given the permission-scoped task set the API
 * returned and a view's `filters`/`grouping`/`sort`, it runs the pure {@link view-engine} over
 * the tasks and feeds the result to the design-system {@link ListView} (the same grouped,
 * keyboard-navigable surface used by My Work and the project board). Because access control is
 * enforced server-side, the runner renders exactly the rows it is handed — a viewer simply sees
 * fewer rows in a shared view, never an error.
 *
 * Rows resolve their assignee name + kind from the org's members/agents so each {@link TaskRow}
 * shows the right actor avatar; the group header label is vocabulary-resolved by the caller's
 * {@link ViewRunnerProps.resolveLabel}. Activating a row opens the task detail route.
 */
import type { TaskOut, ViewFilter, ViewGrouping, ViewSort } from '@docket/types';
import { type GroupKey, ListView, type TaskRowData, TaskRow } from '@docket/ui/components';
import type { JSX } from 'react';
import { useMemo } from 'react';

import { stateTypeOf } from '@/lib/work-state';

import { applyFilters, groupFor, type LabelResolver, sortTasks } from './view-engine';

/** A resolved actor descriptor for a row's assignee avatar. */
export interface RunnerActor {
  /** Display name. */
  name: string;
  /** Actor kind (drives the avatar shape). */
  kind: 'human' | 'agent' | 'team';
  /** Optional avatar image URL. */
  avatarUrl?: string | null;
}

/** Props for {@link ViewRunner}. */
export interface ViewRunnerProps {
  /** The permission-scoped tasks the API returned. */
  tasks: readonly TaskOut[];
  /** The active query's filter predicates. */
  filters: readonly ViewFilter[];
  /** The active query's grouping, or `null`. */
  grouping: ViewGrouping | null;
  /** The active query's sort terms. */
  sort: readonly ViewSort[];
  /** Resolve an assignee actor id to its display descriptor. */
  resolveActor: (actorId: string) => RunnerActor | null;
  /** Resolve an entity-id grouping value to its display label. */
  resolveLabel: LabelResolver;
  /** Accessible label for the list grid. */
  label: string;
  /** Open a task (navigate to its detail route). */
  onOpenTask: (taskId: string) => void;
}

/**
 * Render a view's tasks as a grouped, sorted {@link ListView}.
 *
 * @param props - The {@link ViewRunnerProps}.
 * @returns the rendered list, or an empty-state note when the query matches nothing.
 */
export function ViewRunner({
  tasks,
  filters,
  grouping,
  sort,
  resolveActor,
  resolveLabel,
  label,
  onOpenTask,
}: ViewRunnerProps): JSX.Element {
  /** The filtered + sorted task set for this query. */
  const visible = useMemo(
    () => sortTasks(applyFilters(tasks, filters), sort),
    [tasks, filters, sort],
  );

  /** Adapt a task DTO to the design-system {@link TaskRow} view-model. */
  const toRow = (task: TaskOut): TaskRowData => {
    const actor = task.assigneeId ? resolveActor(task.assigneeId) : null;
    return {
      id: task.id,
      title: task.title,
      stateType: stateTypeOf(task.state),
      assigneeName: actor?.name ?? null,
      assigneeKind: actor?.kind ?? 'human',
      assigneeAvatarUrl: actor?.avatarUrl ?? null,
    };
  };

  /** Group a task under the active grouping (or no grouping). */
  const groupBy = (task: TaskOut): GroupKey | null => groupFor(task, grouping, resolveLabel);

  if (visible.length === 0) {
    return (
      <p className="text-on-surface-variant p-8 text-center text-sm">
        No tasks match this view. Adjust the filters above, or check back as work comes in.
      </p>
    );
  }

  return (
    <ListView
      items={visible}
      label={label}
      getItemKey={(task) => task.id}
      groupBy={groupBy}
      rowHeight={40}
      renderRow={(task, ctx) => (
        <TaskRow task={toRow(task)} active={ctx.active} onActivate={ctx.onActivate} />
      )}
      onActivateItem={(task) => {
        onOpenTask(task.id);
      }}
    />
  );
}
