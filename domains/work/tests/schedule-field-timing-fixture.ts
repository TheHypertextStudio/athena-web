import type {
  WorkScheduleFieldRule,
  WorkScheduleTimingRef,
} from '../src/contracts/work-schedule-field-timing';
import type {
  ScheduleFieldTimingInput,
  ScheduleTimingSelection,
} from '../src/schedule-field-timing-types';
import type {
  LegacyScheduleTimingInput,
  LegacyScheduleTimingStep,
} from '../src/schedule-legacy-timing';

/** Original all_at_once completion fixture from API materialize tests, projected without source SQL. */
export function legacyCompletionFixture(): LegacyScheduleTimingInput {
  const steps: LegacyScheduleTimingStep[] = [
    { key: 'interest-email', kind: 'task', timing: { kind: 'on_trigger' }, fieldOverrides: {} },
    {
      key: 'onboarding',
      kind: 'project',
      timing: { kind: 'after_step_completion', stepKey: 'interest-email', offsetDays: 2 },
      fieldOverrides: {},
    },
    {
      key: 'orientation',
      kind: 'milestone',
      timing: { kind: 'after_step_completion', stepKey: 'interest-email', offsetDays: 3 },
      fieldOverrides: {},
    },
    {
      key: 'follow-up',
      kind: 'task',
      dependsOn: ['interest-email'],
      timing: { kind: 'after_step_completion', stepKey: 'interest-email', offsetDays: 4 },
      fieldOverrides: {},
    },
  ];
  const aliases: Record<string, WorkScheduleTimingRef> = {
    'interest-email': { rootKey: 'interest-email', path: [] },
    onboarding: { rootKey: 'onboarding', path: [] },
    orientation: { rootKey: 'onboarding', path: ['orientation'] },
    'follow-up': { rootKey: 'onboarding', path: ['orientation', 'follow-up'] },
  };
  return {
    steps,
    sourceMappings: steps.map((step) => ({
      sourceKey: step.key,
      kind: step.kind,
      reference: fixtureValue(aliases[step.key]),
    })),
  };
}
/** Caller-supplied logical reference; repeated child names remain distinct across roots. */
export function timingRef(rootKey: string, path: string[] = []): WorkScheduleTimingRef {
  return { rootKey, path };
}
/** Pure calculation fixture; actual mappings/facts are supplied independently by each test. */
export function timingInput(
  rules: WorkScheduleFieldRule[],
  selections: readonly ScheduleTimingSelection[],
): ScheduleFieldTimingInput {
  return {
    timing: { kind: 'field_timing', revision: 2, rules },
    selections,
    dates: [],
    actualMappings: [],
    completionFacts: [],
    pins: [],
    runDate: '2026-11-01',
    timezone: 'America/Los_Angeles',
    workingWeekdays: [1, 2, 3, 4, 5],
  };
}

/** Require a saved fixture row without permitting an unchecked non-null assertion. */
export function fixtureValue<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing timing fixture value.');
  return value;
}
