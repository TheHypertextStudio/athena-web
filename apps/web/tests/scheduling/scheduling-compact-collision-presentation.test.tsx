import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';

import { SchedulingCanvas, type ScheduleItem, type ScheduleLane } from '@/components/scheduling';
import { assertDefined } from '@docket/test-utils';

afterEach(cleanup);

it('keeps a narrow collision title and start time legible while announcing the full range', () => {
  const item = (id: string, title: string, endsAt = '2026-07-01T10:00:00.000Z'): ScheduleItem => ({
    id,
    title,
    startsAt: '2026-07-01T09:00:00.000Z',
    endsAt,
  });
  const lane: ScheduleLane = {
    id: 'date',
    label: 'Wed, Jul 1',
    date: '2026-07-01',
    items: [
      item('a', 'Design review for the October launch', '2026-07-01T12:00:00.000Z'),
      item('b', 'Second event'),
      item('c', 'Third event'),
    ],
  };
  render(
    <SchedulingCanvas
      displayTimezone="UTC"
      lanes={[lane]}
      pixelsPerHour={60}
      viewportWidth={200}
      minimumLaneWidth={100}
      compactOverlapSidecarWidth={40}
    />,
  );

  const card = assertDefined(document.querySelector<HTMLElement>('[data-schedule-item="a"]'));
  expect(card.querySelector('.text-title-small')).toHaveClass('line-clamp-2');
  expect(card.querySelector('.tabular-nums[aria-hidden="true"]')).toHaveTextContent('9:00 AM');
  expect(card.querySelector('.sr-only')).toHaveTextContent('9:00 AM – 12:00 PM');
  expect(screen.getByRole('button', { name: 'Show 2 more events in Wed, Jul 1' })).toBeVisible();
});
