/**
 * Contract for the canvas's sticky lane headings.
 *
 * @remarks
 * The heading used to stack a friendly label over the raw `YYYY-MM-DD`, so the calendar showed the
 * same date twice in one column and a third time in the toolbar. The rule now is that the canvas
 * renders exactly one date atom per lane — weekday plus day-of-month — and never a month, a year,
 * or an ISO string; the surface's toolbar owns the month and year. These tests pin that, plus the
 * today marker and the resource-lane case where the heading is a person, not a date.
 */
import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { SchedulingCanvas, type ScheduleLane } from '@/components/scheduling';

/** A plain date lane, as the calendar's Dates axis builds them. */
function dateLane(date: string, label: string): ScheduleLane {
  return { id: `date:${date}`, label, date, items: [] };
}

/** Locate one lane's sticky header cell. */
function laneHeader(laneId: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-schedule-lane-header="${laneId}"]`);
  if (!element) throw new Error(`No rendered lane header for ${laneId}`);
  return element;
}

afterEach(cleanup);

describe('SchedulingCanvas lane headings', () => {
  it('renders weekday and day only — never the ISO date, month, or year', () => {
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[dateLane('2026-08-02', 'Sun, Aug 2'), dateLane('2026-08-03', 'Mon, Aug 3')]}
        pixelsPerHour={60}
        viewportWidth={800}
      />,
    );

    expect(laneHeader('date:2026-08-02')).toHaveTextContent(/^Sun\s*2$/);
    expect(laneHeader('date:2026-08-03')).toHaveTextContent(/^Mon\s*3$/);
    expect(document.body.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(document.body.textContent).not.toMatch(/Aug|August|2026/);
  });

  it('marks only today with a filled day chip', () => {
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[dateLane('2026-08-02', 'Sun, Aug 2'), dateLane('2026-08-03', 'Mon, Aug 3')]}
        pixelsPerHour={60}
        viewportWidth={800}
        now="2026-08-03T12:00:00.000Z"
      />,
    );

    const marked = document.querySelectorAll('[data-schedule-lane-today]');
    expect(marked).toHaveLength(1);
    expect(marked[0]).toHaveTextContent('3');
    expect(marked[0]).toHaveClass('bg-primary', 'text-on-primary');
  });

  it('marks no lane when the canvas was given no clock', () => {
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[dateLane('2026-08-02', 'Sun, Aug 2')]}
        pixelsPerHour={60}
        viewportWidth={500}
      />,
    );

    expect(document.querySelectorAll('[data-schedule-lane-today]')).toHaveLength(0);
  });

  it('titles a resource lane with the person, and shows a timezone only when it differs', () => {
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[
          {
            id: 'person:ada',
            resourceId: 'ada',
            label: 'Ada Lovelace',
            date: '2026-08-02',
            timezone: 'Europe/London',
            items: [],
          },
          {
            id: 'person:grace',
            resourceId: 'grace',
            label: 'Grace Hopper',
            date: '2026-08-02',
            timezone: 'UTC',
            items: [],
          },
        ]}
        pixelsPerHour={60}
        viewportWidth={800}
      />,
    );

    expect(laneHeader('person:ada')).toHaveTextContent('Ada Lovelace');
    expect(laneHeader('person:ada')).toHaveTextContent('Europe/London');
    // Repeating the canvas-wide timezone on every lane is noise, not information.
    expect(laneHeader('person:grace')).toHaveTextContent('Grace Hopper');
    expect(laneHeader('person:grace')).not.toHaveTextContent('UTC');
  });

  it('keeps the accessible lane name descriptive even though the visible heading is terse', () => {
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[dateLane('2026-08-02', 'Sun, Aug 2')]}
        pixelsPerHour={60}
        viewportWidth={500}
      />,
    );

    expect(screen.getByLabelText('Sun, Aug 2 time grid')).toBeInTheDocument();
  });
});
