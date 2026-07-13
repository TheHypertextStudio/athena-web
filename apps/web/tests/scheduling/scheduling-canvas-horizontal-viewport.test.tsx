import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SchedulingCanvas, type ScheduleLane } from '@/components/scheduling';

/** Build an empty date lane for horizontal viewport assertions. */
function lane(id: string, label: string): ScheduleLane {
  return {
    id,
    label,
    date: '2026-07-13',
    timezone: 'UTC',
    editable: true,
    items: [],
  };
}

afterEach(cleanup);

describe('SchedulingCanvas horizontal viewport', () => {
  it('aligns the initial lane left edge immediately after the sticky gutter', () => {
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[
          lane('before-two', 'July 11'),
          lane('before-one', 'July 12'),
          lane('anchor', 'July 13'),
          lane('after-one', 'July 14'),
        ]}
        pixelsPerHour={60}
        viewportWidth={500}
        initialLaneIndex={2}
      />,
    );

    const viewport = screen.getByRole('region', { name: 'Schedule' });
    const gutter = screen.getByText('All day');
    const anchorLane = screen.getByText('July 13').parentElement;
    expect(anchorLane).not.toBeNull();

    const gutterWidth = Number.parseFloat(gutter.style.width);
    const laneWidth = Number.parseFloat(anchorLane?.style.width ?? '0');
    const anchorViewportLeft = gutterWidth + 2 * laneWidth - viewport.scrollLeft;

    expect(anchorViewportLeft).toBe(gutterWidth);
    expect(viewport.scrollLeft).toBe(2 * laneWidth);
  });

  it('reaches the previous boundary only within two pixels of the scroll origin', () => {
    const onReachBoundary = vi.fn();
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[lane('one', 'One'), lane('two', 'Two'), lane('three', 'Three')]}
        pixelsPerHour={60}
        viewportWidth={500}
        onReachBoundary={onReachBoundary}
      />,
    );

    const viewport = screen.getByRole('region', { name: 'Schedule' });
    Object.defineProperties(viewport, {
      clientWidth: { configurable: true, value: 500 },
      scrollWidth: { configurable: true, value: 2_000 },
      scrollLeft: { configurable: true, writable: true, value: 64 },
    });

    fireEvent.scroll(viewport);
    expect(onReachBoundary).not.toHaveBeenCalled();

    viewport.scrollLeft = 2;
    fireEvent.scroll(viewport);
    fireEvent.scroll(viewport);
    expect(onReachBoundary).toHaveBeenCalledTimes(1);
    expect(onReachBoundary).toHaveBeenLastCalledWith('previous');

    viewport.scrollLeft = 3;
    fireEvent.scroll(viewport);
    viewport.scrollLeft = 2;
    fireEvent.scroll(viewport);
    expect(onReachBoundary).toHaveBeenCalledTimes(2);
  });

  it('does not navigate when a vertical scroll leaves the horizontal position unchanged', () => {
    const onReachBoundary = vi.fn();
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[lane('one', 'One'), lane('two', 'Two'), lane('three', 'Three')]}
        pixelsPerHour={60}
        viewportWidth={500}
        onReachBoundary={onReachBoundary}
      />,
    );

    const viewport = screen.getByRole('region', { name: 'Schedule' });
    Object.defineProperties(viewport, {
      clientWidth: { configurable: true, value: 500 },
      scrollWidth: { configurable: true, value: 2_000 },
      scrollLeft: { configurable: true, writable: true, value: 0 },
      scrollTop: { configurable: true, writable: true, value: 600 },
    });

    fireEvent.scroll(viewport);

    expect(onReachBoundary).not.toHaveBeenCalled();
  });

  it('does not navigate when the lane content has no horizontal overflow', () => {
    const onReachBoundary = vi.fn();
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[lane('one', 'One')]}
        pixelsPerHour={60}
        viewportWidth={500}
        onReachBoundary={onReachBoundary}
      />,
    );

    const viewport = screen.getByRole('region', { name: 'Schedule' });
    Object.defineProperties(viewport, {
      clientWidth: { configurable: true, value: 500 },
      scrollWidth: { configurable: true, value: 500 },
      scrollLeft: { configurable: true, writable: true, value: 1 },
    });

    fireEvent.scroll(viewport);

    expect(onReachBoundary).not.toHaveBeenCalled();
  });

  it('ignores a clamped edge arrival caused by changed viewport dimensions', () => {
    const onReachBoundary = vi.fn();
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[lane('one', 'One'), lane('two', 'Two'), lane('three', 'Three')]}
        pixelsPerHour={60}
        viewportWidth={500}
        onReachBoundary={onReachBoundary}
      />,
    );

    const viewport = screen.getByRole('region', { name: 'Schedule' });
    let clientWidth = 500;
    let scrollWidth = 1_600;
    Object.defineProperties(viewport, {
      clientWidth: { configurable: true, get: () => clientWidth },
      scrollWidth: { configurable: true, get: () => scrollWidth },
      scrollLeft: { configurable: true, writable: true, value: 800 },
    });
    fireEvent.scroll(viewport);

    clientWidth = 700;
    scrollWidth = 1_200;
    viewport.scrollLeft = 500;
    fireEvent.scroll(viewport);
    expect(onReachBoundary).not.toHaveBeenCalled();

    viewport.scrollLeft = 400;
    fireEvent.scroll(viewport);
    viewport.scrollLeft = 500;
    fireEvent.scroll(viewport);
    expect(onReachBoundary).toHaveBeenCalledTimes(1);
    expect(onReachBoundary).toHaveBeenLastCalledWith('next');
  });
});
