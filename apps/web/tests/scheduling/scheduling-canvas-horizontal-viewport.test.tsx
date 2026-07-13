import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SchedulingCanvas, type ScheduleItem, type ScheduleLane } from '@/components/scheduling';

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
  it('waits for live container geometry instead of reporting phantom desktop lanes', () => {
    const onViewportGeometry = vi.fn();

    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[lane('one', 'One'), lane('two', 'Two'), lane('three', 'Three')]}
        pixelsPerHour={60}
        onViewportGeometry={onViewportGeometry}
      />,
    );

    expect(onViewportGeometry).not.toHaveBeenCalled();
  });

  it('reanchors the initial lane when the consumer repeats a navigation target', () => {
    const lanes = [
      lane('before', 'July 12'),
      lane('anchor', 'July 13'),
      lane('after-one', 'July 14'),
      lane('after-two', 'July 15'),
    ];
    const canvas = (horizontalAnchorKey: number): React.JSX.Element => (
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={lanes}
        pixelsPerHour={60}
        viewportWidth={500}
        initialLaneIndex={1}
        horizontalAnchorKey={horizontalAnchorKey}
      />
    );
    const result = render(canvas(0));
    const viewport = screen.getByRole('region', { name: 'Schedule' });
    const laneWidth = Number.parseFloat(
      screen.getByText('July 13').parentElement?.style.width ?? '0',
    );
    Object.defineProperty(viewport, 'scrollLeft', {
      configurable: true,
      writable: true,
      value: laneWidth * 2.5,
    });

    result.rerender(canvas(1));

    expect(viewport.scrollLeft).toBe(laneWidth);
  });

  it('keeps the source viewport mounted while centering a rebased boundary window', () => {
    const dates = (startDay: number): ScheduleLane[] =>
      Array.from({ length: 9 }, (_, index) => {
        const day = startDay + index;
        return lane(`2026-07-${String(day).padStart(2, '0')}`, `July ${String(day)}`);
      });
    const canvas = (lanes: readonly ScheduleLane[]): React.JSX.Element => (
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={lanes}
        pixelsPerHour={60}
        viewportWidth={800}
        minimumLaneWidth={220}
        initialLaneIndex={3}
      />
    );
    const result = render(canvas(dates(10)));
    const viewport = screen.getByRole('region', { name: 'Schedule' });
    const laneWidth = Number.parseFloat(
      screen.getByText('July 13').parentElement?.style.width ?? '0',
    );
    viewport.scrollLeft = laneWidth * 6;

    result.rerender(canvas(dates(13)));

    expect(screen.getByText('July 13')).toBeInTheDocument();
    expect(screen.getByText('July 16')).toBeInTheDocument();
    expect(viewport.scrollLeft).toBe(laneWidth * 3);
  });

  it('keeps an active move alive when a boundary rebase changes the source lane index', () => {
    const item: ScheduleItem = {
      id: 'focus',
      title: 'Focus block',
      startsAt: '2026-07-13T09:00:00.000Z',
      endsAt: '2026-07-13T10:00:00.000Z',
    };
    const dates = (startDay: number): ScheduleLane[] =>
      Array.from({ length: 9 }, (_, index) => {
        const day = startDay + index;
        const date = `2026-07-${String(day).padStart(2, '0')}`;
        return {
          ...lane(date, `July ${String(day)}`),
          date,
          items: day === 13 ? [item] : [],
        };
      });
    const onMoveItem = vi.fn();
    const canvas = (lanes: readonly ScheduleLane[]): React.JSX.Element => (
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={lanes}
        pixelsPerHour={60}
        viewportWidth={800}
        minimumLaneWidth={220}
        initialLaneIndex={3}
        onMoveItem={onMoveItem}
      />
    );
    const result = render(canvas(dates(10)));
    const body = screen.getByRole('button', { name: /^Focus block/ });
    fireEvent.pointerDown(body, { button: 0, pointerId: 31, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { pointerId: 31, clientX: 100, clientY: 130 });
    expect(document.querySelector('[data-schedule-item="focus"]')).toHaveAttribute(
      'data-gesture-preview',
      'move',
    );

    result.rerender(canvas(dates(13)));

    expect(document.querySelector('[data-schedule-item="focus"]')).toHaveAttribute(
      'data-gesture-preview',
      'move',
    );
    fireEvent.pointerUp(window, { pointerId: 31, clientX: 100, clientY: 130 });
    expect(onMoveItem).toHaveBeenCalledOnce();
    expect(onMoveItem).toHaveBeenCalledWith(
      expect.objectContaining({
        item,
        fromLane: expect.objectContaining({ id: '2026-07-13' }),
        toLane: expect.objectContaining({ id: '2026-07-16' }),
      }),
    );
  });

  it('reports the lane range intersecting the live horizontal viewport', () => {
    const onVisibleLaneRange = vi.fn();
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[
          lane('one', 'One'),
          lane('two', 'Two'),
          lane('three', 'Three'),
          lane('four', 'Four'),
        ]}
        pixelsPerHour={60}
        viewportWidth={500}
        initialLaneIndex={1}
        onVisibleLaneRange={onVisibleLaneRange}
      />,
    );

    const viewport = screen.getByRole('region', { name: 'Schedule' });
    const laneWidth = Number.parseFloat(screen.getByText('One').parentElement?.style.width ?? '0');
    Object.defineProperties(viewport, {
      clientWidth: { configurable: true, value: 500 },
      scrollLeft: { configurable: true, writable: true, value: laneWidth * 1.25 },
    });

    fireEvent.scroll(viewport);

    expect(onVisibleLaneRange).toHaveBeenLastCalledWith({
      startLane: expect.objectContaining({ id: 'two' }),
      endLane: expect.objectContaining({ id: 'three' }),
    });
  });

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
