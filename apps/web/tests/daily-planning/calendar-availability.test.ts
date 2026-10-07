import { describe, expect, it } from 'vitest';
import type { DailyPlanSession, DailyPlanSnapshot } from '@docket/planning/daily-plan-flow';
import {
  capacityMinutes,
  nextAvailableStart,
  placeSession,
} from '../../src/components/daily-planning/daily-planning-model';

const start = '2026-10-07T09:00:00.000Z';
const finish = '2026-10-07T17:00:00.000Z';
const free = { startsAt: start, endsAt: finish, blocksTime: false };
const busy = {
  startsAt: '2026-10-07T12:00:00.000Z',
  endsAt: '2026-10-07T13:00:00.000Z',
  blocksTime: true,
};
const draft: DailyPlanSnapshot = {
  date: '2026-10-07',
  mainTaskId: null,
  finishAt: finish,
  tasks: [{ taskId: 'work', organizationId: 'org', plannedMinutes: 30, sort: 0 }],
  sessions: [],
};
const session: DailyPlanSession = {
  id: 'manual',
  startsAt: start,
  endsAt: '2026-10-07T09:30:00.000Z',
  allocations: [{ taskId: 'work', plannedMinutes: 30 }],
  pinned: false,
};

describe('provider calendar availability', () => {
  it('subtracts only busy time and keeps the first slot available across free context', () => {
    expect(capacityMinutes(start, finish, [free, busy])).toBe(420);
    expect(nextAvailableStart(start, 30, finish, [free, busy])).toBe(start);
    expect(nextAvailableStart(busy.startsAt, 30, finish, [free, busy])).toBe(busy.endsAt);
  });
  it('permits manual work over free events and rejects busy events', () => {
    expect(placeSession(draft, session, [free], start).sessions).toEqual([session]);
    expect(() =>
      placeSession(
        draft,
        { ...session, startsAt: busy.startsAt, endsAt: busy.endsAt },
        [busy],
        start,
      ),
    ).toThrow('overlaps');
  });
  it('blocks a busy all-day event while leaving a free all-day event available', () => {
    const allDay = { startsAt: '2026-10-07T00:00:00.000Z', endsAt: '2026-10-08T00:00:00.000Z' };
    expect(capacityMinutes(start, finish, [{ ...allDay, blocksTime: false }])).toBe(480);
    expect(() => placeSession(draft, session, [{ ...allDay, blocksTime: true }], start)).toThrow(
      'overlaps',
    );
    expect(capacityMinutes(start, finish, [allDay])).toBe(0);
  });
});
