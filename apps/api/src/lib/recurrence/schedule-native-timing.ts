import type { BlueprintOccurrenceRoot, NativeScheduleDateOwnership } from '@docket/db';
import {
  BlueprintError,
  offsetBlueprintDate,
  reflowBlueprint,
  type BlueprintCreationContext,
  type BlueprintDateField,
  type BlueprintDateReferences,
  type ExistingBlueprintNode,
  type PlannedDateChange,
  type BlueprintCompletionFact,
} from '@docket/work/blueprints';
import { scheduleDocumentRoots, type ScheduleDocument } from './schedule-compiler';
import { nativeFieldDateOwnership } from './schedule-native-field-ownership';
import { planNativeScheduleFieldReflow } from './schedule-native-field-reflow';

export type { NativeScheduleDateOwnership } from '@docket/db';
/** A concrete derived write, including roots which have no reusable step binding. */
export interface NativeScheduleDateChange {
  readonly id: string;
  readonly field: BlueprintDateField;
  readonly value: string | null;
}
type V1Ownership = Omit<NativeScheduleDateOwnership, 'anchor'> & {
  readonly anchor: Extract<
    NativeScheduleDateOwnership['anchor'],
    { readonly kind: 'run' | 'work' }
  >;
};
function anchorField(kind: string): BlueprintDateField {
  return kind === 'task' ? 'dueDate' : 'targetDate';
}
function actualAt(
  roots: readonly BlueprintOccurrenceRoot[],
  rootKey: string,
  path: readonly string[],
) {
  const root = roots.find((entry) => entry.key === rootKey);
  const actual =
    path.length === 0
      ? root
      : root?.selectedWork?.find((entry) => JSON.stringify(entry.path) === JSON.stringify(path));
  if (!actual || !['task', 'project', 'milestone'].includes(actual.kind))
    throw new BlueprintError(
      'blueprint_invalid',
      'Private timing requires its accepted actual work.',
    );
  return { kind: actual.kind as 'task' | 'project' | 'milestone', id: actual.id };
}
function authoredDate(
  document: ScheduleDocument,
  rootKey: string,
  path: readonly string[],
  field: BlueprintDateField,
): boolean {
  const draft = scheduleDocumentRoots(document).find((entry) => entry.key === rootKey)?.draft;
  const override = draft?.stepOverrides.find(
    (entry) => JSON.stringify(entry.path) === JSON.stringify(path),
  );
  const dates =
    path.length === 0
      ? draft?.root.dates
      : override && 'dates' in override
        ? override.dates
        : undefined;
  return (
    dates !== undefined &&
    Object.entries(dates).some(([key, value]) => key === field && value !== undefined)
  );
}
/** Register only run anchors and private forest rules from the saved draft and immutable actual receipts. */
export function nativeDateOwnership(
  document: ScheduleDocument,
  roots: readonly BlueprintOccurrenceRoot[],
  nodes: readonly ExistingBlueprintNode[],
): NativeScheduleDateOwnership[] {
  if (document.kind === 'forest' && document.revision === 2)
    return nativeFieldDateOwnership(document, roots, nodes);
  const rules = document.kind === 'forest' ? document.timing : [];
  const targets = [
    ...roots
      .filter(
        (root) =>
          !rules.some((rule) => rule.target.rootKey === root.key && rule.target.path.length === 0),
      )
      .map((root) => ({
        rootKey: root.key,
        path: [] as readonly string[],
        anchor: { kind: 'run' as const },
      })),
    ...rules.map((rule) => ({
      ...rule.target,
      anchor: {
        kind: 'work' as const,
        id: actualAt(roots, rule.prerequisite.rootKey, rule.prerequisite.path).id,
        offsetDays: rule.offsetDays,
      },
    })),
  ];
  return targets.map((target) => {
    const actual = actualAt(roots, target.rootKey, target.path);
    const node = nodes.find((entry) => entry.id === actual.id && entry.kind === actual.kind);
    if (!node)
      throw new BlueprintError('blueprint_invalid', 'Missing private date registration work.');
    const field = anchorField(actual.kind);
    return {
      rootKey: target.rootKey,
      path: [...target.path],
      ...actual,
      field,
      anchor: target.anchor,
      manual: authoredDate(document, target.rootKey, target.path, field),
      lastDerivedDate: node.dates[field] ?? null,
    };
  });
}
/** Explicit foreground writes own the field even when its accepted value is unchanged or null. */
export function pinNativeScheduleDates(
  ownership: readonly NativeScheduleDateOwnership[],
  workId: string,
  fields: readonly BlueprintDateField[],
): NativeScheduleDateOwnership[] {
  return ownership.map((entry) =>
    entry.id === workId && fields.includes(entry.field) ? { ...entry, manual: true } : entry,
  );
}
function referencePrerequisites(refs: BlueprintDateReferences | undefined): string[] {
  return [...Object.values(refs?.milestoneIds ?? {}), ...Object.values(refs?.completionIds ?? {})];
}
function ordinaryPrerequisites(node: ExistingBlueprintNode): string[] {
  return Object.entries(node.dateBindings).flatMap(([field, binding]) => {
    if (!binding || binding.manual) return [];
    const refs = node.dateReferences?.[field as BlueprintDateField];
    const parent = refs?.parentId ?? node.parentId;
    const parentIds =
      binding.rule.kind === 'anchor' && binding.rule.anchor.kind === 'parent' && parent
        ? [parent]
        : [];
    return [...parentIds, ...referencePrerequisites(refs)];
  });
}
function sortPrivateTiming(dependencies: ReadonlyMap<string, ReadonlySet<string>>): string[] {
  const ready = [...dependencies.keys()].filter((id) => dependencies.get(id)?.size === 0);
  const visited = new Set<string>();
  for (const id of ready) {
    visited.add(id);
    for (const [target, incoming] of dependencies)
      if (
        !visited.has(target) &&
        !ready.includes(target) &&
        [...incoming].every((source) => visited.has(source))
      )
        ready.push(target);
  }
  if (visited.size !== dependencies.size)
    throw new BlueprintError('blueprint_loop', 'Private timing and current ancestry form a cycle.');
  return ready;
}
function privateOrder(
  nodes: readonly ExistingBlueprintNode[],
  ownership: readonly NativeScheduleDateOwnership[],
): string[] {
  const ids = new Set(nodes.map((node) => node.id));
  const dependencies = new Map(
    nodes.map((node) => [
      node.id,
      new Set(ordinaryPrerequisites(node).filter((id) => ids.has(id))),
    ]),
  );
  for (const entry of ownership)
    if (!entry.manual && entry.anchor.kind === 'work' && ids.has(entry.anchor.id))
      dependencies.get(entry.id)?.add(entry.anchor.id);
  return sortPrivateTiming(dependencies);
}
function maskPrivateDates(
  nodes: readonly ExistingBlueprintNode[],
  ownership: readonly NativeScheduleDateOwnership[],
): ExistingBlueprintNode[] {
  return nodes.map((node) => ({
    ...node,
    dateBindings: Object.fromEntries(
      Object.entries(node.dateBindings).filter(
        ([field]) => !ownership.some((entry) => entry.id === node.id && entry.field === field),
      ),
    ),
  }));
}
interface NativeReflowState {
  nodes: ExistingBlueprintNode[];
  readonly context: BlueprintCreationContext;
  readonly runDate: string;
  readonly dates: Map<string, NativeScheduleDateChange>;
  readonly publicChanges: Map<string, PlannedDateChange>;
  readonly affectedNodeIds: ReadonlySet<string> | undefined;
}
function updateNodeDate(
  node: ExistingBlueprintNode,
  change: NativeScheduleDateChange,
  binding?: PlannedDateChange['binding'],
): ExistingBlueprintNode {
  if (node.id !== change.id) return node;
  return {
    ...node,
    dates: { ...node.dates, [change.field]: change.value },
    dateBindings: binding ? { ...node.dateBindings, [change.field]: binding } : node.dateBindings,
  };
}
function applyPublicReflow(state: NativeReflowState): void {
  const planned = reflowBlueprint({
    nodes: state.nodes,
    context: state.context,
    anchorChanges: [],
    ...(state.affectedNodeIds ? { affectedNodeIds: state.affectedNodeIds } : {}),
  });
  for (const change of planned) {
    state.dates.set(`${change.id}:${change.field}`, {
      id: change.id,
      field: change.field,
      value: change.value,
    });
    state.publicChanges.set(`${change.id}:${change.field}`, change);
    state.nodes = state.nodes.map((node) => updateNodeDate(node, change, change.binding));
  }
}
function privateAnchorDate(state: NativeReflowState, entry: V1Ownership): string | null {
  if (entry.anchor.kind === 'run') return state.runDate;
  const sourceId = entry.anchor.id;
  const source = state.nodes.find((node) => node.id === sourceId);
  return source?.dates[anchorField(source.kind)] ?? null;
}
function privateDerivedValue(state: NativeReflowState, entry: V1Ownership): string | null {
  const anchor = privateAnchorDate(state, entry);
  if (anchor === null) return null;
  return offsetBlueprintDate(
    anchor,
    { days: entry.anchor.kind === 'work' ? entry.anchor.offsetDays : 0, unit: 'calendar' },
    state.context.workingWeekdays,
  );
}
function applyPrivateAnchor(
  state: NativeReflowState,
  entry: { -readonly [K in keyof V1Ownership]: V1Ownership[K] },
): void {
  const node = state.nodes.find((value) => value.id === entry.id);
  if (!node) return;
  if (state.affectedNodeIds?.has(node.id) === false) return;
  if (entry.manual || node.state === 'completed' || node.state === 'canceled') return;
  if ((node.dates[entry.field] ?? null) !== entry.lastDerivedDate) {
    entry.manual = true;
    return;
  }
  const value = privateDerivedValue(state, entry);
  entry.lastDerivedDate = value;
  if ((node.dates[entry.field] ?? null) === value) return;
  const change = { id: entry.id, field: entry.field, value };
  state.dates.set(`${entry.id}:${entry.field}`, change);
  state.nodes = state.nodes.map((current) => updateNodeDate(current, change));
  applyPublicReflow(state);
}
/** Reflow private actual anchors and ordinary descendants through the same pure blueprint date engine. */
export function planNativeScheduleReflow(input: {
  readonly nodes: readonly ExistingBlueprintNode[];
  readonly ownership: readonly NativeScheduleDateOwnership[];
  readonly runDate: string;
  readonly context: BlueprintCreationContext;
  readonly privateCompletions?: readonly BlueprintCompletionFact[];
  readonly affectedNodeIds?: ReadonlySet<string>;
}): {
  readonly dates: readonly NativeScheduleDateChange[];
  readonly publicChanges: readonly PlannedDateChange[];
  readonly ownership: readonly NativeScheduleDateOwnership[];
} {
  if (
    input.ownership.some((entry) => entry.anchor.kind === 'field' || entry.anchor.kind === 'absent')
  )
    return planNativeScheduleFieldReflow(input);
  if ((input.affectedNodeIds?.size ?? input.nodes.length) > 500)
    throw new BlueprintError('blueprint_limit', 'Reflow at most 500 affected work items.');
  const ownership = input.ownership.map((entry) => {
    if (entry.anchor.kind !== 'run' && entry.anchor.kind !== 'work')
      throw new BlueprintError('blueprint_invalid', 'Unknown private date policy.');
    return { ...entry, anchor: entry.anchor };
  });
  const state: NativeReflowState = {
    nodes: maskPrivateDates(input.nodes, ownership),
    context: input.context,
    runDate: input.runDate,
    dates: new Map(),
    publicChanges: new Map(),
    affectedNodeIds: input.affectedNodeIds,
  };
  applyPublicReflow(state);
  for (const id of privateOrder(state.nodes, ownership))
    for (const entry of ownership.filter((value) => value.id === id))
      applyPrivateAnchor(state, entry);
  return {
    dates: [...state.dates.values()],
    publicChanges: [...state.publicChanges.values()],
    ownership,
  };
}
