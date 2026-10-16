import { describe, expect, it } from 'vitest';
import type { WorkScheduleFieldRule } from '../src/contracts/work-schedule-field-timing';
import { deriveScheduleFieldTiming } from '../src/schedule-field-timing';
import { validateScheduleFieldTiming } from '../src/schedule-field-timing-validation';
import { fixtureValue, timingInput, timingRef } from './schedule-field-timing-fixture';

const project = timingRef('dinner'),
  task = timingRef('dinner', ['prepare']);
const selections = [
  { reference: project, kind: 'project' as const },
  { reference: task, kind: 'task' as const },
];
const rule: WorkScheduleFieldRule = {
  target: { ...project, field: 'startDate' },
  source: { kind: 'after_completion', works: [task] },
  offset: { days: 2, unit: 'calendar' },
};
const mapping = { ...fixtureValue(selections[1]), id: 'actual-prepare-task' };
const fact = {
  id: mapping.id,
  kind: 'task' as const,
  state: 'completed' as const,
  completedAt: '2026-11-06T07:30:00Z',
};
const completed = () => ({
  ...timingInput([rule], selections),
  actualMappings: [mapping],
  completionFacts: [fact],
});

describe('private fields through shared blueprint derivation', () => {
  it('allows a Project start to wait on its actual nested Task without a physical-parent cycle', () => {
    expect(deriveScheduleFieldTiming(timingInput([rule], selections))).toMatchObject([
      { value: null, unresolvedReason: 'waiting_completion', manual: false },
    ]);
    expect(deriveScheduleFieldTiming(completed())).toMatchObject([{ value: '2026-11-07' }]);
  });
  it('uses saved timezone, latest actual prerequisite and working calendar across DST', () => {
    const second = timingRef('other', ['prepare']);
    const input = {
      ...completed(),
      timing: {
        kind: 'field_timing' as const,
        revision: 2 as const,
        rules: [
          {
            ...rule,
            source: { kind: 'after_completion' as const, works: [task, second] },
            offset: { days: 1, unit: 'working' as const },
          },
        ],
      },
      selections: [...selections, { reference: second, kind: 'task' as const }],
      actualMappings: [mapping, { reference: second, kind: 'task' as const, id: 'second-task' }],
      completionFacts: [fact, { ...fact, id: 'second-task', completedAt: '2026-11-08T08:30:00Z' }],
    };
    expect(deriveScheduleFieldTiming(input)[0]?.value).toBe('2026-11-09');
    expect(deriveScheduleFieldTiming({ ...completed(), timezone: 'Asia/Tokyo' })[0]?.value).toBe(
      '2026-11-08',
    );
  });
  it('reopening/canceling removes derived completion dates and late completion re-derives', () => {
    for (const state of ['open', 'canceled'] as const)
      expect(
        deriveScheduleFieldTiming({ ...completed(), completionFacts: [{ ...fact, state }] })[0],
      ).toMatchObject({ value: null, unresolvedReason: 'waiting_completion' });
    expect(
      deriveScheduleFieldTiming({
        ...completed(),
        completionFacts: [{ ...fact, completedAt: null }],
      })[0]?.value,
    ).toBeNull();
    expect(
      deriveScheduleFieldTiming({
        ...completed(),
        completionFacts: [{ ...fact, completedAt: '2026-12-01T20:00:00Z' }],
      })[0]?.value,
    ).toBe('2026-12-03');
  });
  it('requires exact actual identity/kind; replacement same-path and unrelated facts cannot satisfy', () => {
    expect(
      deriveScheduleFieldTiming({
        ...completed(),
        completionFacts: [{ ...fact, id: 'replacement' }],
      })[0]?.value,
    ).toBeNull();
    expect(
      deriveScheduleFieldTiming({
        ...completed(),
        completionFacts: [{ ...fact, kind: 'project' }],
      })[0]?.value,
    ).toBeNull();
    expect(deriveScheduleFieldTiming({ ...completed(), actualMappings: [] })[0]?.value).toBeNull();
    expect(() =>
      deriveScheduleFieldTiming({ ...completed(), actualMappings: [mapping, mapping] }),
    ).toThrow(/Ambiguous/);
    expect(() =>
      deriveScheduleFieldTiming({ ...completed(), completionFacts: [fact, fact] }),
    ).toThrow(/Ambiguous/);
  });
  it('keeps explicit null and same-value pins independent from waiting/derived state', () => {
    const targetRule: WorkScheduleFieldRule = {
      target: { ...project, field: 'targetDate' },
      source: { kind: 'run' },
      offset: { days: 10, unit: 'calendar' },
    };
    const input = {
      ...completed(),
      timing: { ...completed().timing, rules: [rule, targetRule] },
      pins: [{ target: rule.target, value: null }],
    };
    expect(deriveScheduleFieldTiming(input)).toMatchObject([
      { value: null, manual: true, unresolvedReason: null },
      { value: '2026-11-11', manual: false },
    ]);
    expect(
      deriveScheduleFieldTiming({
        ...completed(),
        pins: [{ target: rule.target, value: '2026-11-07' }],
      })[0],
    ).toMatchObject({ value: '2026-11-07', manual: true });
  });
  it('distinguishes an explicit null while waiting from managed waiting null and missing/deleted facts', () => {
    const input = timingInput([rule], selections);
    expect(
      deriveScheduleFieldTiming({ ...input, pins: [{ target: rule.target, value: null }] })[0],
    ).toMatchObject({ value: null, manual: true, unresolvedReason: null });
    expect(deriveScheduleFieldTiming({ ...completed(), completionFacts: [] })[0]).toMatchObject({
      value: null,
      manual: false,
      unresolvedReason: 'waiting_completion',
    });
  });
  it('follows exact source fields across roots and retains unmanaged pinned prerequisites', () => {
    const other = timingRef('other');
    const source = { ...other, field: 'startDate' as const };
    const downstream: WorkScheduleFieldRule = {
      target: { ...task, field: 'dueDate' },
      source: { kind: 'work_date', work: other, field: 'startDate' },
      offset: { days: 1, unit: 'calendar' },
    };
    const input = {
      ...timingInput([downstream], [...selections, { reference: other, kind: 'project' as const }]),
      dates: [{ reference: other, dates: { startDate: '2026-11-05', targetDate: '2026-12-01' } }],
    };
    expect(deriveScheduleFieldTiming(input)[0]?.value).toBe('2026-11-06');
    expect(
      deriveScheduleFieldTiming({ ...input, pins: [{ target: source, value: null }] })[0],
    ).toMatchObject({ value: null, unresolvedReason: 'missing_anchor' });
    expect(deriveScheduleFieldTiming(input)).toHaveLength(1);
  });
  it('derives managed source fields irrespective of input order without mutating frozen facts', () => {
    const follow: WorkScheduleFieldRule = {
      target: { ...task, field: 'dueDate' },
      source: { kind: 'work_date', work: project, field: 'startDate' },
      offset: { days: 3, unit: 'calendar' },
    };
    const input = { ...completed(), timing: { ...completed().timing, rules: [follow, rule] } };
    const before = JSON.stringify(input);
    expect(deriveScheduleFieldTiming(input).map((field) => field.value)).toEqual([
      '2026-11-10',
      '2026-11-07',
    ]);
    expect(JSON.stringify(input)).toBe(before);
  });
  it('rejects reversed windows and invalid civil/instant/timezone snapshots', () => {
    expect(() =>
      deriveScheduleFieldTiming({
        ...completed(),
        dates: [{ reference: project, dates: { targetDate: '2026-11-01' } }],
      }),
    ).toThrow(/backwards/);
    expect(() => deriveScheduleFieldTiming({ ...completed(), runDate: '2026-02-30' })).toThrow();
    expect(() =>
      deriveScheduleFieldTiming({ ...completed(), timezone: 'Invalid/Timezone' }),
    ).toThrow();
    expect(() =>
      deriveScheduleFieldTiming({
        ...completed(),
        completionFacts: [{ ...fact, completedAt: 'invalid' }],
      }),
    ).toThrow(/instant/);
  });
});
describe('selected private field validation', () => {
  it('rejects missing paths and incompatible target/source fields', () => {
    expect(() => {
      validateScheduleFieldTiming(
        {
          kind: 'field_timing',
          revision: 2,
          rules: [{ ...rule, target: { ...project, field: 'dueDate' } }],
        },
        selections,
      );
    }).toThrow(/field/);
    expect(() => {
      validateScheduleFieldTiming(
        { kind: 'field_timing', revision: 2, rules: [rule] },
        selections.slice(0, 1),
      );
    }).toThrow(/completion/);
    const dateRule: WorkScheduleFieldRule = {
      ...rule,
      source: { kind: 'work_date', work: task, field: 'targetDate' },
    };
    expect(() => {
      validateScheduleFieldTiming(
        { kind: 'field_timing', revision: 2, rules: [dateRule] },
        selections,
      );
    }).toThrow(/field/);
  });
  it('checks field cycles precisely and dependency/completion cycles separately', () => {
    const start: WorkScheduleFieldRule = {
      ...rule,
      source: { kind: 'work_date', work: project, field: 'targetDate' },
    };
    const end: WorkScheduleFieldRule = {
      ...rule,
      target: { ...project, field: 'targetDate' },
      source: { kind: 'run' },
    };
    expect(() => {
      validateScheduleFieldTiming(
        { kind: 'field_timing', revision: 2, rules: [start, end] },
        selections,
      );
    }).not.toThrow();
    expect(() => {
      validateScheduleFieldTiming(
        {
          kind: 'field_timing',
          revision: 2,
          rules: [
            start,
            { ...end, source: { kind: 'work_date', work: project, field: 'startDate' } },
          ],
        },
        selections,
      );
    }).toThrow(/cycle/);
    expect(() => {
      validateScheduleFieldTiming(
        { kind: 'field_timing', revision: 2, rules: [rule] },
        selections,
        [{ blocker: project, blocked: task }],
      );
    }).toThrow(/cycle/);
  });
  it('bounds the combined distinct private prerequisite graph using shared blueprint limits', () => {
    const selected = Array.from({ length: 51 }, (_, index) => ({
      reference: timingRef(`node_${index}`),
      kind: 'task' as const,
    }));
    const rules: WorkScheduleFieldRule[] = selected.slice(1).map(({ reference }, index) => ({
      target: { ...reference, field: 'dueDate' },
      source: {
        kind: 'after_completion',
        works: selected.slice(0, index + 1).map((entry) => entry.reference),
      },
      offset: { days: 0, unit: 'calendar' },
    }));
    // 1+...+50 = 1275 distinct actual-work prerequisite edges.
    expect(() => {
      validateScheduleFieldTiming({ kind: 'field_timing', revision: 2, rules }, selected);
    }).not.toThrow();
    const larger = Array.from({ length: 65 }, (_, index) => ({
      reference: timingRef(`node_${index}`),
      kind: 'task' as const,
    }));
    const excessive: WorkScheduleFieldRule[] = larger.slice(1).map(({ reference }, index) => ({
      target: { ...reference, field: 'dueDate' },
      source: {
        kind: 'after_completion',
        works: larger.slice(0, index + 1).map((entry) => entry.reference),
      },
      offset: { days: 0, unit: 'calendar' },
    }));
    expect(() => {
      validateScheduleFieldTiming({ kind: 'field_timing', revision: 2, rules: excessive }, larger);
    }).toThrow(/2000/);
  });
  it('bounds 500 physical selections independently from 1000 field rules', () => {
    const selected = Array.from({ length: 500 }, (_, index) => ({
      reference: timingRef(`task_${index}`),
      kind: 'task' as const,
    }));
    const rules: WorkScheduleFieldRule[] = selected.flatMap(({ reference }) =>
      (['startDate', 'dueDate'] as const).map((field) => ({
        target: { ...reference, field },
        source: { kind: 'run' },
        offset: { days: 0, unit: 'calendar' },
      })),
    );
    expect(() => {
      validateScheduleFieldTiming({ kind: 'field_timing', revision: 2, rules }, selected);
    }).not.toThrow();
    expect(() => {
      validateScheduleFieldTiming({ kind: 'field_timing', revision: 2, rules }, [
        ...selected,
        { reference: timingRef('extra'), kind: 'task' },
      ]);
    }).toThrow(/500/);
    expect(() => {
      validateScheduleFieldTiming(
        {
          kind: 'field_timing',
          revision: 2,
          rules: [...rules, { ...rule, target: { ...project, field: 'startDate' } }],
        },
        selected,
      );
    }).toThrow();
  });
});
