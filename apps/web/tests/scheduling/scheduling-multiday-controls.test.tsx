import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SchedulingCanvas } from '@/components/scheduling';
import type { ScheduleItem, ScheduleLane } from '@/components/scheduling/scheduling-types';

const overnight: ScheduleItem = {
  id: 'overnight',
  title: 'Overnight work',
  startsAt: '2026-07-13T23:30:00Z',
  endsAt: '2026-07-14T01:30:00Z',
  editable: true,
};

/** Build one UTC date lane containing the shared cross-midnight event. */
function lane(date: string): ScheduleLane {
  return {
    id: `date:${date}`,
    label: date,
    date,
    items: [overnight],
  };
}

describe('cross-midnight timed controls', () => {
  it('puts movement/start on the true start segment and end resizing on the true end segment', () => {
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[lane('2026-07-13'), lane('2026-07-14')]}
        pixelsPerHour={60}
        viewportWidth={600}
        onMoveItem={vi.fn()}
        onResizeItem={vi.fn()}
      />,
    );

    const move = screen.getByRole('button', { name: 'Move Overnight work' });
    const resizeStart = screen.getByRole('button', { name: 'Resize Overnight work from start' });
    const resizeEnd = screen.getByRole('button', { name: 'Resize Overnight work from end' });

    expect(move.closest('[data-schedule-lane]')).toHaveAttribute(
      'data-schedule-lane',
      'date:2026-07-13',
    );
    expect(resizeStart.closest('[data-schedule-lane]')).toHaveAttribute(
      'data-schedule-lane',
      'date:2026-07-13',
    );
    expect(resizeEnd.closest('[data-schedule-lane]')).toHaveAttribute(
      'data-schedule-lane',
      'date:2026-07-14',
    );
  });
});
