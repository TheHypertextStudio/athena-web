import { present } from './blueprint-fixtures';
import { describe, expect, it } from 'vitest';
import {
  deriveBlueprintDate,
  offsetBlueprintDate,
  completionCivilDate,
} from '../src/blueprints/dates';
import { BlueprintDateRule } from '../src/contracts/work-template-blueprint';
const weekdays = [1, 2, 3, 4, 5];
describe('civil relative blueprint timing', () => {
  it('applies signed calendar offsets, working offsets and strict weekday snaps', () => {
    expect(offsetBlueprintDate('2026-10-08', { days: -21, unit: 'calendar' }, weekdays)).toBe(
      '2026-09-17',
    );
    expect(offsetBlueprintDate('2026-10-09', { days: 1, unit: 'working' }, weekdays)).toBe(
      '2026-10-12',
    );
    expect(offsetBlueprintDate('2026-10-12', { days: -1, unit: 'working' }, weekdays)).toBe(
      '2026-10-09',
    );
    expect(offsetBlueprintDate('2026-10-10', { days: 0, unit: 'working' }, weekdays)).toBe(
      '2026-10-10',
    );
    expect(
      offsetBlueprintDate('2026-10-12', { days: 0, unit: 'calendar' }, weekdays, {
        direction: 'next',
        weekday: 1,
        inclusive: false,
      }),
    ).toBe('2026-10-19');
    expect(
      offsetBlueprintDate('2026-10-12', { days: 0, unit: 'calendar' }, weekdays, {
        direction: 'previous',
        weekday: 1,
        inclusive: true,
      }),
    ).toBe('2026-10-12');
  });
  it('is stable across leap days, DST transitions and nonstandard working weeks', () => {
    expect(offsetBlueprintDate('2028-03-01', { days: -1, unit: 'calendar' }, weekdays)).toBe(
      '2028-02-29',
    );
    expect(offsetBlueprintDate('2026-03-07', { days: 2, unit: 'calendar' }, weekdays)).toBe(
      '2026-03-09',
    );
    expect(offsetBlueprintDate('2026-10-09', { days: 1, unit: 'working' }, [7])).toBe('2026-10-11');
    expect(completionCivilDate('2026-03-08T07:30:00Z', 'America/Los_Angeles')).toBe('2026-03-07');
    expect(() =>
      offsetBlueprintDate('1970-01-01', { days: -1, unit: 'calendar' }, weekdays),
    ).toThrow();
  });
  it('waits for every actual sibling completion and ignores canceled siblings', () => {
    const rule = BlueprintDateRule.parse({
      kind: 'after_completion',
      stepKeys: ['one', 'two', 'three'],
      offset: { days: 1, unit: 'working' },
    });
    const completions = [
      '2026-10-08T10:00:00Z',
      '2026-10-09T10:00:00Z',
      '2026-10-07T10:00:00Z',
    ].map((completedAt, i) => ({
      path: [present(['one', 'two', 'three'][i])],
      state: 'completed' as const,
      completedAt,
    }));
    const input = {
      rule,
      parentAnchor: null,
      milestoneAnchors: {},
      scopePath: [],
      completions,
      timezone: 'UTC',
      workingWeekdays: weekdays,
    };
    expect(deriveBlueprintDate(input)).toEqual({ value: '2026-10-12', unresolvedReason: null });
    expect(
      deriveBlueprintDate({
        ...input,
        completions: completions.map((fact, i) =>
          i === 0 ? { ...fact, state: 'canceled' as const } : fact,
        ),
      }),
    ).toEqual({ value: null, unresolvedReason: 'waiting_completion' });
  });
});

it('rejects malformed direct timing operands instead of rounding working offsets', () => {
  expect(() =>
    offsetBlueprintDate('2026-10-08', { days: 0.5, unit: 'working' }, [1, 2, 3, 4, 5]),
  ).toThrow();
});
