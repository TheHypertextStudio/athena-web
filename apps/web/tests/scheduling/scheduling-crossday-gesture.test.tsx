import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SchedulingCanvas } from '@/components/scheduling';
import type { ScheduleItem, ScheduleLane } from '@/components/scheduling/scheduling-types';

const OVERNIGHT_ITEM: ScheduleItem = {
  id: 'overnight',
  title: 'Overnight work',
  startsAt: '2026-07-13T23:30:00Z',
  endsAt: '2026-07-14T01:30:00Z',
  editable: true,
};

/** Build one UTC date lane containing the requested items. */
function lane(date: string, items: readonly ScheduleItem[]): ScheduleLane {
  return { id: `date:${date}`, label: date, date, items };
}

afterEach(cleanup);

describe('cross-day timed gestures', () => {
  it('moves an overnight start segment later by pointer while announcing its full exact range', () => {
    const onMoveItem = vi.fn();
    const sourceLane = lane('2026-07-13', [OVERNIGHT_ITEM]);
    const endLane = lane('2026-07-14', [OVERNIGHT_ITEM]);
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[sourceLane, endLane]}
        pixelsPerHour={32}
        viewportWidth={600}
        onMoveItem={onMoveItem}
      />,
    );

    const body = document.querySelector<HTMLElement>(
      '[data-schedule-lane="date:2026-07-13"] [data-schedule-item-body="overnight"]',
    );
    expect(body).not.toBeNull();
    if (!body) return;
    fireEvent.pointerDown(body, { button: 0, pointerId: 201, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { pointerId: 201, clientX: 100, clientY: 108 });

    expect(document.querySelector('[data-schedule-item="overnight"]')).toHaveAttribute(
      'data-gesture-preview',
      'move',
    );
    expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent(
      'Moving Overnight work to 2026-07-13, 11:45 PM – 1:45 AM.',
    );

    fireEvent.pointerUp(window, { pointerId: 201, clientX: 100, clientY: 108 });

    expect(onMoveItem).toHaveBeenCalledWith({
      item: OVERNIGHT_ITEM,
      fromLane: sourceLane,
      toLane: sourceLane,
      startMinutes: 23 * 60 + 45,
      endMinutes: 24 * 60,
    });
  });

  it('resizes an end edge across midnight from the keyboard', () => {
    const onResizeItem = vi.fn();
    const boundaryItem: ScheduleItem = {
      id: 'boundary',
      title: 'Boundary review',
      startsAt: '2026-07-13T23:00:00Z',
      endsAt: '2026-07-13T23:55:00Z',
      editable: true,
    };
    const sourceLane = lane('2026-07-13', [boundaryItem]);
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[sourceLane]}
        pixelsPerHour={32}
        viewportWidth={500}
        onResizeItem={onResizeItem}
      />,
    );

    fireEvent.keyDown(screen.getByRole('button', { name: 'Resize Boundary review from end' }), {
      key: 'ArrowDown',
    });

    expect(onResizeItem).toHaveBeenCalledWith({
      item: boundaryItem,
      lane: sourceLane,
      edge: 'end',
      startMinutes: 23 * 60,
      endMinutes: 24 * 60 + 10,
    });
    expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent(
      'Resizing end of Boundary review in 2026-07-13, 11:00 PM – 12:10 AM.',
    );
  });
});
