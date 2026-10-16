import { z } from 'zod';
import { LegacyScheduleCompletionPolicy } from './contracts/work-schedule-import';
import type {
  ScheduleTimingCompletionFact,
  ScheduleTimingMapping,
} from './schedule-field-timing-types';
import { scheduleTimingRefKey } from './schedule-field-timing-types';
/** Actual saved row fact, supplied only after caller authorization and same-occurrence mapping verification. */
export interface LegacyActualCompletionFact {
  readonly id: string;
  readonly kind: ScheduleTimingMapping['kind'];
  readonly completedAt: string | null;
}
/**
 * Normalize the legacy timestamp criterion for shared timing; lifecycle labels never replace actual Task.completedAt.
 * @throws For duplicate actual facts/mappings or invalid saved completion instants.
 */
export function normalizeLegacyScheduleCompletionFacts(
  mappings: readonly ScheduleTimingMapping[],
  facts: readonly LegacyActualCompletionFact[],
): readonly ScheduleTimingCompletionFact[] {
  const byId = new Map(facts.map((fact) => [JSON.stringify([fact.kind, fact.id]), fact]));
  const paths = new Set(mappings.map((mapping) => scheduleTimingRefKey(mapping.reference)));
  const physical = new Set(mappings.map((mapping) => JSON.stringify([mapping.kind, mapping.id])));
  if (
    byId.size !== facts.length ||
    paths.size !== mappings.length ||
    physical.size !== mappings.length
  )
    throw new Error('Actual completion mappings and facts must be distinct.');
  return mappings.flatMap((mapping) => {
    if (mapping.kind !== 'task') return [];
    const fact = byId.get(JSON.stringify(['task', mapping.id]));
    if (!fact) return [];
    const completedAt =
      fact.completedAt === null ? null : z.iso.datetime({ offset: true }).parse(fact.completedAt);
    return [
      {
        id: mapping.id,
        kind: 'task' as const,
        state: completedAt === null ? ('open' as const) : ('completed' as const),
        completedAt,
      },
    ];
  });
}
/** Whether every authored Task has exactly its mapped living row with an actual completion instant. */
export function legacyScheduleTasksComplete(
  policy: LegacyScheduleCompletionPolicy,
  mappings: readonly ScheduleTimingMapping[],
  facts: readonly LegacyActualCompletionFact[],
): boolean {
  const accepted = LegacyScheduleCompletionPolicy.parse(policy);
  const normalized = normalizeLegacyScheduleCompletionFacts(mappings, facts);
  const byPath = new Map(
    mappings.map((mapping) => [scheduleTimingRefKey(mapping.reference), mapping]),
  );
  return accepted.tasks.every((reference) => {
    const mapping = byPath.get(scheduleTimingRefKey(reference));
    return (
      mapping?.kind === 'task' &&
      normalized.some((fact) => fact.id === mapping.id && fact.completedAt !== null)
    );
  });
}
