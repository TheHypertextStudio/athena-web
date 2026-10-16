import type {
  WorkScheduleField,
  WorkScheduleFieldTarget,
  WorkScheduleTimingRef,
  WorkScheduleFieldTiming,
} from './contracts/work-schedule-field-timing';

/** Exact selected logical path and publication kind supplied by a checked caller. */
export interface ScheduleTimingSelection {
  readonly reference: WorkScheduleTimingRef;
  readonly kind: 'task' | 'project' | 'milestone';
}
/** Actual retained occurrence mapping; this data alone grants no execution authority. */
export interface ScheduleTimingMapping extends ScheduleTimingSelection {
  readonly id: string;
}
/** Frozen actual row lifecycle facts, matched by physical identity and kind, never path alone. */
export interface ScheduleTimingCompletionFact {
  readonly id: string;
  readonly kind: ScheduleTimingSelection['kind'];
  readonly state: 'open' | 'completed' | 'canceled';
  readonly completedAt: string | null;
}
/** Planned current dates can supply read-only prerequisites without physical row creation. */
export interface ScheduleTimingDates {
  readonly reference: WorkScheduleTimingRef;
  readonly dates: Readonly<Partial<Record<WorkScheduleField, string | null>>>;
}
/** An explicitly authored date or null, distinct from a derived waiting null. */
export interface ScheduleTimingPin {
  readonly target: WorkScheduleFieldTarget;
  readonly value: string | null;
}
/** Declared work dependency, separate from physical containment/creation order. */
export interface ScheduleTimingDependency {
  readonly blocker: WorkScheduleTimingRef;
  readonly blocked: WorkScheduleTimingRef;
}
/** Pure calculation input; callers must first authorize and freeze exact selected provenance. */
export interface ScheduleFieldTimingInput {
  readonly timing: WorkScheduleFieldTiming;
  readonly selections: readonly ScheduleTimingSelection[];
  readonly declaredDependencies?: readonly ScheduleTimingDependency[];
  readonly dates: readonly ScheduleTimingDates[];
  readonly actualMappings: readonly ScheduleTimingMapping[];
  readonly completionFacts: readonly ScheduleTimingCompletionFact[];
  readonly pins: readonly ScheduleTimingPin[];
  readonly runDate: string;
  readonly timezone: string;
  readonly workingWeekdays: readonly number[];
}
/** Result for a named managed field; omitted fields remain unmanaged. */
export interface DerivedScheduleField {
  readonly target: WorkScheduleFieldTarget;
  readonly value: string | null;
  readonly unresolvedReason: 'missing_anchor' | 'waiting_completion' | null;
  readonly manual: boolean;
}
/** Stable internal lookup key for a root-qualified logical work reference. */
export function scheduleTimingRefKey(ref: WorkScheduleTimingRef): string {
  return JSON.stringify([ref.rootKey, ref.path]);
}
/** Stable internal lookup key for one independent logical date field. */
export function scheduleTimingFieldKey(target: WorkScheduleFieldTarget): string {
  return JSON.stringify([target.rootKey, target.path, target.field]);
}
