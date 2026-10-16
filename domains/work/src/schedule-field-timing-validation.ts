import { z } from 'zod';
import {
  assertAcyclic as assertBlueprintAcyclic,
  assertBlueprintEdgeLimit,
} from './blueprints/graph';
import { BlueprintCivilDate, WorkingWeekdays } from './contracts/work-template-blueprint';
import {
  WorkScheduleFieldTiming,
  type WorkScheduleField,
  WorkScheduleTimingRef,
} from './contracts/work-schedule-field-timing';
import {
  scheduleTimingFieldKey,
  scheduleTimingRefKey,
  type ScheduleTimingDependency,
  type ScheduleTimingSelection,
  type ScheduleFieldTimingInput,
} from './schedule-field-timing-types';

function prerequisiteGraph(edges: readonly (readonly [string, string])[]): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  for (const [from, to] of edges) {
    graph.set(from, [...(graph.get(from) ?? []), to]);
    if (!graph.has(to)) graph.set(to, []);
  }
  return graph;
}
function assertCombinedEdgeLimit(edges: readonly (readonly [string, string])[]): void {
  // Opaque calculation keys are scoped graph labels, never persisted paths or work identities.
  const graph = prerequisiteGraph(edges);
  assertBlueprintEdgeLimit(
    [...graph].map(([key, next]) => ({
      path: [key],
      selected: true,
      prerequisitePaths: next.map((entry) => [entry]),
    })),
  );
}
function selectedKinds(selections: readonly ScheduleTimingSelection[]): Map<string, string> {
  if (selections.length > 500) throw new Error('Private timing selection exceeds 500 work items.');
  const kinds = new Map<string, string>();
  for (const entry of selections) {
    WorkScheduleTimingRef.parse(entry.reference);
    if (!['task', 'project', 'milestone'].includes(entry.kind))
      throw new Error('Unknown selected publication kind.');
    const key = scheduleTimingRefKey(entry.reference);
    if (kinds.has(key)) throw new Error('Ambiguous selected work path.');
    kinds.set(key, entry.kind);
  }
  return kinds;
}
function requireField(
  kinds: ReadonlyMap<string, string>,
  ref: WorkScheduleTimingRef,
  field: WorkScheduleField,
): void {
  const kind = kinds.get(scheduleTimingRefKey(ref));
  const valid =
    kind === 'task'
      ? ['startDate', 'dueDate']
      : kind === 'project'
        ? ['startDate', 'targetDate']
        : kind === 'milestone'
          ? ['targetDate']
          : [];
  if (!valid.includes(field)) throw new Error('Private timing field does not match selected work.');
}
function addRuleEdges(
  timing: WorkScheduleFieldTiming,
  kinds: ReadonlyMap<string, string>,
  fields: [string, string][],
  work: [string, string][],
): void {
  for (const rule of timing.rules) {
    requireField(kinds, rule.target, rule.target.field);
    if (rule.source.kind === 'work_date') {
      requireField(kinds, rule.source.work, rule.source.field);
      fields.push([
        scheduleTimingFieldKey({ ...rule.source.work, field: rule.source.field }),
        scheduleTimingFieldKey(rule.target),
      ]);
    }
    if (rule.source.kind === 'after_completion')
      for (const ref of rule.source.works) {
        if (!kinds.has(scheduleTimingRefKey(ref))) throw new Error('Unknown completion work path.');
        work.push([scheduleTimingRefKey(ref), scheduleTimingRefKey(rule.target)]);
      }
  }
}
/**
 * Validate exact logical paths, compatible fields and independent timing/dependency graphs.
 * Physical containment is intentionally absent: a Project can wait on its child Task.
 * @throws For unknown selections, incompatible fields, excessive bounds or prerequisite cycles.
 */
export function validateScheduleFieldTiming(
  timing: WorkScheduleFieldTiming,
  selections: readonly ScheduleTimingSelection[],
  dependencies: readonly ScheduleTimingDependency[] = [],
): void {
  const parsed = WorkScheduleFieldTiming.parse(timing),
    kinds = selectedKinds(selections);
  const fields: [string, string][] = [],
    work: [string, string][] = [];
  if (dependencies.length > 500) throw new Error('Private dependency limit exceeded.');
  for (const { blocker, blocked } of dependencies) {
    if (!kinds.has(scheduleTimingRefKey(blocker)) || !kinds.has(scheduleTimingRefKey(blocked)))
      throw new Error('Unknown dependency work path.');
    work.push([scheduleTimingRefKey(blocker), scheduleTimingRefKey(blocked)]);
  }
  addRuleEdges(parsed, kinds, fields, work);
  assertCombinedEdgeLimit([...fields, ...work]);
  assertBlueprintAcyclic(prerequisiteGraph(fields));
  assertBlueprintAcyclic(prerequisiteGraph(work));
}
function distinct(values: readonly string[], name: string): void {
  if (new Set(values).size !== values.length) throw new Error(`Ambiguous ${name}.`);
}
function validateSnapshotDates(
  input: ScheduleFieldTimingInput,
  kinds: ReadonlyMap<string, string>,
): void {
  for (const snapshot of input.dates) {
    if (!kinds.has(scheduleTimingRefKey(snapshot.reference)))
      throw new Error('Unknown date snapshot path.');
    for (const [field, value] of Object.entries(snapshot.dates)) {
      requireField(kinds, snapshot.reference, field as WorkScheduleField);
      if (value !== null) BlueprintCivilDate.parse(value);
    }
  }
  for (const pin of input.pins) {
    requireField(kinds, pin.target, pin.target.field);
    if (pin.value !== null) BlueprintCivilDate.parse(pin.value);
  }
}
/**
 * Validate supplied snapshot identity without consulting a source table or granting access.
 * @throws For ambiguous actual mappings, invalid dates/instants/timezone or unknown selected fields.
 */
export function validateScheduleTimingSnapshots(input: ScheduleFieldTimingInput): void {
  BlueprintCivilDate.parse(input.runDate);
  WorkingWeekdays.parse(input.workingWeekdays);
  new Intl.DateTimeFormat('en-US', { timeZone: input.timezone }).format(0);
  const kinds = selectedKinds(input.selections);
  distinct(
    input.dates.map((entry) => scheduleTimingRefKey(entry.reference)),
    'date snapshots',
  );
  distinct(
    input.pins.map((pin) => scheduleTimingFieldKey(pin.target)),
    'manual pins',
  );
  distinct(
    input.actualMappings.map((entry) => scheduleTimingRefKey(entry.reference)),
    'actual mappings',
  );
  distinct(
    input.actualMappings.map((entry) => entry.id),
    'actual work identities',
  );
  distinct(
    input.completionFacts.map((entry) => entry.id),
    'actual completion facts',
  );
  for (const mapping of input.actualMappings)
    if (!mapping.id || kinds.get(scheduleTimingRefKey(mapping.reference)) !== mapping.kind)
      throw new Error('Actual mapping does not match selected work.');
  validateSnapshotDates(input, kinds);
  for (const fact of input.completionFacts) {
    if (
      fact.completedAt !== null &&
      !z.iso.datetime({ offset: true }).safeParse(fact.completedAt).success
    )
      throw new Error('Invalid frozen actual completion instant.');
  }
}
