import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  SchedulingCanvas,
  type ScheduleLane,
  type ScheduleRegionSelection,
} from '@/components/scheduling';

const ADA_LANE: ScheduleLane = {
  id: 'ada',
  label: 'Ada',
  date: '2026-07-01',
  timezone: 'UTC',
  items: [],
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderSelectionCanvas(onSelectRegion: (selection: ScheduleRegionSelection) => void) {
  return render(
    <SchedulingCanvas
      displayTimezone="UTC"
      lanes={[ADA_LANE]}
      pixelsPerHour={60}
      viewportWidth={500}
      onSelectRegion={onSelectRegion}
    />,
  );
}

function selectionGrid(): HTMLElement {
  return screen.getByLabelText('Ada time grid');
}

function installPointerCapture(target: HTMLElement): {
  readonly setPointerCapture: ReturnType<typeof vi.fn>;
  readonly releasePointerCapture: ReturnType<typeof vi.fn>;
} {
  const setPointerCapture = vi.fn();
  const releasePointerCapture = vi.fn();
  Object.defineProperties(target, {
    setPointerCapture: { configurable: true, value: setPointerCapture },
    releasePointerCapture: { configurable: true, value: releasePointerCapture },
  });
  return { setPointerCapture, releasePointerCapture };
}

describe('SchedulingCanvas region selection', () => {
  it('shows a live snapped preview and commits the matching pointer selection', () => {
    const onSelectRegion = vi.fn();
    renderSelectionCanvas(onSelectRegion);
    const grid = selectionGrid();
    const capture = installPointerCapture(grid);

    fireEvent.pointerDown(grid, { button: 0, pointerId: 7, clientY: 101 });
    fireEvent.pointerMove(window, { pointerId: 7, clientY: 159 });

    const preview = document.querySelector('[data-schedule-region-preview="ada"]');
    expect(capture.setPointerCapture).toHaveBeenCalledWith(7);
    expect(preview).toHaveAttribute('data-start-minutes', '100');
    expect(preview).toHaveAttribute('data-end-minutes', '160');
    expect(preview).toHaveStyle({ top: '100px', height: '60px' });
    expect(onSelectRegion).not.toHaveBeenCalled();

    fireEvent.pointerUp(window, { pointerId: 7, clientY: 159 });

    expect(preview).not.toBeInTheDocument();
    expect(capture.releasePointerCapture).toHaveBeenCalledWith(7);
    expect(onSelectRegion).toHaveBeenCalledOnce();
    expect(onSelectRegion).toHaveBeenCalledWith({
      lane: ADA_LANE,
      startMinutes: 100,
      endMinutes: 160,
    });
  });

  it('ignores movement and completion from every pointer except the initiating pointer', () => {
    const onSelectRegion = vi.fn();
    renderSelectionCanvas(onSelectRegion);
    const grid = selectionGrid();
    installPointerCapture(grid);

    fireEvent.pointerDown(grid, { button: 0, pointerId: 11, clientY: 101 });
    fireEvent.pointerMove(window, { pointerId: 12, clientY: 401 });
    fireEvent.pointerUp(window, { pointerId: 12, clientY: 401 });

    expect(onSelectRegion).not.toHaveBeenCalled();
    expect(document.querySelector('[data-schedule-region-preview="ada"]')).toHaveAttribute(
      'data-end-minutes',
      '110',
    );

    fireEvent.pointerMove(window, { pointerId: 11, clientY: 159 });
    fireEvent.pointerUp(window, { pointerId: 11, clientY: 159 });

    expect(onSelectRegion).toHaveBeenCalledOnce();
    expect(onSelectRegion).toHaveBeenCalledWith({
      lane: ADA_LANE,
      startMinutes: 100,
      endMinutes: 160,
    });
  });

  it('cancels a matching pointer interruption and ignores a later pointerup', () => {
    const onSelectRegion = vi.fn();
    renderSelectionCanvas(onSelectRegion);
    const grid = selectionGrid();
    const capture = installPointerCapture(grid);

    fireEvent.pointerDown(grid, { button: 0, pointerId: 21, clientY: 101 });
    fireEvent.pointerMove(window, { pointerId: 21, clientY: 159 });
    fireEvent.pointerCancel(window, { pointerId: 21, clientY: 159 });
    fireEvent.pointerUp(window, { pointerId: 21, clientY: 159 });

    expect(document.querySelector('[data-schedule-region-preview]')).not.toBeInTheDocument();
    expect(capture.releasePointerCapture).toHaveBeenCalledWith(21);
    expect(onSelectRegion).not.toHaveBeenCalled();
  });

  it('cancels on Escape and does not let the armed pointer commit afterward', () => {
    const onSelectRegion = vi.fn();
    renderSelectionCanvas(onSelectRegion);
    const grid = selectionGrid();
    installPointerCapture(grid);

    fireEvent.pointerDown(grid, { button: 0, pointerId: 31, clientY: 101 });
    fireEvent.pointerMove(window, { pointerId: 31, clientY: 159 });
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.pointerUp(window, { pointerId: 31, clientY: 159 });

    expect(document.querySelector('[data-schedule-region-preview]')).not.toBeInTheDocument();
    expect(onSelectRegion).not.toHaveBeenCalled();
  });

  it('removes its global session and releases capture when the canvas unmounts', () => {
    const onSelectRegion = vi.fn();
    const { unmount } = renderSelectionCanvas(onSelectRegion);
    const grid = selectionGrid();
    const capture = installPointerCapture(grid);
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    fireEvent.pointerDown(grid, { button: 0, pointerId: 41, clientY: 101 });
    fireEvent.pointerMove(window, { pointerId: 41, clientY: 159 });
    const sessionListeners = addSpy.mock.calls.filter(([type]) =>
      ['pointermove', 'pointerup', 'pointercancel', 'keydown'].includes(type),
    );

    unmount();

    expect(sessionListeners).toHaveLength(4);
    for (const [type, listener] of sessionListeners) {
      expect(removeSpy).toHaveBeenCalledWith(type, listener);
    }
    expect(capture.releasePointerCapture).toHaveBeenCalledWith(41);
    fireEvent.pointerUp(window, { pointerId: 41, clientY: 159 });
    expect(onSelectRegion).not.toHaveBeenCalled();
  });
});
