import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SchedulingCanvas, type ScheduleItem, type ScheduleLane } from '@/components/scheduling';

const ITEMS: readonly ScheduleItem[] = Array.from({ length: 8 }, (_, index) => ({
  id: `all-day-${String(index)}`,
  title: `All day ${String(index + 1)}`,
  startsAt: '2026-07-01T00:00:00Z',
  endsAt: '2026-07-02T00:00:00Z',
  allDay: true,
}));

const LANE: ScheduleLane = {
  id: 'date',
  label: 'Wed, Jul 1',
  date: '2026-07-01',
  items: ITEMS,
};

afterEach(cleanup);

describe('SchedulingCanvas all-day overflow', () => {
  it('keeps the all-day header bounded and exposes overflow on demand', () => {
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[LANE]}
        pixelsPerHour={60}
        viewportWidth={500}
        onOpenItem={vi.fn()}
      />,
    );

    const lane = document.querySelector('[data-schedule-all-day-lane="date"]');
    expect(lane?.querySelectorAll('[data-schedule-all-day-primary]')).toHaveLength(3);
    const more = screen.getByText('+5 more');
    expect(more).toHaveClass('[@media(pointer:coarse)]:min-h-10');
    expect(more.closest('details')).not.toHaveAttribute('open');

    fireEvent.click(more);

    expect(more.closest('details')).toHaveAttribute('open');
    expect(lane?.querySelector('[data-schedule-all-day-overflow]')).toHaveClass(
      'max-h-32',
      'overflow-y-auto',
    );
    expect(screen.getByRole('button', { name: 'All day 8' })).toBeInTheDocument();
  });
});
