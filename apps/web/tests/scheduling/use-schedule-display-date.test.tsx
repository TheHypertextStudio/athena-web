import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useScheduleDisplayDate } from '@/components/scheduling';

const NOW = '2026-07-02T06:30:00Z';

describe('useScheduleDisplayDate', () => {
  it('reconciles one implicit initial date when Hub timezone preferences first hydrate', () => {
    const { result, rerender } = renderHook(
      ({ displayTimezone, preferencesReady }) =>
        useScheduleDisplayDate({ displayTimezone, preferencesReady, now: NOW }),
      {
        initialProps: {
          displayTimezone: 'America/Los_Angeles',
          preferencesReady: false,
        },
      },
    );
    expect(result.current.date).toBe('2026-07-01');

    rerender({ displayTimezone: 'Asia/Tokyo', preferencesReady: true });

    expect(result.current.date).toBe('2026-07-02');
    expect(result.current.today).toBe('2026-07-02');
    expect(result.current.isToday).toBe(true);
  });

  it('never overwrites a date navigated before preference hydration', () => {
    const { result, rerender } = renderHook(
      ({ displayTimezone, preferencesReady }) =>
        useScheduleDisplayDate({ displayTimezone, preferencesReady, now: NOW }),
      {
        initialProps: {
          displayTimezone: 'America/Los_Angeles',
          preferencesReady: false,
        },
      },
    );
    act(() => {
      result.current.setDate('2026-06-15');
    });

    rerender({ displayTimezone: 'Asia/Tokyo', preferencesReady: true });

    expect(result.current.date).toBe('2026-06-15');
    expect(result.current.isToday).toBe(false);
  });

  it('preserves an explicit initial date when preferences hydrate', () => {
    const { result, rerender } = renderHook(
      ({ displayTimezone, preferencesReady }) =>
        useScheduleDisplayDate({
          initialDate: '2026-05-20',
          displayTimezone,
          preferencesReady,
          now: NOW,
        }),
      {
        initialProps: {
          displayTimezone: 'America/Los_Angeles',
          preferencesReady: false,
        },
      },
    );

    rerender({ displayTimezone: 'Asia/Tokyo', preferencesReady: true });

    expect(result.current.date).toBe('2026-05-20');
    expect(result.current.today).toBe('2026-07-02');
  });
});
