import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SchedulingCanvas } from '@/components/scheduling';

describe('SchedulingCanvas first paint', () => {
  it('shows the known date and starting hours before width or items load', () => {
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[
          { id: 'previous', date: '2026-09-22', label: 'Tue, Sep 22', items: [] },
          { id: 'today', date: '2026-09-23', label: 'Wed, Sep 23', items: [] },
        ]}
        initialLaneIndex={1}
        initialScrollMinutes={9 * 60}
        pixelsPerHour={72}
      />,
    );

    const canvas = screen.getByRole('region', { name: 'Schedule' });
    expect(canvas).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Wed, Sep 23')).toBeInTheDocument();
    expect(screen.getByText('All day')).toBeInTheDocument();
    expect(screen.getByText('9 AM')).toBeInTheDocument();
    expect(screen.getByText('10 AM')).toBeInTheDocument();
    expect(screen.queryByText('Tue, Sep 22')).not.toBeInTheDocument();
  });

  it('keeps a late-day first paint filled through midnight', () => {
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[{ id: 'today', date: '2026-09-23', label: 'Wed, Sep 23', items: [] }]}
        initialScrollMinutes={19 * 60}
        pixelsPerHour={72}
      />,
    );

    const hours = screen
      .getByRole('region', { name: 'Schedule' })
      .querySelectorAll('[data-schedule-hour]');
    expect(hours[0]).toHaveAttribute('data-schedule-hour', '12');
    expect(hours[hours.length - 1]).toHaveAttribute('data-schedule-hour', '23');
  });
});
