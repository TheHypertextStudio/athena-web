import { describe, expect, it } from 'vitest';
import {
  WorkScheduleCreate,
  WorkScheduleRevisionCreate,
  WorkScheduleRunRequest,
} from '../src/contracts/work-schedule-management';
const id = '01M4Y1B4B5V04E5ANJQ5QHTEZ8';
function command() {
  return {
    ownerProgramId: id,
    name: 'Community dinner',
    effectiveFrom: '2026-10-01',
    trigger: {
      kind: 'calendar',
      schedule: {
        kind: 'monthly',
        interval: 1,
        startDate: '2026-10-01',
        timezone: 'America/Los_Angeles',
        end: { kind: 'never' },
        pattern: { kind: 'nth_weekday', ordinal: 2, weekday: 'thursday' },
      },
    },
    document: {
      kind: 'schedule',
      revision: 1,
      template: { targetType: 'project', workTypeId: id, selection: { kind: 'latest' } },
      titlePattern: '{month} Dinner',
      timezone: 'America/Los_Angeles',
      root: { kind: 'project', fields: {}, dates: {}, placement: { programId: id } },
      stepOverrides: [],
      optionalChoices: [],
    },
  };
}
describe('schedule management commands', () => {
  it('accepts an independently owned dinner schedule and supplies existing calendar policies', () => {
    const result = WorkScheduleCreate.parse(command());
    expect(result.trigger.kind).toBe('calendar');
    if (result.trigger.kind === 'calendar')
      expect(result.trigger.materialization.minimumOccurrences).toBe(2);
    expect(result.document.titlePattern).toBe('{month} Dinner');
  });
  it('refuses mismatched timezone and owning Program without partial mutation', () => {
    const input = command();
    expect(
      WorkScheduleCreate.safeParse({ ...input, document: { ...input.document, timezone: 'UTC' } })
        .success,
    ).toBe(false);
    expect(
      WorkScheduleCreate.safeParse({ ...input, ownerProgramId: '01BX5ZZKBKACTAV9WEVGEMMVRZ' })
        .success,
    ).toBe(false);
  });
  it('refuses caller-authored retained claims, history and forest execution through authoring', () => {
    for (const field of ['acceptedClaim', 'authoringFallback', 'createdBy', 'historicalArchive'])
      expect(WorkScheduleCreate.safeParse({ ...command(), [field]: {} }).success).toBe(false);
    expect(
      WorkScheduleCreate.safeParse({
        ...command(),
        document: { kind: 'forest', revision: 1, state: 'published', roots: [] },
      }).success,
    ).toBe(false);
  });
  it('requires the reviewed revision and prevents ownership changes in future edits', () => {
    const { ownerProgramId: _owner, ...body } = command();
    expect(WorkScheduleRevisionCreate.safeParse(body).success).toBe(false);
    expect(WorkScheduleRevisionCreate.safeParse({ ...body, expectedRevisionId: id }).success).toBe(
      true,
    );
    expect(
      WorkScheduleRevisionCreate.safeParse({ ...body, expectedRevisionId: id, ownerProgramId: id })
        .success,
    ).toBe(false);
  });
  it('bounds retry-safe keys and rejects invalid civil dates', () => {
    expect(
      WorkScheduleRunRequest.parse({ scheduledFor: '2026-10-08', occurrenceKey: 'dinner-october' })
        .occurrenceKey,
    ).toBe('dinner-october');
    expect(WorkScheduleRunRequest.safeParse({ scheduledFor: '2026-02-30' }).success).toBe(false);
    expect(
      WorkScheduleRunRequest.safeParse({
        scheduledFor: '2026-10-08',
        occurrenceKey: 'x'.repeat(257),
      }).success,
    ).toBe(false);
  });
});
