import { describe, expect, it } from 'vitest';
import {
  translateLegacyScheduleFieldTiming,
  normalizeV1ScheduleFieldTiming,
} from '../src/schedule-legacy-timing';
import { deriveScheduleFieldTiming } from '../src/schedule-field-timing';
import {
  fixtureValue,
  legacyCompletionFixture,
  timingInput,
  timingRef,
} from './schedule-field-timing-fixture';

describe('retained legacy private timing translation', () => {
  it('matches all_at_once Project start, Milestone target and Task due actual completion dates', () => {
    const fixture = legacyCompletionFixture(),
      timing = translateLegacyScheduleFieldTiming(fixture);
    const input = timingInput(timing.rules, fixture.sourceMappings);
    const result = deriveScheduleFieldTiming({
      ...input,
      actualMappings: [{ ...fixtureValue(fixture.sourceMappings[0]), id: 'actual-source-task' }],
      completionFacts: [
        {
          id: 'actual-source-task',
          kind: 'task',
          state: 'completed',
          completedAt: '2026-11-05T20:00:00Z',
        },
      ],
    });
    expect(
      result.map((field) => [
        field.target.rootKey,
        field.target.path,
        field.target.field,
        field.value,
      ]),
    ).toEqual([
      ['interest-email', [], 'dueDate', '2026-11-01'],
      ['onboarding', [], 'startDate', '2026-11-07'],
      ['onboarding', ['orientation'], 'targetDate', '2026-11-08'],
      ['onboarding', ['orientation', 'follow-up'], 'dueDate', '2026-11-09'],
    ]);
    expect(
      timing.rules.some(
        (rule) =>
          rule.target.rootKey === 'onboarding' &&
          rule.target.path.length === 0 &&
          rule.target.field === 'targetDate',
      ),
    ).toBe(false);
  });
  it('gives literal numeric fields run-offset precedence without adding the completion offset', () => {
    const fixture = legacyCompletionFixture();
    const steps = fixture.steps.map((step) =>
      step.key === 'follow-up'
        ? { ...step, fieldOverrides: { start_offset_days: -2, due_offset_days: 5 } }
        : step,
    );
    const timing = translateLegacyScheduleFieldTiming({ ...fixture, steps });
    const result = deriveScheduleFieldTiming({
      ...timingInput(timing.rules, fixture.sourceMappings),
      runDate: '2026-10-14',
    });
    expect(
      result
        .filter((field) => field.target.path.at(-1) === 'follow-up')
        .map((field) => field.value),
    ).toEqual(['2026-10-12', '2026-10-19']);
    expect(
      result.find(
        (field) => field.target.rootKey === 'onboarding' && field.target.path.length === 0,
      )?.unresolvedReason,
    ).toBe('waiting_completion');
  });
  it('preserves a known non-Task completion source as waiting even with a Project timestamp', () => {
    const fixture = legacyCompletionFixture();
    const steps = fixture.steps.map((step) =>
      step.key === 'follow-up'
        ? {
            ...step,
            timing: {
              kind: 'after_step_completion' as const,
              stepKey: 'onboarding',
              offsetDays: 2,
            },
          }
        : step,
    );
    const timing = translateLegacyScheduleFieldTiming({ ...fixture, steps });
    const mapping = fixtureValue(fixture.sourceMappings.find((entry) => entry.kind === 'project'));
    const result = deriveScheduleFieldTiming({
      ...timingInput(timing.rules, fixture.sourceMappings),
      actualMappings: [{ ...mapping, id: 'project' }],
      completionFacts: [
        { id: 'project', kind: 'project', state: 'completed', completedAt: '2026-11-05T20:00:00Z' },
      ],
    });
    expect(result.find((field) => field.target.path.at(-1) === 'follow-up')).toMatchObject({
      value: null,
      unresolvedReason: 'waiting_completion',
      manual: false,
    });
  });
  it('retains original dependency/completion cycle rejection when numeric fields override timing', () => {
    const fixture = legacyCompletionFixture();
    const steps = fixture.steps.map((step) =>
      step.key === 'interest-email'
        ? { ...step, dependsOn: ['follow-up'] }
        : step.key === 'follow-up'
          ? { ...step, fieldOverrides: { due_offset_days: 5 } }
          : step,
    );
    expect(() => translateLegacyScheduleFieldTiming({ ...fixture, steps })).toThrow(/cycle/);
  });
  it('rejects missing, kind-mismatched and out-of-range original mappings/offsets without clamping', () => {
    const fixture = legacyCompletionFixture();
    expect(() =>
      translateLegacyScheduleFieldTiming({
        ...fixture,
        sourceMappings: fixture.sourceMappings.slice(1),
      }),
    ).toThrow();
    expect(() =>
      translateLegacyScheduleFieldTiming({
        ...fixture,
        sourceMappings: fixture.sourceMappings.map((entry) => ({ ...entry, kind: 'task' })),
      }),
    ).toThrow();
    expect(() =>
      translateLegacyScheduleFieldTiming({
        ...fixture,
        steps: fixture.steps.map((step) => ({
          ...step,
          fieldOverrides: { start_offset_days: 36501 },
        })),
      }),
    ).toThrow();
  });
  it('rejects unrepresentable original completion offsets even when numeric fields win', () => {
    const fixture = legacyCompletionFixture();
    const steps = fixture.steps.map((step) =>
      step.key === 'follow-up'
        ? {
            ...step,
            timing: {
              kind: 'after_step_completion' as const,
              stepKey: 'interest-email',
              offsetDays: 36501,
            },
            fieldOverrides: { due_offset_days: 5 },
          }
        : step,
    );
    expect(() => translateLegacyScheduleFieldTiming({ ...fixture, steps })).toThrow();
  });
  it('normalizes version1 root primaries and work dates exactly without mutating source', () => {
    const venue = timingRef('venue'),
      food = timingRef('food');
    const input = {
      roots: [venue, food],
      selections: [
        { reference: venue, kind: 'project' as const },
        { reference: food, kind: 'task' as const },
      ],
      timing: [{ target: food, prerequisite: venue, offsetDays: -2 }],
    };
    const original = JSON.stringify(input);
    expect(
      deriveScheduleFieldTiming(
        timingInput(normalizeV1ScheduleFieldTiming(input).rules, input.selections),
      ).map((field) => [field.target.field, field.value]),
    ).toEqual([
      ['targetDate', '2026-11-01'],
      ['dueDate', '2026-10-30'],
    ]);
    expect(JSON.stringify(input)).toBe(original);
  });
  it('preserves version1 combined dependency/timing cycle rejection', () => {
    const venue = timingRef('venue'),
      food = timingRef('food');
    expect(() =>
      normalizeV1ScheduleFieldTiming({
        roots: [venue, food],
        selections: [
          { reference: venue, kind: 'project' },
          { reference: food, kind: 'task' },
        ],
        timing: [{ target: venue, prerequisite: food, offsetDays: 0 }],
        dependencies: [{ blocker: venue, blocked: food }],
      }),
    ).toThrow(/cycle/);
  });
  it('matches signed trigger offsets and when_ready interview completion fixture', () => {
    const fixture = legacyCompletionFixture();
    const steps = [
      fixtureValue(fixture.steps[0]),
      {
        key: 'interview',
        kind: 'task' as const,
        timing: {
          kind: 'after_step_completion' as const,
          stepKey: 'interest-email',
          offsetDays: 2,
        },
        fieldOverrides: {},
      },
      {
        key: 'reminder',
        kind: 'task' as const,
        timing: { kind: 'relative_to_trigger' as const, offsetDays: -3 },
        fieldOverrides: {},
      },
    ];
    const sourceMappings = steps.map((step) => ({
      sourceKey: step.key,
      kind: step.kind,
      reference: timingRef(step.key),
    }));
    const timing = translateLegacyScheduleFieldTiming({ steps, sourceMappings });
    const input = {
      ...timingInput(timing.rules, sourceMappings),
      runDate: '2026-09-01',
      actualMappings: [{ ...fixtureValue(sourceMappings[0]), id: 'email' }],
      completionFacts: [
        {
          id: 'email',
          kind: 'task' as const,
          state: 'completed' as const,
          completedAt: '2026-09-08T20:00:00Z',
        },
      ],
    };
    expect(deriveScheduleFieldTiming(input).map((field) => field.value)).toEqual([
      '2026-09-01',
      '2026-09-10',
      '2026-08-29',
    ]);
  });
});
