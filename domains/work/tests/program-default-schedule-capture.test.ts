import { describe, expect, it } from 'vitest';
import { WorkTypeId } from '../src/ids';
import { captureDefaultScheduleOutline } from '../src/contracts/work-schedule-defaults';
import { CalendarRecurrenceSchedule } from '../src/contracts/recurrence';
const id = '01M4Y1B4B5V04E5ANJQ5QHTEZ8';
const base = {
  key: 'dinner',
  name: 'Dinner',
  template: {
    targetType: 'project' as const,
    workTypeId: WorkTypeId.parse(id),
    selection: { kind: 'latest' as const },
  },
  titlePattern: '{month} Dinner',
  cadence: CalendarRecurrenceSchedule.parse({
    kind: 'daily',
    startDate: '2026-10-17',
    timezone: 'UTC',
  }),
  creationDate: '2026-10-15',
  parent: { teamId: id, responsibleActorId: id },
  root: { teamId: id, responsibleActorId: id },
  hasPrivateAssignments: false,
  hasPrivateDraft: false,
  providerBound: false,
};
describe('capturing reusable Program schedule outlines', () => {
  it('captures relative cadence and parent rules without private location facts', () => {
    const captured = captureDefaultScheduleOutline(base);
    expect(captured.outline.cadence.startOffsetDays).toBe(2);
    expect(captured.outline.teamRule).toBe('parent_team');
    expect(captured.outline.actorRule).toBe('parent_responsible');
    expect(captured.outline).not.toHaveProperty('timezone');
    expect(captured.warnings).toEqual([]);
  });
  it('warns explicitly when private assignments, drafts, provider bindings or date ends are omitted', () => {
    const captured = captureDefaultScheduleOutline({
      ...base,
      root: { teamId: null, responsibleActorId: 'other' },
      hasPrivateAssignments: true,
      hasPrivateDraft: true,
      providerBound: true,
      cadence: { ...base.cadence, end: { kind: 'on_date', date: '2027-01-01' } },
    });
    expect(captured.outline.actorRule).toBe('unassigned');
    expect(captured.outline.cadence.end).toEqual({ kind: 'never' });
    expect(captured.warnings).toEqual([
      'capture_schedule_assignment',
      'capture_schedule_draft',
      'capture_schedule_provider',
      'capture_schedule_cadence',
    ]);
  });
});
