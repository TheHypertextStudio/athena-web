import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SchedulingCanvas, type ScheduleItem, type ScheduleLane } from '@/components/scheduling';
import { assertDefined } from '@docket/test-utils';

/** Build one neutral lane for composition tests. */
function lane(items: readonly ScheduleItem[], id = 'date'): ScheduleLane {
  return { id, label: id, date: '2026-07-01', items };
}

/** Build one item on the shared UTC fixture date. */
function item(id: string, appearance: 'event' | 'timebox', allDay = false): ScheduleItem {
  return {
    id,
    title: appearance === 'event' ? 'Planning event' : 'Planning timebox',
    startsAt: '2026-07-01T09:00:00.000Z',
    endsAt: allDay ? '2026-07-02T00:00:00.000Z' : '2026-07-01T10:00:00.000Z',
    allDay,
    appearance,
  };
}

afterEach(cleanup);

describe('SchedulingCanvas composition seams', () => {
  it('places neutral timed underlay and all-day context content in their lane areas', () => {
    const allDayContextClick = vi.fn();
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[lane([])]}
        pixelsPerHour={60}
        viewportWidth={500}
        renderTimedLaneUnderlay={({ lane: renderedLane, geometry }) => (
          <span
            data-testid="timed-rail"
            data-lane={renderedLane.id}
            data-lane-height={geometry.laneHeight}
            data-lane-index={geometry.laneIndex}
          />
        )}
        renderAllDayLaneContext={({ lane: renderedLane, geometry }) => (
          <button
            type="button"
            data-testid="all-day-context-chip"
            data-lane={renderedLane.id}
            data-lane-index={geometry.laneIndex}
            onClick={allDayContextClick}
          >
            Context
          </button>
        )}
      />,
    );

    const timedUnderlay = assertDefined(
      document.querySelector<HTMLElement>('[data-schedule-timed-lane-underlay="date"]'),
    );
    const timedLane = assertDefined(timedUnderlay.closest('[data-schedule-lane="date"]'));
    expect(timedLane.firstElementChild).toBe(timedUnderlay);
    expect(timedUnderlay).toHaveClass('pointer-events-none');
    expect(timedUnderlay).toHaveAttribute('aria-hidden', 'true');
    expect(timedUnderlay).toHaveAttribute('inert');
    expect(screen.getByTestId('timed-rail')).toHaveAttribute('data-lane', 'date');
    expect(screen.getByTestId('timed-rail')).toHaveAttribute('data-lane-index', '0');
    expect(screen.getByTestId('timed-rail')).toHaveAttribute('data-lane-height', '1440');

    const allDayContext = assertDefined(
      document.querySelector<HTMLElement>('[data-schedule-all-day-lane-context="date"]'),
    );
    expect(allDayContext.closest('[data-schedule-all-day-lane="date"]')).not.toBeNull();
    expect(allDayContext).not.toHaveAttribute('inert');
    expect(allDayContext).not.toHaveClass('pointer-events-none');
    expect(screen.getByTestId('all-day-context-chip')).toHaveAttribute('data-lane-index', '0');
    fireEvent.click(screen.getByTestId('all-day-context-chip'));
    expect(allDayContextClick).toHaveBeenCalledOnce();
  });

  it('omits the all-day context wrapper when the app renderer returns no content', () => {
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[lane([])]}
        pixelsPerHour={60}
        viewportWidth={500}
        renderAllDayLaneContext={() => null}
      />,
    );

    expect(document.querySelector('[data-schedule-all-day-lane-context]')).not.toBeInTheDocument();
  });

  it('paints inert item decoration between the base surface and unchanged item content', () => {
    const source = item('timebox', 'timebox');
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[lane([source])]}
        pixelsPerHour={60}
        viewportWidth={500}
        renderTimedItemDecoration={({
          item: renderedItem,
          lane: renderedLane,
          geometry,
          placement,
        }) => (
          <span
            data-testid="item-decoration-content"
            data-item={renderedItem.id}
            data-lane={renderedLane.id}
            data-bounds={`${String(geometry.bounds.startMinutes)}:${String(geometry.bounds.endMinutes)}`}
            data-top={geometry.top}
            data-height={geometry.height}
            data-lane-width={geometry.laneWidth}
            data-pixels-per-hour={geometry.pixelsPerHour}
            data-column={`${String(placement.columnIndex)}:${String(placement.columnCount)}`}
          />
        )}
      />,
    );

    const card = assertDefined(
      document.querySelector<HTMLElement>('[data-schedule-item="timebox"]'),
    );
    const surface = assertDefined(card.querySelector<HTMLElement>('[data-schedule-item-surface]'));
    const decoration = assertDefined(
      card.querySelector<HTMLElement>('[data-schedule-item-decoration]'),
    );
    const content = assertDefined(
      card.querySelector<HTMLElement>('[data-schedule-relationship-covered]'),
    );
    const children = [...card.children];
    expect(children.indexOf(surface)).toBeLessThan(children.indexOf(decoration));
    expect(children.indexOf(decoration)).toBeLessThan(children.indexOf(content));
    expect(card).toHaveClass('isolate');
    expect(surface).toHaveClass('-z-20');
    expect(decoration).toHaveClass('-z-10', 'pointer-events-none');
    expect(decoration).toHaveAttribute('aria-hidden', 'true');
    expect(decoration).toHaveAttribute('inert');
    expect(screen.getByTestId('item-decoration-content')).toHaveAttribute('data-item', 'timebox');
    expect(screen.getByTestId('item-decoration-content')).toHaveAttribute('data-lane', 'date');
    expect(screen.getByTestId('item-decoration-content')).toHaveAttribute('data-bounds', '540:600');
    expect(screen.getByTestId('item-decoration-content')).toHaveAttribute('data-top', '540');
    expect(screen.getByTestId('item-decoration-content')).toHaveAttribute('data-height', '60');
    expect(screen.getByTestId('item-decoration-content')).toHaveAttribute('data-column', '0:1');
  });

  it('supplies the visible target lane and preview geometry during a cross-lane move', () => {
    const source = item('moving-timebox', 'timebox');
    const sourceLane = lane([source], 'source');
    const targetLane = lane([], 'target');
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[sourceLane, targetLane]}
        pixelsPerHour={60}
        viewportWidth={800}
        renderTimedItemDecoration={({ lane: renderedLane, geometry, placement }) => (
          <span
            data-testid="moving-decoration"
            data-lane={renderedLane.id}
            data-lane-index={'laneIndex' in geometry ? geometry.laneIndex : 'missing'}
            data-bounds={`${String(geometry.bounds.startMinutes)}:${String(geometry.bounds.endMinutes)}`}
            data-top={geometry.top}
            data-column={`${String(placement.columnIndex)}:${String(placement.columnCount)}`}
          />
        )}
        onMoveItem={vi.fn()}
      />,
    );

    const body = screen.getByRole('button', { name: /^Planning timebox/ });
    fireEvent.pointerDown(body, { button: 0, pointerId: 41, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { pointerId: 41, clientX: 500, clientY: 130 });

    expect(screen.getByTestId('moving-decoration')).toHaveAttribute('data-lane', 'target');
    expect(screen.getByTestId('moving-decoration')).toHaveAttribute('data-lane-index', '1');
    expect(screen.getByTestId('moving-decoration')).toHaveAttribute('data-bounds', '570:630');
    expect(screen.getByTestId('moving-decoration')).toHaveAttribute('data-top', '570');
    expect(screen.getByTestId('moving-decoration')).toHaveAttribute('data-column', '0:1');

    fireEvent.pointerCancel(window, { pointerId: 41 });
  });

  it('keeps item moves and empty-grid selection active above mounted decorative layers', () => {
    const source = item('layered-timebox', 'timebox');
    const sourceLane = lane([source]);
    const onMoveItem = vi.fn();
    const onSelectRegion = vi.fn();
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[sourceLane]}
        pixelsPerHour={60}
        viewportWidth={500}
        renderTimedLaneUnderlay={() => <span data-testid="mounted-underlay" />}
        renderTimedItemDecoration={() => <span data-testid="mounted-decoration" />}
        onMoveItem={onMoveItem}
        onSelectRegion={onSelectRegion}
      />,
    );

    const body = screen.getByRole('button', { name: /^Planning timebox/ });
    fireEvent.pointerDown(body, { button: 0, pointerId: 51, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { pointerId: 51, clientX: 100, clientY: 130 });
    fireEvent.pointerUp(window, { pointerId: 51, clientX: 100, clientY: 130 });

    expect(onMoveItem).toHaveBeenCalledWith({
      item: source,
      fromLane: sourceLane,
      toLane: sourceLane,
      startMinutes: 570,
      endMinutes: 630,
    });

    const grid = screen.getByLabelText('date time grid');
    fireEvent.pointerDown(grid, { button: 0, pointerId: 52, clientY: 720 });
    fireEvent.pointerUp(window, { pointerId: 52, clientY: 780 });

    expect(onSelectRegion).toHaveBeenCalledWith({
      lane: sourceLane,
      startMinutes: 720,
      endMinutes: 780,
    });
    expect(screen.getByTestId('mounted-underlay')).toBeInTheDocument();
    expect(screen.getByTestId('mounted-decoration')).toBeInTheDocument();
  });

  it.each(['event', 'timebox'] as const)(
    'keeps timed %s activation unchanged when item decoration is present',
    (appearance) => {
      const source = item(appearance, appearance);
      const sourceLane = lane([source]);
      const onOpenItem = vi.fn();
      render(
        <SchedulingCanvas
          displayTimezone="UTC"
          lanes={[sourceLane]}
          pixelsPerHour={60}
          viewportWidth={500}
          renderTimedItemDecoration={() => <span>Decoration</span>}
          onOpenItem={onOpenItem}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${source.title}`) }));
      expect(onOpenItem).toHaveBeenCalledOnce();
      expect(onOpenItem).toHaveBeenCalledWith({ item: source, lane: sourceLane });
    },
  );

  it('keeps all-day activation unchanged when lane context content is present', () => {
    const source = item('all-day-event', 'event', true);
    const sourceLane = lane([source]);
    const onOpenItem = vi.fn();
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[sourceLane]}
        pixelsPerHour={60}
        viewportWidth={500}
        renderAllDayLaneContext={() => <span>Context</span>}
        onOpenItem={onOpenItem}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: source.title }));
    expect(onOpenItem).toHaveBeenCalledOnce();
    expect(onOpenItem).toHaveBeenCalledWith({ item: source, lane: sourceLane });
  });
});
