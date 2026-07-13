import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SchedulingCanvas, type ScheduleItem, type ScheduleLane } from '@/components/scheduling';

const ITEM: ScheduleItem = {
  id: 'focus',
  title: 'Focus block',
  startsAt: '2026-07-01T09:00:00Z',
  endsAt: '2026-07-01T10:00:00Z',
};

const LANES: readonly ScheduleLane[] = [
  { id: 'a', label: 'Ada', date: '2026-07-01', items: [ITEM] },
  { id: 'b', label: 'Busy', date: '2026-07-02', editable: false, items: [] },
  { id: 'c', label: 'Grace', date: '2026-07-03', items: [] },
];

afterEach(cleanup);

describe('SchedulingCanvas keyboard gestures', () => {
  it('moves across an intervening read-only lane to the next editable lane', () => {
    const onMoveItem = vi.fn();
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={LANES}
        pixelsPerHour={60}
        viewportWidth={800}
        onMoveItem={onMoveItem}
      />,
    );

    fireEvent.keyDown(screen.getByRole('button', { name: 'Move Focus block' }), {
      key: 'ArrowRight',
    });

    expect(onMoveItem).toHaveBeenCalledWith({
      item: ITEM,
      fromLane: LANES[0],
      toLane: LANES[2],
      startMinutes: 540,
      endMinutes: 600,
    });
    expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent(
      'Moving Focus block to Grace, 9:00 AM – 10:00 AM.',
    );
  });
});
