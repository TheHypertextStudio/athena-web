'use client';

/**
 * `views` — renders the tasks of an active query (a saved view or the live working query)
 * as a filtered, grouped, sorted {@link ListView}, driven by the unified engine.
 *
 * @remarks
 * The heart of "opening a view" (mvp-plan §8.3d). Given the permission-scoped task set the API
 * returned, the active {@link ViewState}, and the task {@link FieldCatalog}, it runs the pure,
 * generic {@link applyView} engine (the same one every entity list uses) and feeds the result to
 * the design-system {@link ListView} (the grouped, keyboard-navigable surface used by My Work and
 * the project board). Because access control is enforced server-side, the runner renders exactly
 * the rows it is handed — a viewer simply sees fewer rows in a shared view, never an error.
 *
 * `applyView` is authoritative for the sort *and* group order: it returns rows already sorted so
 * that grouped rows are contiguous and group buckets are in rank order, so the downstream
 * `ListView` (which buckets in first-seen order) reproduces exactly the engine's ordering. The
 * group header label + status glyph come from the engine's {@link AppliedGroup}.
 */
import type { TaskOut } from '@docket/types';
import { type GroupKey, ListView, type TaskRowData, TaskRow } from '@docket/ui/components';
import type { WorkflowStateType } from '@docket/ui/components';
import type { JSX } from 'react';
import { useMemo } from 'react';

import { stateTypeOf } from '@/lib/work-state';

import { applyView, EMPTY_GROUP_ID } from './apply-view';
import type { FieldCatalog, ViewState } from './field-catalog';

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
  /** The active query's view state (filters + grouping + sort). */
  state: ViewState;
  /** The task field catalog the engine reads fields through. */
  catalog: FieldCatalog<TaskOut>;
  /** Resolve an assignee actor id to its display descriptor. */
  resolveActor: (actorId: string) => RunnerActor | null;
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
  state,
  catalog,
  resolveActor,
  label,
  onOpenTask,
}: ViewRunnerProps): JSX.Element {
  /** The filtered + sorted + (optionally) grouped result for this query. */
  const applied = useMemo(() => applyView(tasks, state, catalog), [tasks, state, catalog]);

  /** Group-bucket lookup: task id → its group's id/label/hint (from the engine). */
  const groupOfTask = useMemo(() => {
    const map = new Map<string, GroupKey>();
    if (applied.groups) {
      for (const group of applied.groups) {
        const stateType: WorkflowStateType | undefined =
          state.groupBy?.field === 'state' && group.id !== EMPTY_GROUP_ID
            ? stateTypeOf(group.id)
            : undefined;
        const key: GroupKey = { id: group.id, label: group.label, stateType };
        for (const task of group.rows) map.set(task.id, key);
      }
    }
    return map;
  }, [applied.groups, state.groupBy]);

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

  if (applied.rows.length === 0) {
    return (
      <p className="text-on-surface-variant text-body-medium p-8 text-center">
        No tasks match this view. Adjust the filters above, or check back as work comes in.
      </p>
    );
  }

  return (
    <ListView
      items={applied.rows}
      label={label}
      getItemKey={(task) => task.id}
      groupBy={(task) => groupOfTask.get(task.id) ?? null}
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
