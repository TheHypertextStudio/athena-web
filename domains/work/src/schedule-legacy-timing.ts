import { assertAcyclic } from './blueprints/graph';
import { DayOffset } from './contracts/work-template-blueprint';
import {
  WorkScheduleFieldTiming,
  type WorkScheduleFieldRule,
  type WorkScheduleField,
  type WorkScheduleFieldSource,
  type WorkScheduleTimingRef,
} from './contracts/work-schedule-field-timing';
import type {
  ScheduleTimingSelection,
  ScheduleTimingDependency,
} from './schedule-field-timing-types';
import { scheduleTimingRefKey } from './schedule-field-timing-types';
import { validateScheduleFieldTiming } from './schedule-field-timing-validation';

/** Original retained timing declaration; no source row or source SQL is accessed here. */
export type LegacyScheduleTiming =
  | { readonly kind: 'on_trigger' }
  | { readonly kind: 'relative_to_trigger'; readonly offsetDays: number }
  | {
      readonly kind: 'after_step_completion';
      readonly stepKey: string;
      readonly offsetDays: number;
    };
/** Minimal retained private step data; the original source key is supplied without rewriting. */
export interface LegacyScheduleTimingStep {
  readonly key: string;
  readonly kind: ScheduleTimingSelection['kind'];
  readonly timing: LegacyScheduleTiming;
  readonly fieldOverrides: Readonly<Record<string, unknown>>;
  readonly dependsOn?: readonly string[];
}
/** Caller-verified source mapping, separate from native accepted claims or execution permission. */
export interface LegacyScheduleTimingMapping extends ScheduleTimingSelection {
  readonly sourceKey: string;
}
/** Original legacy declarations and explicit canonical aliases, with no invented source IDs. */
export interface LegacyScheduleTimingInput {
  readonly steps: readonly LegacyScheduleTimingStep[];
  readonly sourceMappings: readonly LegacyScheduleTimingMapping[];
}
function sourceFor(
  step: LegacyScheduleTimingStep,
  mappings: ReadonlyMap<string, LegacyScheduleTimingMapping>,
): WorkScheduleFieldSource {
  if (step.timing.kind !== 'after_step_completion') return { kind: 'run' };
  const source = mappings.get(step.timing.stepKey);
  if (!source) throw new Error('Missing exact legacy completion source mapping.');
  return { kind: 'after_completion', works: [source.reference] };
}
function rulesFor(
  step: LegacyScheduleTimingStep,
  mapping: LegacyScheduleTimingMapping,
  mappings: ReadonlyMap<string, LegacyScheduleTimingMapping>,
): WorkScheduleFieldRule[] {
  const fields: readonly WorkScheduleField[] =
    step.kind === 'task'
      ? ['startDate', 'dueDate']
      : step.kind === 'project'
        ? ['startDate', 'targetDate']
        : ['targetDate'];
  const primary =
    step.kind === 'task' ? 'dueDate' : step.kind === 'project' ? 'startDate' : 'targetDate';
  return fields.flatMap((field) => {
    const name =
      field === 'startDate'
        ? 'start_offset_days'
        : field === 'dueDate'
          ? 'due_offset_days'
          : 'target_offset_days';
    const literal = step.fieldOverrides[name];
    if (typeof literal === 'number')
      return [
        {
          target: { ...mapping.reference, field },
          source: { kind: 'run' },
          offset: { days: literal, unit: 'calendar' },
        },
      ];
    if (literal !== undefined && literal !== null)
      throw new Error('Invalid retained numeric field offset.');
    if (field !== primary) return [];
    return [
      {
        target: { ...mapping.reference, field },
        source: sourceFor(step, mappings),
        offset: {
          days: step.timing.kind === 'on_trigger' ? 0 : step.timing.offsetDays,
          unit: 'calendar',
        },
      },
    ];
  });
}
function validateLegacyOffsets(step: LegacyScheduleTimingStep): void {
  if (step.timing.kind === 'on_trigger') return;
  DayOffset.parse({ days: step.timing.offsetDays, unit: 'calendar' });
  if (step.timing.kind === 'after_step_completion' && step.timing.offsetDays < 0)
    throw new Error('Negative original completion offset cannot be represented.');
}
function legacyMappings(
  input: LegacyScheduleTimingInput,
): Map<string, LegacyScheduleTimingMapping> {
  const mappings = new Map(input.sourceMappings.map((entry) => [entry.sourceKey, entry]));
  const keys = new Set(input.steps.map((step) => step.key));
  if (
    keys.size !== input.steps.length ||
    mappings.size !== input.sourceMappings.length ||
    keys.size !== mappings.size ||
    [...keys].some((key) => !mappings.has(key))
  )
    throw new Error('Legacy timing requires exact distinct source mappings.');
  for (const step of input.steps) {
    validateLegacyOffsets(step);
    if (mappings.get(step.key)?.kind !== step.kind)
      throw new Error('Legacy mapping kind differs from original step.');
  }
  return mappings;
}
/**
 * Translate retained private timing with numeric run-offset precedence and absent secondary fields.
 * Non-Task completion sources remain declared; only actual Task facts can later satisfy them.
 * @throws For missing/ambiguous aliases, invalid offsets, selections or legacy prerequisite cycles.
 */
export function translateLegacyScheduleFieldTiming(
  input: LegacyScheduleTimingInput,
): WorkScheduleFieldTiming {
  const mappings = legacyMappings(input);
  const rules = input.steps.flatMap((step) => {
    const mapping = mappings.get(step.key);
    if (!mapping) throw new Error('Missing legacy source mapping.');
    return rulesFor(step, mapping, mappings);
  });
  const dependencies = input.steps.flatMap((step) =>
    [
      ...(step.dependsOn ?? []),
      ...(step.timing.kind === 'after_step_completion' ? [step.timing.stepKey] : []),
    ].map((key) => {
      const blocker = mappings.get(key),
        blocked = mappings.get(step.key);
      if (!blocker || !blocked) throw new Error('Missing legacy dependency mapping.');
      return { blocker: blocker.reference, blocked: blocked.reference };
    }),
  );
  const result = WorkScheduleFieldTiming.parse({ kind: 'field_timing', revision: 2, rules });
  validateScheduleFieldTiming(result, input.sourceMappings, dependencies);
  return result;
}
/** Immutable version1 root and timing projection; saved source documents remain byte-preserved. */
export interface V1ScheduleTimingInput {
  readonly roots: readonly WorkScheduleTimingRef[];
  readonly timing: readonly {
    readonly target: WorkScheduleTimingRef;
    readonly prerequisite: WorkScheduleTimingRef;
    readonly offsetDays: number;
  }[];
  readonly selections: readonly ScheduleTimingSelection[];
  readonly dependencies?: readonly ScheduleTimingDependency[];
}
function validateV1Declarations(input: V1ScheduleTimingInput): void {
  if (input.roots.some((root) => root.path.length !== 0))
    throw new Error('Version1 roots require exact root paths.');
  if (input.timing.length > 500) throw new Error('Version1 private timing limit exceeded.');
  const edges = [
    ...(input.dependencies ?? []),
    ...input.timing.map((rule) => ({ blocker: rule.prerequisite, blocked: rule.target })),
  ];
  const graph = new Map<string, string[]>();
  for (const edge of edges) {
    const key = scheduleTimingRefKey(edge.blocker);
    graph.set(key, [...(graph.get(key) ?? []), scheduleTimingRefKey(edge.blocked)]);
  }
  // Retained v1 treated private work-date rules as whole-work dependency edges.
  assertAcyclic(graph);
}
/**
 * Normalize version1's implicit Task due/Project target fields exactly into an independent vector.
 * @throws For missing exact paths, duplicate targets, incompatible selected kinds or cycles.
 */
export function normalizeV1ScheduleFieldTiming(
  input: V1ScheduleTimingInput,
): WorkScheduleFieldTiming {
  validateV1Declarations(input);
  function primary(ref: WorkScheduleTimingRef): WorkScheduleField {
    const selection = input.selections.find(
      (entry) => scheduleTimingRefKey(entry.reference) === scheduleTimingRefKey(ref),
    );
    if (!selection) throw new Error('Missing version1 selected work.');
    return selection.kind === 'task' ? 'dueDate' : 'targetDate';
  }
  const rules: WorkScheduleFieldRule[] = input.roots
    .filter(
      (root) =>
        !input.timing.some(
          (rule) => scheduleTimingRefKey(rule.target) === scheduleTimingRefKey(root),
        ),
    )
    .map((ref) => ({
      target: { ...ref, field: primary(ref) },
      source: { kind: 'run' },
      offset: { days: 0, unit: 'calendar' },
    }));
  for (const rule of input.timing)
    rules.push({
      target: { ...rule.target, field: primary(rule.target) },
      source: { kind: 'work_date', work: rule.prerequisite, field: primary(rule.prerequisite) },
      offset: { days: rule.offsetDays, unit: 'calendar' },
    });
  const result = WorkScheduleFieldTiming.parse({ kind: 'field_timing', revision: 2, rules });
  validateScheduleFieldTiming(result, input.selections, input.dependencies);
  return result;
}
