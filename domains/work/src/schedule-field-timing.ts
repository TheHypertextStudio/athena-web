import { deriveBlueprintDate, assertBlueprintDateWindow } from './blueprints/dates';
import type { BlueprintDateRule, StepKey } from './contracts/work-template-blueprint';
import type { BlueprintCompletionFact } from './blueprints/types';
import type { WorkScheduleFieldRule } from './contracts/work-schedule-field-timing';
import {
  scheduleTimingFieldKey,
  scheduleTimingRefKey,
  type DerivedScheduleField,
  type ScheduleFieldTimingInput,
} from './schedule-field-timing-types';
import {
  validateScheduleFieldTiming,
  validateScheduleTimingSnapshots,
} from './schedule-field-timing-validation';

function actualCompletions(
  input: ScheduleFieldTimingInput,
  rule: WorkScheduleFieldRule,
): BlueprintCompletionFact[] {
  if (rule.source.kind !== 'after_completion') return [];
  return rule.source.works.flatMap((ref, index) => {
    const mapping = input.actualMappings.find(
      (entry) => scheduleTimingRefKey(entry.reference) === scheduleTimingRefKey(ref),
    );
    if (mapping?.kind !== 'task') return [];
    const fact = input.completionFacts.find(
      (entry) => entry.id === mapping.id && entry.kind === 'task',
    );
    // Local labels only adapt the shared calculator's scope syntax; they are never persisted IDs.
    return fact
      ? [{ id: fact.id, path: [`fact_${index}`], state: fact.state, completedAt: fact.completedAt }]
      : [];
  });
}
function sharedRule(rule: WorkScheduleFieldRule): BlueprintDateRule {
  return rule.source.kind === 'after_completion'
    ? {
        kind: 'after_completion',
        stepKeys: rule.source.works.map((_, index): StepKey => `fact_${index}`),
        offset: rule.offset,
      }
    : { kind: 'anchor', anchor: { kind: 'parent' }, offset: rule.offset };
}
/**
 * Derive named private fields with the existing blueprint calculator and exact actual facts.
 * The result is a pure plan, not row-write permission, lifecycle advancement or execution authority.
 * @throws For ambiguous snapshots, invalid dates/fields, prerequisite cycles or reversed date windows.
 */
export function deriveScheduleFieldTiming(
  input: ScheduleFieldTimingInput,
): readonly DerivedScheduleField[] {
  validateScheduleFieldTiming(input.timing, input.selections, input.declaredDependencies);
  validateScheduleTimingSnapshots(input);
  const rules = new Map(
    input.timing.rules.map((rule) => [scheduleTimingFieldKey(rule.target), rule]),
  );
  const pins = new Map(input.pins.map((pin) => [scheduleTimingFieldKey(pin.target), pin]));
  const resolved = new Map<string, DerivedScheduleField>();
  function derive(rule: WorkScheduleFieldRule): DerivedScheduleField {
    const key = scheduleTimingFieldKey(rule.target),
      existing = resolved.get(key);
    if (existing) return existing;
    const pin = pins.get(key);
    let anchor: string | null = input.runDate;
    if (rule.source.kind === 'work_date') {
      const target = { ...rule.source.work, field: rule.source.field },
        sourceKey = scheduleTimingFieldKey(target);
      const sourceRule = rules.get(sourceKey),
        sourcePin = pins.get(sourceKey);
      const snapshot = input.dates.find(
        (entry) => scheduleTimingRefKey(entry.reference) === scheduleTimingRefKey(target),
      );
      anchor = sourcePin
        ? sourcePin.value
        : sourceRule
          ? derive(sourceRule).value
          : (snapshot?.dates[target.field] ?? null);
    }
    const value: DerivedScheduleField = pin
      ? { target: rule.target, value: pin.value, unresolvedReason: null, manual: true }
      : {
          target: rule.target,
          ...deriveBlueprintDate({
            rule: sharedRule(rule),
            parentAnchor: anchor,
            milestoneAnchors: {},
            scopePath: [],
            completions: actualCompletions(input, rule),
            timezone: input.timezone,
            workingWeekdays: input.workingWeekdays,
          }),
          manual: false,
        };
    resolved.set(key, value);
    return value;
  }
  const result = input.timing.rules.map(derive);
  for (const selection of input.selections) {
    const dates = {
      ...input.dates.find(
        (entry) =>
          scheduleTimingRefKey(entry.reference) === scheduleTimingRefKey(selection.reference),
      )?.dates,
    };
    for (const pin of input.pins)
      if (scheduleTimingRefKey(pin.target) === scheduleTimingRefKey(selection.reference))
        dates[pin.target.field] = pin.value;
    for (const field of result)
      if (scheduleTimingRefKey(field.target) === scheduleTimingRefKey(selection.reference))
        dates[field.target.field] = field.value;
    assertBlueprintDateWindow(selection.kind, dates);
  }
  return result;
}
