import '@testing-library/jest-dom/vitest';

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SchedulingCanvas, type ScheduleItem, type ScheduleLane } from '@/components/scheduling';

const FOCUS_BLOCK: ScheduleItem = {
  id: 'focus',
  title: 'Focus block',
  startsAt: '2026-07-01T09:00:00.000Z',
  endsAt: '2026-07-01T10:00:00.000Z',
};

const ADA_LANE: ScheduleLane = {
  id: 'ada',
  label: 'Ada',
  date: '2026-07-01',
  timezone: 'UTC',
  items: [FOCUS_BLOCK],
};

const READ_ONLY_BLOCK: ScheduleItem = {
  ...FOCUS_BLOCK,
  id: 'read-only',
  title: 'Provider review',
  editable: false,
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function renderMovableCanvas(onMoveItem = vi.fn(), onOpenItem = vi.fn()) {
  const result = render(
    <SchedulingCanvas
      displayTimezone="UTC"
      lanes={[ADA_LANE]}
      pixelsPerHour={60}
      viewportWidth={500}
      onMoveItem={onMoveItem}
      onOpenItem={onOpenItem}
    />,
  );
  return { ...result, onMoveItem, onOpenItem };
}

function itemBody(): HTMLElement {
  return screen.getByRole('button', { name: /^Focus block/ });
}

function installPointerCapture(target: HTMLElement): void {
  Object.defineProperties(target, {
    setPointerCapture: { configurable: true, value: vi.fn() },
    releasePointerCapture: { configurable: true, value: vi.fn() },
  });
}

describe('SchedulingCanvas touch gesture arbitration', () => {
  it('pans an empty timeline even when the consumer does not support region creation', () => {
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[{ ...ADA_LANE, items: [] }]}
        pixelsPerHour={60}
        viewportWidth={500}
      />,
    );
    const grid = screen.getByLabelText('Ada time grid');
    const viewport = screen.getByRole('region', { name: 'Schedule' });
    const initialScrollTop = viewport.scrollTop;
    installPointerCapture(grid);

    fireEvent.pointerDown(grid, {
      button: 0,
      pointerId: 71,
      pointerType: 'touch',
      clientX: 100,
      clientY: 200,
    });
    fireEvent.pointerMove(window, {
      pointerId: 71,
      pointerType: 'touch',
      clientX: 100,
      clientY: 160,
    });
    fireEvent.pointerUp(window, {
      pointerId: 71,
      pointerType: 'touch',
      clientX: 100,
      clientY: 160,
    });

    expect(viewport.scrollTop).toBe(initialScrollTop + 40);
  });

  it('pans over a read-only event without opening it', () => {
    const onOpenItem = vi.fn();
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[{ ...ADA_LANE, items: [READ_ONLY_BLOCK] }]}
        pixelsPerHour={60}
        viewportWidth={500}
        onOpenItem={onOpenItem}
      />,
    );
    const body = screen.getByRole('button', { name: /^Provider review/ });
    const viewport = screen.getByRole('region', { name: 'Schedule' });
    const initialScrollTop = viewport.scrollTop;
    installPointerCapture(screen.getByLabelText('Ada time grid'));

    fireEvent.pointerDown(body, {
      button: 0,
      pointerId: 76,
      pointerType: 'touch',
      clientX: 100,
      clientY: 200,
    });
    fireEvent.pointerMove(window, {
      pointerId: 76,
      pointerType: 'touch',
      clientX: 100,
      clientY: 160,
    });
    fireEvent.pointerUp(window, {
      pointerId: 76,
      pointerType: 'touch',
      clientX: 100,
      clientY: 160,
    });
    fireEvent.click(body, { detail: 1 });

    expect(viewport.scrollTop).toBe(initialScrollTop + 40);
    expect(onOpenItem).not.toHaveBeenCalled();
  });

  it('pans over an event instead of moving or opening it when touch moves before long press', () => {
    vi.useFakeTimers();
    const { onMoveItem, onOpenItem } = renderMovableCanvas();
    const body = itemBody();
    const viewport = screen.getByRole('region', { name: 'Schedule' });
    const initialScrollTop = viewport.scrollTop;
    installPointerCapture(body);

    fireEvent.pointerDown(body, {
      button: 0,
      pointerId: 81,
      pointerType: 'touch',
      clientX: 100,
      clientY: 200,
    });
    fireEvent.pointerMove(window, {
      pointerId: 81,
      pointerType: 'touch',
      clientX: 100,
      clientY: 160,
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    fireEvent.pointerUp(window, {
      pointerId: 81,
      pointerType: 'touch',
      clientX: 100,
      clientY: 160,
    });
    fireEvent.click(body, { detail: 1 });

    expect(viewport.scrollTop).toBe(initialScrollTop + 40);
    expect(document.querySelector('[data-gesture-preview]')).not.toBeInTheDocument();
    expect(onMoveItem).not.toHaveBeenCalled();
    expect(onOpenItem).not.toHaveBeenCalled();
  });

  it('moves an event after a stationary touch long press', () => {
    vi.useFakeTimers();
    const { onMoveItem } = renderMovableCanvas();
    const body = itemBody();
    installPointerCapture(body);

    fireEvent.pointerDown(body, {
      button: 0,
      pointerId: 91,
      pointerType: 'touch',
      clientX: 100,
      clientY: 100,
    });
    expect(document.querySelector('[data-gesture-preview]')).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(document.querySelector('[data-schedule-item="focus"]')).toHaveAttribute(
      'data-gesture-preview',
      'move',
    );

    fireEvent.pointerMove(window, {
      pointerId: 91,
      pointerType: 'touch',
      clientX: 100,
      clientY: 130,
    });
    fireEvent.pointerUp(window, {
      pointerId: 91,
      pointerType: 'touch',
      clientX: 100,
      clientY: 130,
    });

    expect(onMoveItem).toHaveBeenCalledWith({
      item: FOCUS_BLOCK,
      fromLane: ADA_LANE,
      toLane: ADA_LANE,
      startMinutes: 570,
      endMinutes: 630,
    });
  });

  it('does not restore stale bounds when data syncs during a touch long press', () => {
    vi.useFakeTimers();
    const onMoveItem = vi.fn();
    const { rerender } = renderMovableCanvas(onMoveItem);
    const body = itemBody();
    installPointerCapture(body);

    fireEvent.pointerDown(body, {
      button: 0,
      pointerId: 96,
      pointerType: 'touch',
      clientX: 100,
      clientY: 100,
    });

    const syncedItem: ScheduleItem = {
      ...FOCUS_BLOCK,
      startsAt: '2026-07-01T10:00:00.000Z',
      endsAt: '2026-07-01T11:00:00.000Z',
    };
    rerender(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[{ ...ADA_LANE, items: [syncedItem] }]}
        pixelsPerHour={60}
        viewportWidth={500}
        onMoveItem={onMoveItem}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(350);
    });
    fireEvent.pointerUp(window, {
      pointerId: 96,
      pointerType: 'touch',
      clientX: 100,
      clientY: 100,
    });

    expect(onMoveItem).not.toHaveBeenCalled();
  });

  it('retains immediate four-pixel activation for mouse input', () => {
    const { onMoveItem } = renderMovableCanvas();
    const body = itemBody();

    fireEvent.pointerDown(body, {
      button: 0,
      pointerId: 101,
      pointerType: 'mouse',
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(window, {
      pointerId: 101,
      pointerType: 'mouse',
      clientX: 100,
      clientY: 104,
    });

    expect(document.querySelector('[data-schedule-item="focus"]')).toHaveAttribute(
      'data-gesture-preview',
      'move',
    );
    fireEvent.pointerUp(window, {
      pointerId: 101,
      pointerType: 'mouse',
      clientX: 100,
      clientY: 104,
    });
    expect(onMoveItem).not.toHaveBeenCalled();
  });
});
