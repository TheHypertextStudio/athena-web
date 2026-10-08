import { localMinuteOfDay } from '@docket/planning/zoned-time';
import { describe, expect, it } from 'vitest';
import { planningTimezone } from '../../e2e/helpers/planning-timezone';

describe('planning fixture timezone', () => {
  it.each(['2026-01-07', '2026-07-07', '2026-10-08'])(
    'keeps morning and review fixtures within working hours throughout %s',
    (date) => {
      for (let hour = 0; hour < 24; hour += 1) {
        const now = new Date(`${date}T${String(hour).padStart(2, '0')}:09:00Z`);
        for (const [from, through] of [
          [600, 780],
          [900, 1200],
        ] as const) {
          const timezone = planningTimezone(from, through, now);
          const minute = localMinuteOfDay(now, timezone);
          expect(minute).toBeGreaterThanOrEqual(from);
          expect(minute).toBeLessThanOrEqual(through);
        }
      }
    },
  );
});
