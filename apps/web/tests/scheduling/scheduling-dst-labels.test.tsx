import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SchedulingCanvas, type ScheduleItem, type ScheduleLane } from '@/components/scheduling';

const FOLD_ITEM: ScheduleItem = {
  id: 'fold-review',
  title: 'Fold review',
  startsAt: '2026-11-01T08:30:00Z',
  endsAt: '2026-11-01T09:30:00Z',
};

const FOLD_LANE: ScheduleLane = {
  id: 'fall-back',
  label: 'Sun, Nov 1',
  date: '2026-11-01',
  items: [FOLD_ITEM],
};

afterEach(cleanup);

describe('SchedulingCanvas DST labels', () => {
  it('labels a repeated-hour item from its exact instants instead of synthetic geometry', () => {
    render(
      <SchedulingCanvas
        displayTimezone="America/Los_Angeles"
        lanes={[FOLD_LANE]}
        pixelsPerHour={60}
        viewportWidth={500}
      />,
    );

    const body = screen.getByRole('button', { name: /Fold review/ });
    expect(body).toHaveAccessibleName(/Fold review.*1:30 AM PDT.*1:30 AM PST/);
    expect(body).not.toHaveAccessibleName(/2:30 AM/);
  });

  it('announces a fold resize from exact preserved and proposed instants', () => {
    render(
      <SchedulingCanvas
        displayTimezone="America/Los_Angeles"
        lanes={[FOLD_LANE]}
        pixelsPerHour={60}
        viewportWidth={500}
        onResizeItem={vi.fn()}
      />,
    );

    const endGrip = screen.getByRole('button', { name: 'Resize Fold review from end' });
    fireEvent.pointerDown(endGrip, { button: 0, pointerId: 41, clientY: 100 });
    fireEvent.pointerMove(window, { pointerId: 41, clientY: 130 });

    expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent(
      'Resizing end of Fold review in Sun, Nov 1, 1:30 AM PDT – 3:00 AM PST.',
    );
  });
});
