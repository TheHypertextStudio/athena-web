import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { SchedulingCanvas, type ScheduleItem, type ScheduleLane } from '@/components/scheduling';

const ALL_DAY_ITEMS: readonly ScheduleItem[] = ['Planning', 'Travel', 'Offsite'].map(
  (title, index) => ({
    id: `all-day-${String(index)}`,
    title,
    startsAt: '2026-07-13T00:00:00.000Z',
    endsAt: '2026-07-14T00:00:00.000Z',
    allDay: true,
  }),
);

const EMPTY_LANE: ScheduleLane = {
  id: 'today',
  label: 'Today',
  date: '2026-07-13',
  timezone: 'UTC',
  editable: true,
  items: [],
};

afterEach(cleanup);

describe('SchedulingCanvas notice', () => {
  it('keeps a degraded-data notice attached below a variable all-day header', () => {
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[{ ...EMPTY_LANE, items: ALL_DAY_ITEMS }]}
        pixelsPerHour={60}
        viewportWidth={500}
        error="Scheduling data is unavailable."
      />,
    );

    const viewport = screen.getByRole('region', { name: 'Schedule' });
    const header = viewport.querySelector('header');
    const notice = screen.getByRole('alert');
    expect(header).not.toBeNull();
    expect(viewport.scrollTop).toBeGreaterThan(0);
    expect(document.querySelectorAll('[data-schedule-all-day-item]')).toHaveLength(3);

    viewport.scrollTop = 600;
    fireEvent.scroll(viewport);

    expect(notice).toBeVisible();
    expect(header).toContainElement(notice);
    expect(header).toHaveClass('sticky', 'top-0');
    expect(notice).toHaveClass('sticky', 'break-words');
    expect(notice.parentElement).toHaveClass('absolute', 'top-full', 'pointer-events-none');
    expect(screen.getByLabelText('Today time grid')).toBeInTheDocument();
  });

  it('caps the visible notice inside a narrow schedule viewport', () => {
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[EMPTY_LANE]}
        pixelsPerHour={60}
        viewportWidth={280}
        error="Calendar updates are temporarily unavailable. Showing what we have."
      />,
    );

    const notice = screen.getByRole('alert');
    expect(notice).toHaveStyle({ left: '80px', maxWidth: '184px' });
  });

  it('treats a blank error as absent and renders the empty-state message', () => {
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[EMPTY_LANE]}
        pixelsPerHour={60}
        viewportWidth={500}
        error="   "
        emptyMessage="No calendar items yet."
      />,
    );

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('No calendar items yet.');
  });
});
