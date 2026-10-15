import { addCalendarDays } from '@docket/work/calendar-date';
import type {
  BlueprintDateField,
  BlueprintNodeOverride,
  PlannedWorkNode,
  PlannedWorkTree,
} from '@docket/work/blueprints';
import { ConflictError } from '../../error';
import type { OrdinaryWorkCommand, WorkCreationBatchCommand } from '../work-creation/types';
import type { WorkScheduleDraft } from '@docket/work/work-schedule';

/** Read-only root facts and the same pure blueprint planner used by ordinary creation. */
export interface ScheduleTimingPlan {
  readonly tree: PlannedWorkTree;
  readonly replan: (command: OrdinaryWorkCommand) => PlannedWorkTree;
}
function qualified(ref: { readonly rootKey: string; readonly path: readonly string[] }): string {
  return JSON.stringify([ref.rootKey, ref.path]);
}
function rootNodes(
  command: WorkCreationBatchCommand,
  plans: readonly ScheduleTimingPlan[],
): Map<string, PlannedWorkNode> {
  const nodes = new Map<string, PlannedWorkNode>();
  command.roots.forEach((root, index) => {
    for (const node of plans[index]?.tree.nodes ?? [])
      nodes.set(qualified({ rootKey: root.key, path: [...node.path] }), node);
  });
  return nodes;
}
function implicitPrerequisites(rootKey: string, node: PlannedWorkNode): string[] {
  const paths = [...node.prerequisitePaths];
  if (
    node.parentPath &&
    Object.values(node.step?.dates ?? {}).some(
      (rule) => rule?.kind === 'anchor' && rule.anchor.kind === 'parent',
    )
  )
    paths.push(node.parentPath);
  return paths.map((path) => qualified({ rootKey, path: [...path] }));
}
function timingOrder(
  command: WorkCreationBatchCommand,
  plans: readonly ScheduleTimingPlan[],
): string[] {
  const nodes = rootNodes(command, plans);
  const prerequisites = new Map([...nodes.keys()].map((key) => [key, new Set<string>()]));
  command.roots.forEach((root, index) => {
    for (const node of plans[index]?.tree.nodes ?? []) {
      const key = qualified({ rootKey: root.key, path: [...node.path] });
      for (const dependency of implicitPrerequisites(root.key, node))
        prerequisites.get(key)?.add(dependency);
    }
    for (const edge of plans[index]?.tree.dependencies ?? [])
      prerequisites
        .get(qualified({ rootKey: root.key, path: [...edge.blockedPath] }))
        ?.add(qualified({ rootKey: root.key, path: [...edge.blockerPath] }));
  });
  for (const edge of command.edges)
    prerequisites.get(qualified(edge.blocked))?.add(qualified(edge.blocker));
  const timing = command.scheduleTiming ?? [];
  if (new Set(timing.map((edge) => qualified(edge.target))).size !== timing.length)
    throw new ConflictError('Choose one private timing anchor per selected target.');
  for (const edge of command.scheduleTiming ?? []) {
    if (!nodes.has(qualified(edge.target)) || !nodes.has(qualified(edge.prerequisite)))
      throw new ConflictError('Private timing requires selected exact template paths.');
    prerequisites.get(qualified(edge.target))?.add(qualified(edge.prerequisite));
  }
  return sortTiming(prerequisites);
}
function sortTiming(prerequisites: ReadonlyMap<string, ReadonlySet<string>>): string[] {
  const ready = [...prerequisites]
    .filter(([, incoming]) => incoming.size === 0)
    .map(([key]) => key);
  const visited = new Set<string>();
  for (const key of ready) {
    visited.add(key);
    for (const [target, incoming] of prerequisites)
      if (
        !visited.has(target) &&
        !ready.includes(target) &&
        [...incoming].every((dependency) => visited.has(dependency))
      )
        ready.push(target);
  }
  if (visited.size !== prerequisites.size)
    throw new ConflictError('Private timing and template prerequisites cannot form a cycle.');
  return ready;
}
function dateField(node: PlannedWorkNode): BlueprintDateField {
  if (node.kind === 'task') return 'dueDate';
  if (node.kind === 'project' || node.kind === 'milestone') return 'targetDate';
  throw new ConflictError('Private timing requires a Task, Project or Milestone date.');
}
function withTiming(
  command: OrdinaryWorkCommand,
  path: readonly string[],
  field: BlueprintDateField,
  value: string | null,
): OrdinaryWorkCommand {
  const context = command.invocation.scheduleContext;
  if (!context) throw new ConflictError('Private timing requires a canonical schedule draft.');
  if (hasAuthoredDate(context.draft, path, field)) return command;
  const existing = context.timingOverrides ?? [];
  const override: BlueprintNodeOverride = { path, dates: { [field]: value } };
  const invocation = {
    ...command.invocation,
    scheduleContext: { ...context, timingOverrides: [...existing, override] },
  };
  if (path.length > 0) return { ...command, invocation };
  if (command.kind === 'task')
    return { ...command, body: { ...command.body, dueDate: value ?? undefined }, invocation };
  if (command.kind === 'project')
    return { ...command, body: { ...command.body, targetDate: value ?? undefined }, invocation };
  throw new ConflictError('Private timing requires a Task or Project root.');
}
function hasAuthoredDate(
  draft: WorkScheduleDraft,
  path: readonly string[],
  field: BlueprintDateField,
): boolean {
  const authored =
    path.length === 0
      ? draft.root
      : draft.stepOverrides.find((entry) => JSON.stringify(entry.path) === JSON.stringify(path));
  const dates = authored && 'dates' in authored ? authored.dates : undefined;
  return Object.entries(dates ?? {}).some(([key, value]) => key === field && value !== undefined);
}
/** Compile private forest timing using qualified actual paths, implicit prerequisites and ordinary planner dates. */
export function compileScheduleTiming(
  command: WorkCreationBatchCommand,
  initial: readonly ScheduleTimingPlan[],
): WorkCreationBatchCommand {
  const order = timingOrder(command, initial);
  let output = command;
  const trees = initial.map((plan) => plan.tree);
  for (const key of order) {
    const rule = command.scheduleTiming?.find((entry) => qualified(entry.target) === key);
    if (!rule) continue;
    const sourceIndex = output.roots.findIndex((entry) => entry.key === rule.prerequisite.rootKey);
    const source = trees[sourceIndex]?.nodes.find(
      (entry) => JSON.stringify(entry.path) === JSON.stringify(rule.prerequisite.path),
    );
    const targetIndex = output.roots.findIndex((entry) => entry.key === rule.target.rootKey);
    const root = output.roots[targetIndex];
    const target = trees[targetIndex]?.nodes.find(
      (entry) => JSON.stringify(entry.path) === JSON.stringify(rule.target.path),
    );
    if (!source || !target || !root)
      throw new ConflictError('Private timing requires selected exact template paths.');
    const value = source.dates[dateField(source)];
    const updated = withTiming(
      root.command,
      rule.target.path,
      dateField(target),
      value ? addCalendarDays(value, rule.offsetDays) : null,
    );
    const plan = initial[targetIndex];
    if (!plan) throw new ConflictError('Private timing requires a checked canonical root.');
    trees[targetIndex] = plan.replan(updated);
    output = {
      ...output,
      roots: output.roots.map((entry, index) =>
        index === targetIndex ? { ...entry, command: updated } : entry,
      ),
    };
  }
  return { ...output, scheduleTiming: [] };
}
