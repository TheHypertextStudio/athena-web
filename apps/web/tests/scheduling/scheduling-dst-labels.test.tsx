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

const CROSSING_FOLD_ITEM: ScheduleItem = {
  id: 'crossing-fold',
  title: 'Crossing fold',
  startsAt: '2026-11-01T07:30:00Z',
  endsAt: '2026-11-01T09:30:00Z',
};

const BEFORE_FOLD_ITEM: ScheduleItem = {
  id: 'before-fold',
  title: 'Before fold',
  startsAt: '2026-11-01T07:50:00Z',
  endsAt: '2026-11-01T08:20:00Z',
};

const BEFORE_FOLD_EDGE_ITEM: ScheduleItem = {
  id: 'before-fold-edge',
  title: 'Before fold edge',
  startsAt: '2026-11-01T07:30:00Z',
  endsAt: '2026-11-01T07:50:00Z',
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

  it('announces a fall-back move with the exact preserved elapsed duration', () => {
    render(
      <SchedulingCanvas
        displayTimezone="America/Los_Angeles"
        lanes={[{ ...FOLD_LANE, items: [CROSSING_FOLD_ITEM] }]}
        pixelsPerHour={60}
        viewportWidth={500}
        onMoveItem={vi.fn()}
      />,
    );

    const body = screen.getByRole('button', { name: /^Crossing fold/ });
    fireEvent.pointerDown(body, { button: 0, pointerId: 42, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { pointerId: 42, clientX: 100, clientY: 110 });

    expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent(
      'Moving Crossing fold to Sun, Nov 1, 12:40 AM PDT – 1:40 AM PST.',
    );
  });

  it('blocks an ambiguous move and guides the user to the explicit item editor', () => {
    const onMoveItem = vi.fn();
    render(
      <SchedulingCanvas
        displayTimezone="America/Los_Angeles"
        lanes={[{ ...FOLD_LANE, items: [BEFORE_FOLD_ITEM] }]}
        pixelsPerHour={60}
        viewportWidth={500}
        onMoveItem={onMoveItem}
      />,
    );

    const body = screen.getByRole('button', { name: /^Before fold/ });
    fireEvent.pointerDown(body, {
      button: 0,
      pointerId: 43,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(window, { pointerId: 43, clientX: 100, clientY: 110 });

    expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent(
      'That time repeats because clocks change. Open the item to choose Earlier or Later.',
    );
    fireEvent.pointerUp(window, { pointerId: 43, clientX: 100, clientY: 110 });

    expect(onMoveItem).not.toHaveBeenCalled();
    expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent(
      'That time repeats because clocks change. Open the item to choose Earlier or Later.',
    );
  });

  it('blocks an ambiguous resize edge instead of choosing the earlier occurrence', () => {
    const onResizeItem = vi.fn();
    render(
      <SchedulingCanvas
        displayTimezone="America/Los_Angeles"
        lanes={[{ ...FOLD_LANE, items: [BEFORE_FOLD_EDGE_ITEM] }]}
        pixelsPerHour={60}
        viewportWidth={500}
        onResizeItem={onResizeItem}
      />,
    );

    fireEvent.keyDown(screen.getByRole('button', { name: 'Resize Before fold edge from end' }), {
      key: 'ArrowDown',
    });

    expect(onResizeItem).not.toHaveBeenCalled();
    expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent(
      'That time repeats because clocks change. Open the item to choose Earlier or Later.',
    );
  });
});
