import { describe, expect, it } from 'vitest';
import type { BlueprintInvocationOverride } from '@docket/db';
import { deriveBlueprintDate } from '@docket/work/blueprints';
import { retainedDateRule } from '../../src/lib/recurrence/work-template-date-rules';
const preset: BlueprintInvocationOverride = {
  sourceStepId: 'second',
  kind: 'task',
  fields: { title: 'Second' },
  timing: { kind: 'after_step_completion', afterStepId: 'first', offsetDays: 2 },
};
describe('private recurrence rules use shared date derivation', () => {
  it('keeps numeric due offsets anchored to runDate independently of readiness timing', () => {
    expect(retainedDateRule({ ...preset, fields: { due_offset_days: 5 } }, 'dueDate')).toEqual({
      kind: 'anchor',
      anchor: { kind: 'parent' },
      offset: { days: 5, unit: 'calendar' },
    });
  });
  it('retains completion fallback only for the original primary date field', () => {
    const rule = retainedDateRule(preset, 'dueDate');
    expect(rule).toMatchObject({
      kind: 'after_completion',
      stepKeys: ['s_first'],
      offset: { days: 2, unit: 'calendar' },
    });
    expect(retainedDateRule(preset, 'startDate')).toBeNull();
    expect(retainedDateRule({ ...preset, kind: 'project' }, 'targetDate')).toBeNull();
    expect(retainedDateRule({ ...preset, kind: 'milestone' }, 'targetDate')).toMatchObject({
      kind: 'after_completion',
    });
    if (!rule) throw new Error('Missing expected rule');
    expect(
      deriveBlueprintDate({
        rule,
        parentAnchor: '2026-10-14',
        milestoneAnchors: {},
        scopePath: [],
        completions: [
          { path: ['s_first'], state: 'completed', completedAt: '2026-10-17T03:00:00Z' },
        ],
        timezone: 'America/Los_Angeles',
        workingWeekdays: [1, 2, 3, 4, 5],
      }).value,
    ).toBe('2026-10-18');
  });
});
