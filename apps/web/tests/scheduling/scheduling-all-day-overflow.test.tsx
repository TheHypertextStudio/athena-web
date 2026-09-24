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
        onSelectAllDayRegion={vi.fn()}
      />,
    );

    const lane = document.querySelector('[data-schedule-all-day-lane="date"]');
    expect(lane?.querySelectorAll('[data-schedule-all-day-primary]')).toHaveLength(2);
    const more = screen.getByText('+6 more');
    expect(more).toHaveClass('[@media(pointer:coarse)]:min-h-10');
    expect(more.closest('details')).not.toHaveAttribute('open');
    expect(more.closest('details')).toHaveClass('absolute');
    expect(screen.getByRole('button', { name: 'Create all-day item for Wed, Jul 1' })).toHaveClass(
      'absolute',
    );

    fireEvent.click(more);

    expect(more.closest('details')).toHaveAttribute('open');
    expect(lane?.querySelector('[data-schedule-all-day-overflow]')).toHaveClass(
      'max-h-32',
      'overflow-y-auto',
    );
    expect(screen.getByRole('button', { name: 'All day 8' })).toBeInTheDocument();
  });

  it('shows two primary all-day rows before Agenda overflow', () => {
    render(
      <SchedulingCanvas
        presentation="agenda"
        displayTimezone="UTC"
        lanes={[LANE]}
        pixelsPerHour={60}
        viewportWidth={320}
        onOpenItem={vi.fn()}
      />,
    );

    const lane = document.querySelector('[data-schedule-all-day-lane="date"]');
    expect(lane?.querySelectorAll('[data-schedule-all-day-primary]')).toHaveLength(2);
    expect(screen.getByText('+6 more')).toBeInTheDocument();
  });

  it('keeps Calendar day context outside the all-day event lane', () => {
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[LANE]}
        pixelsPerHour={60}
        viewportWidth={500}
        renderAllDayLaneContext={() => <span>Home</span>}
      />,
    );

    const context = document.querySelector('[data-schedule-all-day-lane-context="date"]');
    const lane = document.querySelector('[data-schedule-all-day-lane="date"]');
    expect(context).toHaveTextContent('Home');
    expect(context?.parentElement).toBe(lane?.parentElement);
    expect(context?.closest('[data-schedule-all-day-lane]')).toBeNull();
  });

  it('aligns all-day event rows when only one date has work-location context', () => {
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[LANE, { ...LANE, id: 'next', date: '2026-07-02', label: 'Thu, Jul 2' }]}
        pixelsPerHour={60}
        viewportWidth={800}
        renderAllDayLaneContext={({ lane }) => (lane.id === 'date' ? <span>Home</span> : null)}
      />,
    );

    expect(document.querySelector('[data-schedule-all-day-lane-context="date"]')).toHaveClass(
      'h-10',
    );
    expect(document.querySelector('[data-schedule-all-day-lane-context="next"]')).toHaveClass(
      'h-10',
    );
    expect(
      document.querySelector('[data-schedule-all-day-lane-context="next"]'),
    ).toBeEmptyDOMElement();
  });
});
