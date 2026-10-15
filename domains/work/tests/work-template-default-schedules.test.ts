import { describe, expect, it } from 'vitest';
import { WorkTemplateDefinition } from '../src/contracts/work-template';
import { ProgramDefaultSchedule } from '../src/contracts/work-schedule-defaults';
const outline = ProgramDefaultSchedule.parse({
  key: 'dinner',
  name: 'Dinner',
  template: {
    targetType: 'project',
    workTypeId: '01M4Y1B4B5V04E5ANJQ5QHTEZ8',
    selection: { kind: 'latest' },
  },
  titlePattern: '{month} Dinner',
  cadence: { kind: 'monthly', pattern: { kind: 'nth_weekday', ordinal: 2, weekday: 'thursday' } },
  teamRule: 'parent_team',
  actorRule: 'parent_responsible',
});
describe('Program template default schedules', () => {
  it('normalizes old immutable definitions without changing the input', () => {
    const old = { name: 'Program', payload: { targetType: 'program' } };
    expect(WorkTemplateDefinition.parse(old).defaultSchedules).toEqual([]);
    expect(old).not.toHaveProperty('defaultSchedules');
  });
  it('accepts independent reusable schedules only on Program definitions', () => {
    const definition = WorkTemplateDefinition.parse({
      name: 'Program',
      payload: { targetType: 'program' },
      defaultSchedules: [outline],
    });
    expect(definition.defaultSchedules).toEqual([outline]);
    for (const targetType of ['task', 'project', 'initiative'])
      expect(
        WorkTemplateDefinition.safeParse({
          name: 'Other',
          payload: { targetType },
          defaultSchedules: [outline],
        }).success,
      ).toBe(false);
  });
});
