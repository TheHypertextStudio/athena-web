import { addCalendarDays, mondayWeekdayIndex } from '../calendar-date';
import {
  BlueprintCivilDate,
  WorkingWeekdays,
  type BlueprintDateRule,
  DayOffset,
  WeekdaySnap,
} from '../contracts/work-template-blueprint';
import { BlueprintError, pathKey, requireBlueprintValue } from './errors';
import { existingParent, existingNodeAtPath } from './snapshot';
import type {
  BlueprintDateReferences,
  BlueprintCompletionFact,
  BlueprintDateField,
  BlueprintPath,
  BlueprintReflowInput,
  ExistingBlueprintNode,
  PlannedDateChange,
} from './types';

function addWorkingDays(anchor: string, days: number, working: readonly number[]): string {
  const weeks = days === 0 ? 0 : Math.floor((Math.abs(days) - 1) / working.length);
  let remaining = Math.abs(days) - weeks * working.length;
  const direction = Math.sign(days);
  let result = addCalendarDays(anchor, weeks * 7 * direction);
  while (remaining > 0) {
    result = addCalendarDays(result, direction);
    if (working.includes(mondayWeekdayIndex(result) + 1)) remaining--;
  }
  return result;
}
function snapWeekday(anchor: string, snap: WeekdaySnap): string {
  const direction = snap.direction === 'next' ? 1 : -1;
  let result = snap.inclusive ? anchor : addCalendarDays(anchor, direction);
  while (mondayWeekdayIndex(result) + 1 !== snap.weekday)
    result = addCalendarDays(result, direction);
  return result;
}
/**
 * Apply signed civil/working offsets followed by an optional calendar-weekday snap.
 * @throws For invalid or ambiguous resolved snapshots, graph limits, or calendar inputs.
 */
export function offsetBlueprintDate(
  anchor: string,
  offset: DayOffset,
  weekdays: readonly number[],
  snap?: WeekdaySnap,
): string {
  BlueprintCivilDate.parse(anchor);
  DayOffset.parse(offset);
  if (snap) WeekdaySnap.parse(snap);
  const working = WorkingWeekdays.parse(weekdays);
  let result =
    offset.unit === 'calendar'
      ? addCalendarDays(anchor, offset.days)
      : addWorkingDays(anchor, offset.days, working);
  if (snap) result = snapWeekday(result, snap);
  return BlueprintCivilDate.parse(result);
}
/**
 * Convert a supplied actual completion instant using the frozen creation timezone.
 * @throws For invalid or ambiguous resolved snapshots, graph limits, or calendar inputs.
 */
export function completionCivilDate(instant: string, timezone: string): string {
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime()))
    throw new BlueprintError('blueprint_invalid', 'Invalid actual completion instant.');
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (name: string): string =>
    requireBlueprintValue(parts.find((value) => value.type === name)).value;
  return BlueprintCivilDate.parse(`${part('year')}-${part('month')}-${part('day')}`);
}
/** Inputs to one relative-date calculation, with authorized local prerequisite snapshots. */
export interface BlueprintDateInput {
  readonly rule: BlueprintDateRule;
  readonly parentAnchor: string | null;
  readonly milestoneAnchors: Readonly<Record<string, string | null>>;
  readonly scopePath: BlueprintPath;
  readonly completions: readonly BlueprintCompletionFact[];
  readonly timezone: string;
  readonly workingWeekdays: readonly number[];
}
/** Calculated date or an explicit managed unresolved state. */
export interface DerivedBlueprintDate {
  readonly value: string | null;
  readonly unresolvedReason: 'missing_anchor' | 'waiting_completion' | null;
}
/**
 * Resolve one relative rule; canceled/open prerequisites never count as completed.
 * @throws For invalid or ambiguous resolved snapshots, graph limits, or calendar inputs.
 */
export function deriveBlueprintDate(input: BlueprintDateInput): DerivedBlueprintDate {
  const { rule } = input;
  if (rule.kind === 'none') return { value: null, unresolvedReason: null };
  let anchor: string | null;
  if (rule.kind === 'anchor')
    anchor =
      rule.anchor.kind === 'parent'
        ? input.parentAnchor
        : (input.milestoneAnchors[rule.anchor.stepKey] ?? null);
  else {
    const dates: string[] = [];
    for (const key of rule.stepKeys) {
      const fact = input.completions.find(
        (entry) => pathKey(entry.path) === pathKey([...input.scopePath, key]),
      );
      if (fact?.state !== 'completed' || !fact.completedAt)
        return { value: null, unresolvedReason: 'waiting_completion' };
      dates.push(completionCivilDate(fact.completedAt, input.timezone));
    }
    anchor = dates.sort().at(-1) ?? null;
  }
  if (!anchor) return { value: null, unresolvedReason: 'missing_anchor' };
  return {
    value: offsetBlueprintDate(anchor, rule.offset, input.workingWeekdays, rule.snap),
    unresolvedReason: null,
  };
}
/**
 * Enforce ordinary start/end ordering after relative fields resolve.
 * @throws For invalid or ambiguous resolved snapshots, graph limits, or calendar inputs.
 */
export function assertBlueprintDateWindow(
  kind: string,
  dates: Readonly<Partial<Record<BlueprintDateField, string | null>>>,
): void {
  const end = kind === 'task' ? dates.dueDate : dates.targetDate;
  if (dates.startDate && end && dates.startDate > end)
    throw new BlueprintError('blueprint_invalid', 'Derived date window cannot run backwards.');
}
/** Anchor field for ordinary relative descendants; Program uses creation civil date. */
export function blueprintAnchor(
  kind: string,
  dates: Readonly<Partial<Record<BlueprintDateField, string | null>>>,
  creationDate: string,
): string | null {
  if (kind === 'program') return creationDate;
  return (kind === 'task' ? dates.dueDate : dates.targetDate) ?? null;
}
interface ReflowState {
  readonly input: BlueprintReflowInput;
  readonly resolved: Map<string, Readonly<Partial<Record<BlueprintDateField, string | null>>>>;
  readonly active: Set<string>;
  readonly changes: PlannedDateChange[];
}
function anchorChangeMatches(
  change: BlueprintReflowInput['anchorChanges'][number],
  node: ExistingBlueprintNode,
): boolean {
  return change.id !== undefined
    ? change.id === node.id
    : pathKey(change.path) === pathKey(node.path);
}
function reflowCompletions(
  state: ReflowState,
  rule: BlueprintDateRule,
  references: BlueprintDateReferences | undefined,
  scopePath: BlueprintPath,
): readonly BlueprintCompletionFact[] {
  if (rule.kind !== 'after_completion' || !references) return state.input.context.completions;
  return rule.stepKeys.flatMap((key) => {
    const id = references.completionIds[key];
    const fact = state.input.context.completions.find(
      (entry) => entry.id === id && id !== undefined,
    );
    return fact ? [{ ...fact, path: [...scopePath, key] }] : [];
  });
}
function reflowMilestoneAnchors(
  state: ReflowState,
  node: ExistingBlueprintNode,
  rule: BlueprintDateRule,
  references: BlueprintDateReferences | undefined,
): Readonly<Record<string, string | null>> {
  const scopePath = node.path.slice(0, -1);
  const milestoneAnchors: Record<string, string | null> = {};
  if (rule.kind === 'anchor' && rule.anchor.kind === 'milestone') {
    const key = rule.anchor.stepKey;
    const milestone = references
      ? state.input.nodes.find((entry) => entry.id === references.milestoneIds[key])
      : existingNodeAtPath(state.input.nodes, [...scopePath, key]);
    if (milestone?.kind !== 'milestone')
      throw new BlueprintError('blueprint_invalid', 'Missing reflow Milestone prerequisite.', [
        node.path,
      ]);
    milestoneAnchors[key] = blueprintAnchor(
      milestone.kind,
      reflowNode(state, milestone),
      state.input.context.creationDate,
    );
  }
  return milestoneAnchors;
}
function reflowField(
  state: ReflowState,
  node: ExistingBlueprintNode,
  field: BlueprintDateField,
  dates: Partial<Record<BlueprintDateField, string | null>>,
  parentAnchor: string | null,
): void {
  const binding = node.dateBindings[field];
  const explicit = state.input.anchorChanges.some(
    (change) => anchorChangeMatches(change, node) && change.field === field,
  );
  if (!binding || binding.manual || explicit) return;
  const scopePath = node.path.slice(0, -1);
  const references = node.dateReferences?.[field];
  if (references) {
    const parent = state.input.nodes.find((entry) => entry.id === references.parentId);
    parentAnchor = parent
      ? blueprintAnchor(parent.kind, reflowNode(state, parent), state.input.context.creationDate)
      : null;
  }
  const milestoneAnchors = reflowMilestoneAnchors(state, node, binding.rule, references);
  const completions = reflowCompletions(state, binding.rule, references, scopePath);
  const result = deriveBlueprintDate({
    rule: binding.rule,
    parentAnchor,
    milestoneAnchors,
    scopePath,
    ...state.input.context,
    completions,
  });
  dates[field] = result.value;
  if ((node.dates[field] ?? null) !== result.value || binding.lastDerivedDate !== result.value)
    state.changes.push({
      id: node.id,
      path: node.path,
      field,
      value: result.value,
      binding: { ...binding, lastDerivedDate: result.value },
      unresolvedReason: result.unresolvedReason,
    });
}
function reflowManagedFields(
  state: ReflowState,
  node: ExistingBlueprintNode,
  dates: Partial<Record<BlueprintDateField, string | null>>,
): void {
  if (state.input.affectedNodeIds && !state.input.affectedNodeIds.has(node.id)) return;
  const parent = existingParent(node, state.input.nodes);
  const parentAnchor = parent
    ? blueprintAnchor(parent.kind, reflowNode(state, parent), state.input.context.creationDate)
    : null;
  for (const field of ['startDate', 'dueDate', 'targetDate'] as const)
    reflowField(state, node, field, dates, parentAnchor);
}
function reflowNode(
  state: ReflowState,
  node: ExistingBlueprintNode,
): Readonly<Partial<Record<BlueprintDateField, string | null>>> {
  const key = node.id;
  const existing = state.resolved.get(key);
  if (existing) return existing;
  if (state.active.has(key))
    throw new BlueprintError('blueprint_loop', 'Reflow date prerequisite cycle.', [node.path]);
  state.active.add(key);
  const dates = { ...node.dates };
  if (node.state !== 'completed' && node.state !== 'canceled') {
    for (const change of state.input.anchorChanges.filter((entry) =>
      anchorChangeMatches(entry, node),
    ))
      dates[change.field] = change.value;
    reflowManagedFields(state, node, dates);
  }
  assertBlueprintDateWindow(node.kind, dates);
  state.active.delete(key);
  state.resolved.set(key, dates);
  return dates;
}
/** Validate the writable selection independently of read-only prerequisites. */
function assertReflowSelection(input: BlueprintReflowInput): void {
  const selected = input.affectedNodeIds;
  const known = new Set(input.nodes.map((node) => node.id));
  if (selected && [...selected].some((id) => !known.has(id)))
    throw new BlueprintError(
      'blueprint_invalid',
      'An affected row is outside the authorized graph.',
    );
  if (
    input.nodes.filter((node) => node.parentPath !== null && (!selected || selected.has(node.id)))
      .length > 500
  )
    throw new BlueprintError(
      'blueprint_limit',
      'Reflow limit is 500 affected descendants; review the larger tree before changing its anchor.',
    );
}

/**
 * Reflow managed nonterminal fields while retaining actual read-only prerequisite dates.
 * @throws For invalid or ambiguous snapshots, graph limits, or calendar inputs.
 */
export function reflowBlueprint(input: BlueprintReflowInput): readonly PlannedDateChange[] {
  assertReflowSelection(input);
  for (const change of input.anchorChanges)
    if (change.id === undefined) existingNodeAtPath(input.nodes, change.path);
  const state: ReflowState = { input, resolved: new Map(), active: new Set(), changes: [] };
  for (const node of input.nodes) reflowNode(state, node);
  return state.changes;
}
