import { describe, expect, it } from 'vitest';
import {
  ProgramDefaultSchedule,
  ProgramDefaultSchedules,
  RelativeCalendarRecurrenceSchedule,
  instantiateRelativeCadence,
} from '../src/contracts/work-schedule-defaults';
const templateId = '01M4Y1B4B5V04E5ANJQ5QHTEZ8';
function dinner(key = 'dinner') {
  return {
    key,
    name: 'Community dinner',
    template: { targetType: 'project', workTypeId: templateId, selection: { kind: 'latest' } },
    titlePattern: '{month} Dinner',
    cadence: {
      kind: 'monthly',
      interval: 1,
      startOffsetDays: 0,
      pattern: { kind: 'nth_weekday', ordinal: 2, weekday: 'thursday' },
      end: { kind: 'after_count', count: 12 },
    },
    teamRule: 'parent_team',
    actorRule: 'parent_responsible',
  };
}
describe('reusable Program default schedules', () => {
  it('parses a strict relative second-Thursday default without location literals', () => {
    expect(ProgramDefaultSchedule.parse(dinner())).toEqual(dinner());
    expect(RelativeCalendarRecurrenceSchedule.parse({ kind: 'daily' })).toEqual({
      kind: 'daily',
      interval: 1,
      startOffsetDays: 0,
      end: { kind: 'never' },
    });
  });
  it('accepts explicit pinned Task selection and rejects wrong target or missing published version', () => {
    const value = dinner();
    expect(
      ProgramDefaultSchedule.safeParse({
        ...value,
        template: {
          targetType: 'task',
          workTypeId: templateId,
          selection: { kind: 'pinned', workTypeVersionId: templateId },
        },
      }).success,
    ).toBe(true);
    for (const template of [
      { targetType: 'program', workTypeId: templateId, selection: { kind: 'latest' } },
      { targetType: 'task', workTypeId: templateId, selection: { kind: 'pinned' } },
      { targetType: 'task', selection: { kind: 'latest' } },
    ])
      expect(ProgramDefaultSchedule.safeParse({ ...value, template }).success).toBe(false);
  });
  it('rejects private dates/timezones/placements/actors/providers and duplicate weekdays', () => {
    for (const [field, value] of Object.entries({
      startDate: '2026-10-14',
      timezone: 'UTC',
      teamId: templateId,
      actorId: templateId,
      programId: templateId,
      provider: 'google',
    })) {
      expect(ProgramDefaultSchedule.safeParse({ ...dinner(), [field]: value }).success).toBe(false);
      expect(
        ProgramDefaultSchedule.safeParse({
          ...dinner(),
          cadence: { ...dinner().cadence, [field]: value },
        }).success,
      ).toBe(false);
    }
    expect(
      RelativeCalendarRecurrenceSchedule.safeParse({
        kind: 'weekly',
        weekdays: ['monday', 'monday'],
      }).success,
    ).toBe(false);
    expect(
      RelativeCalendarRecurrenceSchedule.safeParse({
        kind: 'daily',
        end: { kind: 'on_date', date: '2026-12-31' },
      }).success,
    ).toBe(false);
  });
  it('enforces20 defaults and distinct stable keys while keeping independent parsed copies', () => {
    expect(
      ProgramDefaultSchedules.parse(Array.from({ length: 20 }, (_, i) => dinner(`dinner_${i}`))),
    ).toHaveLength(20);
    expect(
      ProgramDefaultSchedules.safeParse(Array.from({ length: 21 }, (_, i) => dinner(`dinner_${i}`)))
        .success,
    ).toBe(false);
    expect(ProgramDefaultSchedules.safeParse([dinner(), dinner()]).success).toBe(false);
    const a = ProgramDefaultSchedule.parse(dinner()),
      b = ProgramDefaultSchedule.parse(dinner());
    a.cadence.interval = 2;
    expect(b.cadence.interval).toBe(1);
  });
  it('instantiates a relative cadence from the Program civil date with shared calendar arithmetic', () => {
    const cadence = RelativeCalendarRecurrenceSchedule.parse({
      kind: 'weekly',
      weekdays: ['thursday'],
      startOffsetDays: -2,
      end: { kind: 'after_count', count: 4 },
    });
    expect(
      instantiateRelativeCadence(cadence, {
        creationDate: '2028-03-01',
        timezone: 'America/Los_Angeles',
      }),
    ).toEqual({
      kind: 'weekly',
      interval: 1,
      startDate: '2028-02-28',
      timezone: 'America/Los_Angeles',
      weekdays: ['thursday'],
      end: { kind: 'after_count', count: 4 },
    });
    expect(() =>
      instantiateRelativeCadence(cadence, { creationDate: '2026-02-29', timezone: 'UTC' }),
    ).toThrow();
  });
});
