import type { NativeScheduleDateOwnership } from '@docket/db';
import {
  BlueprintError,
  reflowBlueprint,
  type BlueprintCreationContext,
  type ExistingBlueprintNode,
  type PlannedDateChange,
  type BlueprintCompletionFact,
} from '@docket/work/blueprints';
import {
  deriveScheduleFieldTiming,
  type ScheduleTimingMapping,
  type ScheduleTimingPin,
  type ScheduleFieldTimingInput,
} from '@docket/work/schedule-field-timing';
import type {
  WorkScheduleFieldRule,
  WorkScheduleFieldTiming,
  WorkScheduleTimingRef,
} from '@docket/work/work-schedule-field-timing';
import type { NativeScheduleDateChange } from './schedule-native-timing';
import { assertNativeScheduleFieldGraph } from './schedule-native-field-graph';

/** Checked actual snapshot for managed private fields; extra read-only prerequisites do not consume writes. */
export interface NativeScheduleFieldReflowInput {
  readonly nodes: readonly ExistingBlueprintNode[];
  readonly ownership: readonly NativeScheduleDateOwnership[];
  readonly runDate: string;
  readonly context: BlueprintCreationContext;
  readonly privateCompletions?: readonly BlueprintCompletionFact[];
  readonly affectedNodeIds?: ReadonlySet<string>;
}
type MutableOwnership = {
  -readonly [K in keyof NativeScheduleDateOwnership]: NativeScheduleDateOwnership[K];
};
interface State {
  readonly input: NativeScheduleFieldReflowInput;
  nodes: ExistingBlueprintNode[];
  readonly ownership: MutableOwnership[];
  readonly mappings: readonly ScheduleTimingMapping[];
  readonly timing: WorkScheduleFieldTiming;
  readonly changes: Map<string, NativeScheduleDateChange>;
  readonly publicChanges: Map<string, PlannedDateChange>;
}
function mappings(ownership: readonly NativeScheduleDateOwnership[]): ScheduleTimingMapping[] {
  // These labels adapt exact checked physical IDs to the shared pure calculator. They are never
  // persisted source aliases, publication paths, accepted claims or replacement-work identities.
  const works = new Map<string, { kind: 'task' | 'project' | 'milestone'; id: string }>();
  for (const entry of ownership) {
    const source = entry.anchor.kind === 'field' ? entry.anchor.source : null;
    const all = [
      entry,
      ...(source?.kind === 'work_date'
        ? [source.work]
        : source?.kind === 'after_completion'
          ? source.works
          : []),
    ];
    for (const work of all) {
      if (works.has(work.id) && works.get(work.id)?.kind !== work.kind)
        throw new BlueprintError('blueprint_invalid', 'Ambiguous accepted private work.');
      works.set(work.id, { id: work.id, kind: work.kind });
    }
  }
  return [...works.values()].map((work, index) => ({
    ...work,
    reference: { rootKey: 'actual', path: [`node_${index}`] },
  }));
}
function reference(actual: readonly ScheduleTimingMapping[], id: string): WorkScheduleTimingRef {
  const found = actual.find((entry) => entry.id === id);
  if (!found)
    throw new BlueprintError('blueprint_invalid', 'Missing accepted private prerequisite.');
  return found.reference;
}
function timing(
  ownership: readonly NativeScheduleDateOwnership[],
  actual: readonly ScheduleTimingMapping[],
): WorkScheduleFieldTiming {
  const rules: WorkScheduleFieldRule[] = ownership.flatMap((entry) => {
    if (entry.anchor.kind === 'absent') return [];
    if (entry.anchor.kind !== 'field')
      throw new BlueprintError('blueprint_invalid', 'Mixed private date policy revisions.');
    const source = entry.anchor.source;
    const derived =
      source.kind === 'work_date'
        ? {
            kind: 'work_date' as const,
            work: reference(actual, source.work.id),
            field: source.field,
          }
        : source.kind === 'after_completion'
          ? {
              kind: 'after_completion' as const,
              works: source.works.map((work) => reference(actual, work.id)),
            }
          : source;
    return [
      {
        target: { ...reference(actual, entry.id), field: entry.field },
        source: derived,
        offset: entry.anchor.offset,
      },
    ];
  });
  return { kind: 'field_timing', revision: 2, rules };
}
function writable(state: State, entry: NativeScheduleDateOwnership): boolean {
  const node = state.nodes.find((work) => work.id === entry.id && work.kind === entry.kind);
  return Boolean(
    node &&
    !entry.manual &&
    node.state !== 'completed' &&
    node.state !== 'canceled' &&
    (state.input.affectedNodeIds?.has(node.id) ?? true),
  );
}
function current(state: State, entry: NativeScheduleDateOwnership): string | null {
  return state.nodes.find((node) => node.id === entry.id)?.dates[entry.field] ?? null;
}
function inferPins(state: State): void {
  for (const entry of state.ownership)
    if (writable(state, entry) && current(state, entry) !== entry.lastDerivedDate)
      entry.manual = true;
}
function update(
  state: State,
  change: NativeScheduleDateChange,
  binding?: PlannedDateChange['binding'],
): void {
  state.changes.set(JSON.stringify([change.id, change.field]), change);
  state.nodes = state.nodes.map((node) =>
    node.id === change.id
      ? {
          ...node,
          dates: { ...node.dates, [change.field]: change.value },
          ...(binding ? { dateBindings: { ...node.dateBindings, [change.field]: binding } } : {}),
        }
      : node,
  );
}
function publicReflow(state: State): void {
  for (const change of reflowBlueprint({
    nodes: state.nodes,
    context: state.input.context,
    anchorChanges: [],
    ...(state.input.affectedNodeIds ? { affectedNodeIds: state.input.affectedNodeIds } : {}),
  })) {
    state.publicChanges.set(JSON.stringify([change.id, change.field]), change);
    update(state, change, change.binding);
  }
}
function calculation(state: State): ScheduleFieldTimingInput {
  const pins: ScheduleTimingPin[] = state.ownership
    .filter((entry) => entry.anchor.kind === 'field' && !writable(state, entry))
    .map((entry) => ({
      target: { ...reference(state.mappings, entry.id), field: entry.field },
      value: current(state, entry),
    }));
  const completionFacts = state.input.privateCompletions ?? state.input.context.completions;
  const alive = state.mappings.filter(
    (mapping) =>
      state.nodes.some((node) => node.id === mapping.id && node.kind === mapping.kind) ||
      (mapping.kind === 'task' && completionFacts.some((fact) => fact.id === mapping.id)),
  );
  return {
    timing: state.timing,
    selections: state.mappings,
    actualMappings: alive,
    completionFacts: completionFacts.flatMap((fact) =>
      fact.id && alive.some((work) => work.id === fact.id && work.kind === 'task')
        ? [{ id: fact.id, kind: 'task' as const, state: fact.state, completedAt: fact.completedAt }]
        : [],
    ),
    dates: state.mappings.map((mapping) => ({
      reference: mapping.reference,
      dates: {
        ...state.nodes.find((node) => node.id === mapping.id)?.dates,
        ...Object.fromEntries(
          state.ownership
            .filter((entry) => entry.id === mapping.id && entry.anchor.kind === 'absent')
            .map((entry) => [entry.field, writable(state, entry) ? null : current(state, entry)]),
        ),
      },
    })),
    pins,
    runDate: state.input.runDate,
    timezone: state.input.context.timezone,
    workingWeekdays: state.input.context.workingWeekdays,
  };
}
function privateReflow(state: State): void {
  const derived = deriveScheduleFieldTiming(calculation(state));
  for (const entry of state.ownership) {
    if (!writable(state, entry)) continue;
    const value =
      entry.anchor.kind === 'absent'
        ? null
        : (derived.find(
            (field) =>
              field.target.field === entry.field &&
              JSON.stringify(field.target.path) ===
                JSON.stringify(reference(state.mappings, entry.id).path),
          )?.value ?? null);
    entry.lastDerivedDate = value;
    if (current(state, entry) !== value) update(state, { id: entry.id, field: entry.field, value });
  }
}
/** Reflow private fields through actual completion facts and the ordinary public calculator with atomic write bounds. */
export function planNativeScheduleFieldReflow(input: NativeScheduleFieldReflowInput): {
  readonly dates: readonly NativeScheduleDateChange[];
  readonly publicChanges: readonly PlannedDateChange[];
  readonly ownership: readonly NativeScheduleDateOwnership[];
} {
  if ((input.affectedNodeIds?.size ?? input.nodes.length) > 500)
    throw new BlueprintError('blueprint_limit', 'Reflow at most 500 affected work items.');
  assertNativeScheduleFieldGraph(input.nodes, input.ownership);
  const actual = mappings(input.ownership);
  const state: State = {
    input,
    ownership: input.ownership.map((entry) => ({ ...entry })),
    mappings: actual,
    timing: timing(input.ownership, actual),
    changes: new Map(),
    publicChanges: new Map(),
    nodes: input.nodes.map((node) => ({
      ...node,
      dateBindings: Object.fromEntries(
        Object.entries(node.dateBindings).filter(
          ([field]) =>
            !input.ownership.some((entry) => entry.id === node.id && entry.field === field),
        ),
      ),
    })),
  };
  inferPins(state);
  let previous: string | null = null;
  for (let pass = 0; pass <= state.ownership.length + 1; pass++) {
    publicReflow(state);
    privateReflow(state);
    const fingerprint = JSON.stringify(state.nodes.map((node) => node.dates));
    if (fingerprint === previous)
      return {
        dates: [...state.changes.values()],
        publicChanges: [...state.publicChanges.values()],
        ownership: state.ownership,
      };
    previous = fingerprint;
  }
  throw new BlueprintError(
    'blueprint_loop',
    'Private date dependencies must converge before writing work.',
  );
}
