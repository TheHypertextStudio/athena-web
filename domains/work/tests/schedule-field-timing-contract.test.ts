import { describe, expect, it } from 'vitest';
import { WorkScheduleFieldTiming } from '../src/contracts/work-schedule-field-timing';
const target = { rootKey: 'dinner', path: ['prepare'], field: 'dueDate' };
const run = { target, source: { kind: 'run' }, offset: { days: -2, unit: 'calendar' } };
const document = (rules: unknown[]) => ({ kind: 'field_timing', revision: 2, rules });
describe('private field timing contract', () => {
  it('retains independent calendar and working fields with unmanaged absence', () => {
    const parsed = WorkScheduleFieldTiming.parse(
      document([
        run,
        { ...run, target: { ...target, field: 'startDate' }, offset: { days: 1, unit: 'working' } },
      ]),
    );
    expect(parsed.rules).toHaveLength(2);
    expect(WorkScheduleFieldTiming.parse(document([])).rules).toEqual([]);
  });
  it('rejects duplicate field ownership and negative actual completion offsets', () => {
    expect(WorkScheduleFieldTiming.safeParse(document([run, run])).success).toBe(false);
    expect(
      WorkScheduleFieldTiming.safeParse(
        document([
          {
            ...run,
            source: { kind: 'after_completion', works: [{ rootKey: 'email', path: [] }] },
          },
        ]),
      ).success,
    ).toBe(false);
  });
  it('rejects duplicate completion prerequisites and unknown source properties', () => {
    const ref = { rootKey: 'email', path: [] };
    expect(
      WorkScheduleFieldTiming.safeParse(
        document([
          {
            ...run,
            offset: { days: 2, unit: 'calendar' },
            source: { kind: 'after_completion', works: [ref, ref] },
          },
        ]),
      ).success,
    ).toBe(false);
    expect(
      WorkScheduleFieldTiming.safeParse(
        document([
          {
            ...run,
            source: { kind: 'run', processInstanceId: 'forged' },
          },
        ]),
      ).success,
    ).toBe(false);
  });
});
