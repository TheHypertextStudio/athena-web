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
import { useCallback, useMemo, useRef, useState } from 'react';

import { useCategoryOf } from '@/components/entity-display/use-work-status';
import { InPageSearchField } from '@/components/in-page-search/in-page-search-field';
import { ObjectSurface } from '@/components/objects/object-surface';
import { useInPageSearchTarget } from '@/components/in-page-search/in-page-search-provider';
import { useResidentInPageSearch } from '@/components/in-page-search/use-resident-in-page-search';
import { taskListKey } from './task-list-key';

import { applyView, EMPTY_GROUP_ID } from './apply-view';
import { type FieldCatalog, optionsFor, type ViewState } from './field-catalog';

/** A resolved actor descriptor for a row's assignee avatar. */
export interface RunnerActor {
  /** Display name. */
  name: string;
  /** Actor kind (drives the avatar shape). */
  kind: 'human' | 'agent' | 'team';
  /** Optional avatar image URL. */
  avatarUrl?: string | null | undefined;
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

function compileCatalogSearchText(catalog: FieldCatalog<TaskOut>): (task: TaskOut) => string {
  const fields = catalog.map((field) => {
    const optionLabels = new Map(optionsFor(field).map((option) => [option.value, option.label]));
    return {
      field,
      label: field.resolveLabel ?? ((value: string): string => optionLabels.get(value) ?? value),
    };
  });

  return (task) => {
    const parts: string[] = [];
    for (const { field, label } of fields) {
      const values = field.values?.(task) ?? [field.accessor(task)];
      for (const value of values) {
        if (value === null) continue;
        const raw = String(value);
        parts.push(raw);
        if (typeof value === 'string') parts.push(label(value));
      }
    }
    return parts.join(' ');
  };
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
  const categoryOf = useCategoryOf('task');
  const rootRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [findOpen, setFindOpen] = useState(false);
  const source = useMemo(() => ({ completeness: 'complete' as const, items: tasks }), [tasks]);
  const searchableText = useMemo(() => compileCatalogSearchText(catalog), [catalog]);
  const search = useResidentInPageSearch({ source, searchableText });
  const { restoreFocus } = useInPageSearchTarget({
    id: `saved-view:${label}`,
    rootRef,
    inputRef: searchInputRef,
    onOpen: () => {
      setFindOpen(true);
    },
  });

  /** The filtered + sorted + (optionally) grouped result for this query. */
  const applied = useMemo(
    () => applyView(search.items, state, catalog),
    [catalog, search.items, state],
  );

  /** Group-bucket lookup: task id → its group's id/label/hint (from the engine). */
  const groupOfTask = useMemo(() => {
    const map = new Map<string, GroupKey>();
    if (applied.groups) {
      for (const group of applied.groups) {
        // A status-grouped bucket is keyed by a status *key*, so the header's glyph comes from
        // that status's category — which is the one thing about it that is true across workspaces.
        const stateType: WorkflowStateType | undefined =
          state.groupBy?.field === 'state' && group.id !== EMPTY_GROUP_ID
            ? categoryOf(group.id)
            : undefined;
        const key: GroupKey = { id: group.id, label: group.label, stateType };
        for (const task of group.rows) map.set(task.id, key);
      }
    }
    return map;
  }, [applied.groups, state.groupBy, categoryOf]);
  const groupTask = useCallback(
    (task: TaskOut): GroupKey | null => groupOfTask.get(task.id) ?? null,
    [groupOfTask],
  );

  /** Adapt a task DTO to the design-system {@link TaskRow} view-model. */
  const toRow = (task: TaskOut): TaskRowData => {
    const actor = task.assigneeId ? resolveActor(task.assigneeId) : null;
    return {
      id: task.id,
      title: task.title,
      stateType: categoryOf(task.state),
      assigneeName: actor?.name ?? null,
      assigneeKind: actor?.kind ?? 'human',
      assigneeAvatarUrl: actor?.avatarUrl ?? null,
    };
  };

  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col gap-3 p-3">
      {findOpen ? (
        <InPageSearchField
          inputRef={searchInputRef}
          value={search.draft}
          onValueChange={search.setDraft}
          onEscapeEmpty={() => {
            setFindOpen(false);
            restoreFocus();
          }}
          label={`Search ${label}`}
          placeholder={`Search ${label.toLowerCase()}`}
          resultCount={applied.rows.length}
          pending={search.draft !== search.settledQuery}
          className="shrink-0"
        />
      ) : null}
      <div className="relative min-h-0 flex-1">
        <ListView
          // `ListView`'s expand/collapse state is keyed by bucket id, and the synthesized "no value"
          // bucket (`EMPTY_GROUP_ID`) is the same literal id for every field. Without a remount,
          // collapsing e.g. "No project" and then re-grouping by Assignee would render "No assignee"
          // pre-collapsed even though the viewer never touched it — a new grouping is a new partition
          // of the data, so its collapse state must start fresh rather than inherit the previous
          // grouping's. Keying on the active field forces exactly that reset.
          key={state.groupBy?.field ?? '__ungrouped__'}
          stateKey={search.settledQuery.trim().length > 0 ? 'search' : 'browse'}
          items={applied.rows}
          label={label}
          getItemKey={taskListKey}
          groupBy={groupTask}
          rowHeight={40}
          className={applied.rows.length === 0 ? 'invisible' : undefined}
          renderRow={(task, ctx) => (
            <ObjectSurface
              object={{
                kind: 'task',
                id: task.id,
                organizationId: task.organizationId,
                title: task.title,
              }}
              surfaceId="saved-view-list"
              onActivate={() => {
                ctx.onActivate();
              }}
            >
              <TaskRow task={toRow(task)} active={ctx.active} rowProps={ctx.rowProps} />
            </ObjectSurface>
          )}
          onActivateItem={(task) => {
            onOpenTask(task.id);
          }}
        />
        {applied.rows.length === 0 ? (
          <p className="text-on-surface-variant text-body-medium absolute inset-0 flex items-center justify-center p-8 text-center">
            No tasks match this view. Adjust the filters above, or check back as work comes in.
          </p>
        ) : null}
      </div>
    </div>
  );
}
