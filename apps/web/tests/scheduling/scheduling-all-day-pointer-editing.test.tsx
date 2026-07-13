import '@testing-library/jest-dom/vitest';

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SchedulingCanvas, type ScheduleItem, type ScheduleLane } from '@/components/scheduling';

const OFFSITE: ScheduleItem = {
  id: 'offsite',
  title: 'Team offsite',
  startsAt: '2026-07-01T00:00:00.000Z',
  endsAt: '2026-07-04T00:00:00.000Z',
  allDay: true,
  editable: true,
};

function dateLane(date: string): ScheduleLane {
  return {
    id: `date:${date}`,
    label: date,
    date,
    items: date >= '2026-07-01' && date < '2026-07-04' ? [OFFSITE] : [],
  };
}

const LANES: readonly ScheduleLane[] = [
  dateLane('2026-07-01'),
  dateLane('2026-07-02'),
  dateLane('2026-07-03'),
  dateLane('2026-07-04'),
];

function installPointerCapture(target: HTMLElement): void {
  Object.defineProperties(target, {
    setPointerCapture: { configurable: true, value: vi.fn() },
    releasePointerCapture: { configurable: true, value: vi.fn() },
  });
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('SchedulingCanvas all-day pointer editing', () => {
  it('shows and commits a move preview across arbitrary date lanes', () => {
    const onMoveAllDayItem = vi.fn();
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={LANES}
        pixelsPerHour={60}
        viewportWidth={1_000}
        onMoveAllDayItem={onMoveAllDayItem}
      />,
    );
    const move = screen.getByRole('button', { name: 'Move Team offsite' });
    installPointerCapture(move);

    fireEvent.pointerDown(move, {
      button: 0,
      pointerId: 41,
      pointerType: 'mouse',
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(window, {
      pointerId: 41,
      pointerType: 'mouse',
      clientX: 340,
      clientY: 100,
    });

    expect(document.querySelector('[data-schedule-all-day-preview="move"]')).toHaveTextContent(
      'Jul 2 – Jul 4',
    );
    expect(onMoveAllDayItem).not.toHaveBeenCalled();

    fireEvent.pointerUp(window, {
      pointerId: 41,
      pointerType: 'mouse',
      clientX: 340,
      clientY: 100,
    });

    expect(onMoveAllDayItem).toHaveBeenCalledWith({
      item: OFFSITE,
      fromLane: LANES[0],
      toLane: LANES[1],
      startDate: '2026-07-02',
      endDate: '2026-07-05',
    });
  });

  it('resizes the true end edge without moving the start date', () => {
    const onResizeAllDayItem = vi.fn();
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={LANES}
        pixelsPerHour={60}
        viewportWidth={1_000}
        onResizeAllDayItem={onResizeAllDayItem}
      />,
    );
    const resizeEnd = screen.getByRole('button', { name: 'Resize Team offsite from end' });
    installPointerCapture(resizeEnd);

    fireEvent.pointerDown(resizeEnd, {
      button: 0,
      pointerId: 45,
      pointerType: 'mouse',
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(window, {
      pointerId: 45,
      pointerType: 'mouse',
      clientX: 340,
      clientY: 100,
    });

    expect(
      document.querySelector('[data-schedule-all-day-preview="resize-end"]'),
    ).toHaveTextContent('Jul 1 – Jul 4');

    fireEvent.pointerUp(window, {
      pointerId: 45,
      pointerType: 'mouse',
      clientX: 340,
      clientY: 100,
    });

    expect(onResizeAllDayItem).toHaveBeenCalledWith({
      item: OFFSITE,
      fromLane: LANES[2],
      toLane: LANES[3],
      edge: 'end',
      startDate: '2026-07-01',
      endDate: '2026-07-05',
    });
  });

  it('moves from the body after a stationary touch long press', () => {
    vi.useFakeTimers();
    const onMoveAllDayItem = vi.fn();
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={LANES}
        pixelsPerHour={60}
        viewportWidth={1_000}
        onMoveAllDayItem={onMoveAllDayItem}
      />,
    );
    const sourceLane = document.querySelector(`[data-schedule-all-day-lane="${LANES[0]!.id}"]`);
    if (!(sourceLane instanceof HTMLElement)) throw new Error('Missing source all-day lane');
    const body = within(sourceLane).getByRole('button', { name: 'Team offsite' });
    installPointerCapture(body);

    fireEvent.pointerDown(body, {
      button: 0,
      pointerId: 51,
      pointerType: 'touch',
      clientX: 100,
      clientY: 100,
    });
    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(document.querySelector('[data-schedule-all-day-preview="move"]')).toBeInTheDocument();

    fireEvent.pointerMove(window, {
      pointerId: 51,
      pointerType: 'touch',
      clientX: 340,
      clientY: 100,
    });
    fireEvent.pointerUp(window, {
      pointerId: 51,
      pointerType: 'touch',
      clientX: 340,
      clientY: 100,
    });

    expect(onMoveAllDayItem).toHaveBeenCalledWith({
      item: OFFSITE,
      fromLane: LANES[0],
      toLane: LANES[1],
      startDate: '2026-07-02',
      endDate: '2026-07-05',
    });
  });
});
