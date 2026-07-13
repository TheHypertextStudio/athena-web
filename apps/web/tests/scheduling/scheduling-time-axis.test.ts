import { describe, expect, it } from 'vitest';

import {
  deriveScheduleTicks,
  majorTickInterval,
  resolveScheduleTimezone,
  scheduleDateRange,
  scheduleInstantAt,
} from '@/components/scheduling';

describe('schedule wall-clock model', () => {
  it('uses exact local-midnight boundaries across a spring-forward date', () => {
    expect(scheduleDateRange('2026-03-08', 1, 'America/Los_Angeles')).toEqual({
      startISO: '2026-03-08T08:00:00Z',
      endISO: '2026-03-09T07:00:00Z',
    });
  });

  it('disambiguates repeated times and rejects skipped times', () => {
    expect(scheduleInstantAt('2026-11-01', 90, 'America/Los_Angeles', 'earlier')).not.toBe(
      scheduleInstantAt('2026-11-01', 90, 'America/Los_Angeles', 'later'),
    );
    expect(scheduleInstantAt('2026-03-08', 150, 'America/Los_Angeles', 'reject')).toBeNull();
  });

  it('falls back from an invalid preferred timezone to the viewer timezone', () => {
    expect(resolveScheduleTimezone('Not/A_Timezone')).toBe(resolveScheduleTimezone());
    expect(resolveScheduleTimezone('America/Los_Angeles')).toBe('America/Los_Angeles');
  });
});

describe('schedule ticks', () => {
  it('keeps major labels at least 44 physical pixels apart across supported zoom', () => {
    expect(majorTickInterval(24)).toBe(120);
    expect(majorTickInterval(72)).toBe(60);
    expect(majorTickInterval(144)).toBe(30);
    expect(majorTickInterval(240)).toBe(15);
  });

  it('emits every active snap from midnight through the exact zoom endpoints', () => {
    const overviewTicks = deriveScheduleTicks({
      date: '2026-07-01',
      timezone: 'UTC',
      pixelsPerHour: 24,
    });
    const detailTicks = deriveScheduleTicks({
      date: '2026-07-01',
      timezone: 'UTC',
      pixelsPerHour: 240,
    });

    expect(overviewTicks).toHaveLength(49);
    expect(overviewTicks[0]?.wallMinutes).toBe(0);
    expect(overviewTicks.at(-1)?.wallMinutes).toBe(24 * 60);
    expect(overviewTicks.find((tick) => tick.wallMinutes === 60)?.kind).toBe('minor');
    expect(overviewTicks.find((tick) => tick.wallMinutes === 120)?.kind).toBe('major');

    expect(detailTicks).toHaveLength(289);
    expect(detailTicks[0]?.wallMinutes).toBe(0);
    expect(detailTicks.at(-1)?.wallMinutes).toBe(24 * 60);
    expect(detailTicks.find((tick) => tick.wallMinutes === 5)?.kind).toBe('minor');
    expect(detailTicks.find((tick) => tick.wallMinutes === 15)?.kind).toBe('major');
  });

  it('formats the same wall time according to the requested locale', () => {
    const usTick = deriveScheduleTicks({
      date: '2026-07-01',
      timezone: 'UTC',
      pixelsPerHour: 24,
      locale: 'en-US',
    }).find((tick) => tick.wallMinutes === 13 * 60);
    const britishTick = deriveScheduleTicks({
      date: '2026-07-01',
      timezone: 'UTC',
      pixelsPerHour: 24,
      locale: 'en-GB',
    }).find((tick) => tick.wallMinutes === 13 * 60);

    expect(usTick?.label).toBe('1:00 PM');
    expect(britishTick?.label).toBe('13:00');
  });

  it('marks nonexistent spring times as skipped without changing their wall label', () => {
    const skippedTick = deriveScheduleTicks({
      date: '2026-03-08',
      timezone: 'America/Los_Angeles',
      pixelsPerHour: 240,
      locale: 'en-US',
    }).find((tick) => tick.wallMinutes === 150);

    expect(skippedTick).toMatchObject({
      wallMinutes: 150,
      label: '2:30 AM',
      kind: 'major',
      transition: 'skipped',
    });
  });

  it('marks ambiguous fall times as repeated', () => {
    const repeatedTick = deriveScheduleTicks({
      date: '2026-11-01',
      timezone: 'America/Los_Angeles',
      pixelsPerHour: 240,
      locale: 'en-US',
    }).find((tick) => tick.wallMinutes === 90);

    expect(repeatedTick).toMatchObject({
      wallMinutes: 90,
      label: '1:30 AM',
      kind: 'major',
      transition: 'repeated',
    });
  });
});
