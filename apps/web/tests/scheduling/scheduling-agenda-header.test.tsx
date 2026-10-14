import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { SchedulingCanvas, type ScheduleLane } from '@/components/scheduling';

afterEach(cleanup);

const lane: ScheduleLane = {
  id: 'day',
  label: 'Agenda',
  date: '2026-10-08',
  items: [],
};

const options = {
  lanes: [lane],
  displayTimezone: 'UTC',
  pixelsPerHour: 84,
  viewportWidth: 500,
  viewportHeight: 300,
} as const;

it('omits empty agenda chrome while retaining the timed grid', () => {
  render(<SchedulingCanvas {...options} presentation="agenda" />);
  expect(document.querySelector('[data-schedule-all-day-header]')).not.toBeVisible();
  expect(screen.getByRole('region', { name: 'Schedule' })).toBeVisible();
  expect(screen.getByText('9 AM')).toBeInTheDocument();
});

it('restores the header when an agenda receives an all-day item', () => {
  const view = render(<SchedulingCanvas {...options} presentation="agenda" />);
  view.rerender(
    <SchedulingCanvas
      {...options}
      presentation="agenda"
      lanes={[
        {
          ...lane,
          items: [
            {
              id: 'offsite',
              title: 'Team offsite',
              allDay: true,
              startsAt: '2026-10-08T00:00:00.000Z',
              endsAt: '2026-10-09T00:00:00.000Z',
            },
          ],
        },
      ]}
    />,
  );
  expect(document.querySelector('[data-schedule-all-day-header]')).toBeVisible();
  expect(screen.getByText('Team offsite')).toBeVisible();
  view.rerender(<SchedulingCanvas {...options} presentation="agenda" />);
  expect(document.querySelector('[data-schedule-all-day-header]')).not.toBeVisible();
});

it('keeps consumer context and calendar headings', () => {
  const view = render(
    <SchedulingCanvas
      {...options}
      presentation="agenda"
      renderAllDayLaneContext={() => <p>Office day</p>}
    />,
  );
  expect(screen.getByText('Office day')).toBeVisible();
  view.rerender(<SchedulingCanvas {...options} presentation="calendar" />);
  expect(document.querySelector('[data-schedule-all-day-header]')).toBeVisible();
});
