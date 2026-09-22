/**
 * `views/task-table-hierarchy` — places each subtask directly under its parent Task in a task list.
 *
 * @remarks
 * A task list arrives flat, in the order its surface chose (a project's tasks by milestone then
 * workflow state, a cycle's by project). Nesting keeps that order among siblings and moves each
 * subtask under its parent, one level deeper. It runs per group: a subtask whose parent sits in a
 * different group, or outside the list entirely, stays at the top level of its own group so it is
 * never hidden. The tree model and rail facts are the ones the work roster uses for Initiatives
 * ({@link deriveHierarchyPositions}), so both lists nest and draw rails identically.
 *
 * Positions are keyed by row object rather than task id. Grouping by a many-valued field (labels)
 * places one task in several groups, where it can sit at a different depth in each, so every
 * repeat occurrence is a copy of the task that carries its own group's position.
 */
import type { EntityTableGroup } from '@docket/ui/components';
import type { TaskOut } from '@docket/work/task-model';

import {
  deriveHierarchyPositions,
  type HierarchyPosition,
  type HierarchyRailNode,
  orderHierarchyNodes,
} from '@/components/work-views/hierarchy-rails';

/** Each rendered row's hierarchy position, keyed by that row's object. */
export type TaskPositions = ReadonlyMap<TaskOut, HierarchyPosition>;

/** A flat task list reordered parent-before-child, with each row's place in the tree. */
export interface NestedTaskRows {
  /** The same tasks, each subtask directly after its parent. */
  readonly rows: readonly TaskOut[];
  /** Each row's hierarchy position. */
  readonly positions: TaskPositions;
  /** Whether any row sits under a parent, i.e. the list renders as a tree. */
  readonly nested: boolean;
}

/** Grouped tasks nested within each group, with every row's place in its group's tree. */
export interface NestedTaskGroups {
  /** The same groups, each group's tasks nested. */
  readonly groups: readonly EntityTableGroup<TaskOut>[];
  /** Each row's hierarchy position. */
  readonly positions: TaskPositions;
  /** Whether any row sits under a parent, i.e. the list renders as a tree. */
  readonly nested: boolean;
}

/** One tree node per task, keyed by task id. */
function taskNodes(rows: readonly TaskOut[]): readonly HierarchyRailNode[] {
  return rows.map((task) => ({ key: task.id, parentKey: task.parentTaskId ?? null }));
}

/** Whether any position sits below the top level. */
function hasNesting(positions: TaskPositions): boolean {
  for (const position of positions.values()) if (position.depth > 1) return true;
  return false;
}

/**
 * Nest one flat task list.
 *
 * @param rows - Tasks in the caller's display order.
 * @returns the tasks parent-before-child, their hierarchy positions, and whether any row nests.
 */
export function nestTaskRows(rows: readonly TaskOut[]): NestedTaskRows {
  const nodes = taskNodes(rows);
  const byId = new Map<string, TaskOut>(rows.map((task) => [task.id, task]));
  const positionById = deriveHierarchyPositions(nodes);
  const ordered = orderHierarchyNodes(nodes).flatMap(({ key }) => {
    const task = byId.get(key);
    return task === undefined ? [] : [task];
  });
  const positions = new Map<TaskOut, HierarchyPosition>();
  for (const task of ordered) {
    const position = positionById.get(task.id);
    if (position !== undefined) positions.set(task, position);
  }
  return { rows: ordered, positions, nested: hasNesting(positions) };
}

/**
 * Nest the tasks inside every leaf group, leaving the group structure untouched.
 *
 * @param groups - Grouped tasks, possibly with sub-groups.
 * @returns the nested groups, every row's position, and whether any row nests.
 */
export function nestTaskGroups(groups: readonly EntityTableGroup<TaskOut>[]): NestedTaskGroups {
  const positions = new Map<TaskOut, HierarchyPosition>();
  const seen = new Set<string>();
  const occurrence = (task: TaskOut): TaskOut => {
    if (seen.has(task.id)) return { ...task };
    seen.add(task.id);
    return task;
  };
  const visit = (group: EntityTableGroup<TaskOut>): EntityTableGroup<TaskOut> => {
    if (group.rows === undefined) return { ...group, children: group.children.map(visit) };
    const nested = nestTaskRows(group.rows.map(occurrence));
    nested.positions.forEach((position, task) => positions.set(task, position));
    return { ...group, rows: nested.rows };
  };
  const nestedGroups = groups.map(visit);
  return { groups: nestedGroups, positions, nested: hasNesting(positions) };
}

/** A task table's rows or groups, nested, with every row's position. */
export interface NestedTaskList {
  /** The nested flat rows, when the table is ungrouped. */
  readonly tasks: readonly TaskOut[] | undefined;
  /** The nested groups, when the table is grouped. */
  readonly groups: readonly EntityTableGroup<TaskOut>[] | undefined;
  /** Each row's hierarchy position. */
  readonly positions: TaskPositions;
  /** Whether any row sits under a parent, i.e. the list renders as a tree. */
  readonly nested: boolean;
}

/**
 * Nest whichever shape a task table was given: groups when present, else the flat rows.
 *
 * @param tasks - The table's flat rows.
 * @param groups - The table's groups, which win over `tasks`.
 * @returns the nested rows or groups with every row's position.
 */
export function nestTaskList(
  tasks: readonly TaskOut[] | undefined,
  groups: readonly EntityTableGroup<TaskOut>[] | undefined,
): NestedTaskList {
  if (groups !== undefined) return { tasks: undefined, ...nestTaskGroups(groups) };
  const { rows, positions, nested } = nestTaskRows(tasks ?? []);
  return { tasks: rows, groups: undefined, positions, nested };
}
