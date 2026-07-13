import '@testing-library/jest-dom/vitest';

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef, useState } from 'react';
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
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function renderSelectionCanvas(
  onSelectRegion: (selection: ScheduleRegionSelection) => void,
  options: { readonly timezone?: string; readonly lane?: ScheduleLane } = {},
) {
  return render(
    <SchedulingCanvas
      displayTimezone={options.timezone ?? 'UTC'}
      lanes={[options.lane ?? ADA_LANE]}
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
    expect(preview).toHaveTextContent('1:40 AM – 2:40 AM');
    expect(screen.getByText('Selected Ada, 1:40 AM – 2:40 AM.')).toBeInTheDocument();
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

  it('keeps a controlled committed region highlighted and anchored until its consumer clears it', () => {
    const anchorRef = createRef<HTMLDivElement>();
    function Harness(): React.JSX.Element {
      const [selectedRegion, setSelectedRegion] = useState<ScheduleRegionSelection | null>(null);
      return (
        <>
          <button
            type="button"
            onClick={() => {
              setSelectedRegion(null);
            }}
          >
            Clear selection
          </button>
          <SchedulingCanvas
            displayTimezone="UTC"
            lanes={[ADA_LANE]}
            pixelsPerHour={60}
            viewportWidth={500}
            selectedRegion={selectedRegion}
            selectedRegionAnchorRef={anchorRef}
            onSelectRegion={setSelectedRegion}
          />
        </>
      );
    }
    render(<Harness />);
    const grid = selectionGrid();
    installPointerCapture(grid);

    fireEvent.pointerDown(grid, { button: 0, pointerId: 9, clientY: 101 });
    fireEvent.pointerMove(window, { pointerId: 9, clientY: 159 });
    fireEvent.pointerUp(window, { pointerId: 9, clientY: 159 });

    expect(document.querySelector('[data-schedule-region-preview]')).not.toBeInTheDocument();
    const committed = document.querySelector('[data-schedule-region-selection="ada"]');
    expect(committed).toHaveAttribute('data-start-minutes', '100');
    expect(committed).toHaveAttribute('data-end-minutes', '160');
    expect(committed).toHaveTextContent('1:40 AM – 2:40 AM');
    expect(anchorRef.current).toBe(committed);

    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));

    expect(document.querySelector('[data-schedule-region-selection]')).not.toBeInTheDocument();
    expect(anchorRef.current).toBeNull();
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

  it('pans the schedule instead of selecting when a touch moves before long press', () => {
    vi.useFakeTimers();
    const onSelectRegion = vi.fn();
    renderSelectionCanvas(onSelectRegion);
    const grid = selectionGrid();
    const viewport = screen.getByRole('region', { name: 'Schedule' });
    const capture = installPointerCapture(grid);
    const initialScrollTop = viewport.scrollTop;

    fireEvent.pointerDown(grid, {
      button: 0,
      pointerId: 51,
      pointerType: 'touch',
      clientX: 100,
      clientY: 200,
    });
    fireEvent.pointerMove(window, {
      pointerId: 51,
      pointerType: 'touch',
      clientX: 100,
      clientY: 160,
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    fireEvent.pointerUp(window, {
      pointerId: 51,
      pointerType: 'touch',
      clientX: 100,
      clientY: 160,
    });

    expect(viewport.scrollTop).toBe(initialScrollTop + 40);
    expect(document.querySelector('[data-schedule-region-preview]')).not.toBeInTheDocument();
    expect(onSelectRegion).not.toHaveBeenCalled();
    expect(capture.releasePointerCapture).toHaveBeenCalledWith(51);
  });

  it('starts a touch selection only after a stationary long press', () => {
    vi.useFakeTimers();
    const onSelectRegion = vi.fn();
    renderSelectionCanvas(onSelectRegion);
    const grid = selectionGrid();
    const capture = installPointerCapture(grid);

    fireEvent.pointerDown(grid, {
      button: 0,
      pointerId: 61,
      pointerType: 'touch',
      clientX: 100,
      clientY: 101,
    });

    expect(document.querySelector('[data-schedule-region-preview]')).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(document.querySelector('[data-schedule-region-preview="ada"]')).toHaveAttribute(
      'data-start-minutes',
      '100',
    );
    expect(capture.setPointerCapture).toHaveBeenCalledWith(61);

    fireEvent.pointerMove(window, {
      pointerId: 61,
      pointerType: 'touch',
      clientX: 100,
      clientY: 159,
    });
    fireEvent.pointerUp(window, {
      pointerId: 61,
      pointerType: 'touch',
      clientX: 100,
      clientY: 159,
    });

    expect(onSelectRegion).toHaveBeenCalledWith({
      lane: ADA_LANE,
      startMinutes: 100,
      endMinutes: 160,
    });
  });

  it('clears an armed touch long press when the canvas unmounts', () => {
    vi.useFakeTimers();
    const onSelectRegion = vi.fn();
    const { unmount } = renderSelectionCanvas(onSelectRegion);
    const grid = selectionGrid();
    installPointerCapture(grid);
    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');

    fireEvent.pointerDown(grid, {
      button: 0,
      pointerId: 71,
      pointerType: 'touch',
      clientY: 101,
    });
    unmount();
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(clearTimeoutSpy).toHaveBeenCalled();
    expect(onSelectRegion).not.toHaveBeenCalled();
  });

  it('labels and rejects a region that begins in a skipped DST wall time', () => {
    const onSelectRegion = vi.fn();
    const springLane: ScheduleLane = {
      ...ADA_LANE,
      id: 'spring',
      label: 'Sun, Mar 8',
      date: '2026-03-08',
    };
    renderSelectionCanvas(onSelectRegion, {
      timezone: 'America/Los_Angeles',
      lane: springLane,
    });
    const grid = screen.getByLabelText('Sun, Mar 8 time grid');
    installPointerCapture(grid);

    fireEvent.pointerDown(grid, { button: 0, pointerId: 81, clientY: 121 });
    fireEvent.pointerMove(window, { pointerId: 81, clientY: 179 });

    expect(document.querySelector('[data-schedule-region-preview="spring"]')).toHaveTextContent(
      'Unavailable · DST',
    );
    expect(screen.getByText('That time is unavailable because clocks change.')).toBeInTheDocument();

    fireEvent.pointerUp(window, { pointerId: 81, clientY: 179 });

    expect(onSelectRegion).not.toHaveBeenCalled();
    expect(screen.getByText('That time is unavailable because clocks change.')).toBeInTheDocument();
  });

  it('labels and rejects a repeated DST region with an explicit-choice path', () => {
    const onSelectRegion = vi.fn();
    const fallLane: ScheduleLane = {
      ...ADA_LANE,
      id: 'fall',
      label: 'Sun, Nov 1',
      date: '2026-11-01',
    };
    renderSelectionCanvas(onSelectRegion, {
      timezone: 'America/Los_Angeles',
      lane: fallLane,
    });
    const grid = screen.getByLabelText('Sun, Nov 1 time grid');
    installPointerCapture(grid);

    fireEvent.pointerDown(grid, { button: 0, pointerId: 91, clientY: 91 });
    fireEvent.pointerMove(window, { pointerId: 91, clientY: 149 });

    expect(document.querySelector('[data-schedule-region-preview="fall"]')).toHaveTextContent(
      'Choose occurrence · DST',
    );
    expect(
      screen.getByText(
        'That time repeats because clocks change. Use New to choose Earlier or Later.',
      ),
    ).toBeInTheDocument();
    expect(document.querySelector('[data-schedule-region-preview="fall"]')).toHaveAttribute(
      'data-schedule-region-valid',
      'false',
    );

    fireEvent.pointerUp(window, { pointerId: 91, clientY: 149 });

    expect(onSelectRegion).not.toHaveBeenCalled();
  });
});
