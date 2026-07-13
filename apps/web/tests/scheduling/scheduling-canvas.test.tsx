import '@testing-library/jest-dom/vitest';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  SCHEDULE_DRAG_MIME,
  scheduleWallPositionForInstant,
  SchedulingCanvas,
  type ScheduleItem,
  type ScheduleLane,
} from '@/components/scheduling';

const TIMED_ITEM: ScheduleItem = {
  id: 'focus',
  title: 'Focus block',
  startsAt: '2026-07-01T09:00:00.000Z',
  endsAt: '2026-07-01T10:00:00.000Z',
  color: '#2563eb',
};

const ALL_DAY_ITEM: ScheduleItem = {
  id: 'offsite',
  title: 'Team offsite',
  startsAt: '2026-07-01T00:00:00.000Z',
  endsAt: '2026-07-02T00:00:00.000Z',
  allDay: true,
};

/** Build a scheduling lane with consumer-owned resource metadata and item data. */
function lane(
  id: string,
  label: string,
  items: readonly ScheduleItem[] = [],
  editable = true,
): ScheduleLane {
  return {
    id,
    label,
    date: '2026-07-01',
    timezone: 'UTC',
    resourceId: `resource-${id}`,
    editable,
    items,
  };
}

/** Build a timed item on the shared UTC fixture date. */
function timedItem(id: string, title: string, startHHMM: string, endHHMM: string): ScheduleItem {
  return {
    id,
    title,
    startsAt: `2026-07-01T${startHHMM}:00.000Z`,
    endsAt: `2026-07-01T${endHHMM}:00.000Z`,
    color: '#7c3aed',
  };
}

/** Return a rendered scheduling item container, failing loudly when it is absent. */
function renderedItem(id: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-schedule-item="${id}"]`);
  if (!element) throw new Error(`No rendered scheduling item for ${id}`);
  return element;
}

/** Capture only the horizontal collision style that must survive input reordering. */
function horizontalStyle(id: string): { left: string; width: string } {
  const element = renderedItem(id);
  return { left: element.style.left, width: element.style.width };
}

/** Read canonical timed-item DOM order without coupling to accessible presentation. */
function timedItemOrder(): (string | undefined)[] {
  return [...document.querySelectorAll<HTMLElement>('[data-schedule-item]')].map(
    (element) => element.dataset['scheduleItem'],
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SchedulingCanvas', () => {
  it('updates gesture options after commit instead of mutating a ref during render', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/components/scheduling/use-scheduling-gesture.ts'),
      'utf8',
    );

    expect(source.match(/optionsRef\.current = options;/g)).toHaveLength(1);
    expect(source).toMatch(
      /useLayoutEffect\(\(\) => \{\s*optionsRef\.current = options;\s*\}, \[options\]\);/,
    );
  });

  it('renders arbitrary lanes, a 24-hour grid, and all-day/timed items without view modes', () => {
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[
          lane('ada', 'Ada', [TIMED_ITEM, ALL_DAY_ITEM]),
          lane('grace', 'Grace'),
          lane('linus', 'Linus'),
        ]}
        pixelsPerHour={64}
        viewportWidth={800}
      />,
    );

    const canvas = screen.getByRole('region', { name: 'Schedule' });
    expect(canvas).toHaveAttribute('data-lane-count', '3');
    expect(canvas).toHaveAttribute('data-visible-lane-count', '3');
    expect(canvas).toHaveAttribute('data-snap-minutes', '10');
    expect(screen.getAllByLabelText(/time grid$/)).toHaveLength(3);
    expect(canvas.querySelectorAll('[data-hour-line]')).toHaveLength(25);
    expect(screen.getByText('Team offsite')).toBeInTheDocument();
    expect(screen.getByText('Focus block')).toBeInTheDocument();
  });

  it('owns a fluid bounded viewport and preserves its visual center across continuous zoom', () => {
    const { rerender } = render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[lane('ada', 'Ada')]}
        pixelsPerHour={60}
        viewportWidth={500}
      />,
    );
    const canvas = screen.getByRole('region', { name: 'Schedule' });
    expect(canvas).toHaveClass('h-[clamp(20rem,68dvh,48rem)]', 'overscroll-contain');

    Object.defineProperties(canvas, {
      clientHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, writable: true, value: 400 },
    });
    fireEvent.scroll(canvas);
    rerender(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[lane('ada', 'Ada')]}
        pixelsPerHour={120}
        viewportWidth={500}
      />,
    );

    expect(canvas.scrollTop).toBe(1_000);
  });

  it('preserves the last observed center when zoom-out clamps the old DOM scroll offset', () => {
    const { rerender } = render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[lane('ada', 'Ada')]}
        pixelsPerHour={120}
        viewportWidth={500}
      />,
    );
    const canvas = screen.getByRole('region', { name: 'Schedule' });
    let scrollTop = 1_000;
    Object.defineProperties(canvas, {
      clientHeight: { configurable: true, value: 400 },
      scrollTop: {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
          scrollTop = value;
        },
      },
    });
    fireEvent.scroll(canvas);
    scrollTop = 200;

    rerender(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[lane('ada', 'Ada')]}
        pixelsPerHour={60}
        viewportWidth={500}
      />,
    );

    expect(canvas.scrollTop).toBe(400);
  });

  it('preserves wall-clock center relative to a variable-height all-day header', () => {
    const { rerender } = render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[lane('ada', 'Ada', [ALL_DAY_ITEM])]}
        pixelsPerHour={60}
        viewportWidth={500}
      />,
    );
    const canvas = screen.getByRole('region', { name: 'Schedule' });
    const timedGrid = document.querySelector('[data-schedule-lane-region]')?.parentElement
      ?.parentElement;
    expect(timedGrid).not.toBeNull();
    if (!timedGrid) return;
    Object.defineProperties(canvas, {
      clientHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, writable: true, value: 650 },
    });
    Object.defineProperty(timedGrid, 'offsetTop', { configurable: true, value: 100 });
    fireEvent.scroll(canvas);

    rerender(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[lane('ada', 'Ada', [ALL_DAY_ITEM])]}
        pixelsPerHour={120}
        viewportWidth={500}
      />,
    );

    expect(canvas.scrollTop).toBe(1_400);
  });

  it('exposes stable body hooks for timed and all-day items', () => {
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[lane('ada', 'Ada', [TIMED_ITEM, ALL_DAY_ITEM])]}
        pixelsPerHour={60}
        viewportWidth={500}
      />,
    );

    expect(screen.getByRole('button', { name: /^Focus block/ })).toHaveAttribute(
      'data-schedule-item-body',
      TIMED_ITEM.id,
    );
    expect(screen.getByRole('button', { name: ALL_DAY_ITEM.title })).toHaveAttribute(
      'data-schedule-item-body',
      ALL_DAY_ITEM.id,
    );
  });

  it('keeps the lane and hour grid mounted under empty and error states', () => {
    const { rerender } = render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[lane('ada', 'Ada'), lane('grace', 'Grace')]}
        pixelsPerHour={60}
        viewportWidth={700}
        emptyMessage="No blocks yet."
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('No blocks yet.');
    expect(screen.getAllByLabelText(/time grid$/)).toHaveLength(2);
    expect(document.querySelectorAll('[data-hour-line]')).toHaveLength(25);

    rerender(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[lane('ada', 'Ada'), lane('grace', 'Grace')]}
        pixelsPerHour={60}
        viewportWidth={700}
        error="Scheduling data is unavailable."
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Scheduling data is unavailable.');
    expect(screen.getAllByLabelText(/time grid$/)).toHaveLength(2);
    expect(document.querySelectorAll('[data-hour-line]')).toHaveLength(25);
  });

  it('emits a snapped pointer-selected region without owning creation', () => {
    const onSelectRegion = vi.fn();
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[lane('ada', 'Ada')]}
        pixelsPerHour={60}
        viewportWidth={500}
        onSelectRegion={onSelectRegion}
      />,
    );

    fireEvent.pointerDown(screen.getByLabelText('Ada time grid'), {
      button: 0,
      clientY: 101,
    });
    fireEvent.pointerUp(window, { clientY: 159 });

    expect(onSelectRegion).toHaveBeenCalledWith(
      expect.objectContaining({
        lane: expect.objectContaining({ id: 'ada' }),
        startMinutes: 100,
        endMinutes: 160,
      }),
    );
  });

  it('shows an exact live body-move preview before one exact same-lane pointerup commit', () => {
    const onMoveItem = vi.fn();
    const displayTimezone = 'UTC';
    const initialStart = scheduleWallPositionForInstant(TIMED_ITEM.startsAt, displayTimezone);
    const initialEnd = scheduleWallPositionForInstant(TIMED_ITEM.endsAt, displayTimezone);
    const sourceLane = lane('ada', 'Ada', [TIMED_ITEM]);
    render(
      <SchedulingCanvas
        displayTimezone={displayTimezone}
        lanes={[sourceLane]}
        pixelsPerHour={60}
        viewportWidth={500}
        onMoveItem={onMoveItem}
      />,
    );

    const body = screen.getByRole('button', { name: /^Focus block/ });
    expect(body).toHaveClass('cursor-grab');
    fireEvent.pointerDown(body, { button: 0, pointerId: 7, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { pointerId: 7, clientX: 100, clientY: 130 });

    expect(onMoveItem).not.toHaveBeenCalled();
    expect(renderedItem('focus')).toHaveAttribute('data-gesture-preview', 'move');
    expect(renderedItem('focus')).toHaveTextContent('9:30 AM – 10:30 AM');
    expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent(
      'Moving Focus block to Ada, 9:30 AM – 10:30 AM.',
    );

    fireEvent.pointerUp(window, { pointerId: 7, clientX: 100, clientY: 130 });

    expect(onMoveItem).toHaveBeenCalledTimes(1);
    expect(onMoveItem).toHaveBeenCalledWith({
      item: TIMED_ITEM,
      fromLane: sourceLane,
      toLane: sourceLane,
      startMinutes: (initialStart?.wallMinutes ?? Number.NaN) + 30,
      endMinutes: (initialEnd?.wallMinutes ?? Number.NaN) + 30,
    });
  });

  it('keeps live pointer previews mounted through a StrictMode effect replay', () => {
    const onMoveItem = vi.fn();
    render(
      <StrictMode>
        <SchedulingCanvas
          displayTimezone="UTC"
          lanes={[lane('ada', 'Ada', [TIMED_ITEM])]}
          pixelsPerHour={60}
          viewportWidth={500}
          onMoveItem={onMoveItem}
        />
      </StrictMode>,
    );

    const body = screen.getByRole('button', { name: /^Focus block/ });
    fireEvent.pointerDown(body, { button: 0, pointerId: 71, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { pointerId: 71, clientX: 100, clientY: 130 });

    expect(renderedItem('focus')).toHaveAttribute('data-gesture-preview', 'move');
    expect(renderedItem('focus')).toHaveTextContent('9:30 AM – 10:30 AM');
    expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent(
      'Moving Focus block to Ada, 9:30 AM – 10:30 AM.',
    );
    expect(onMoveItem).not.toHaveBeenCalled();
    fireEvent.pointerCancel(window, { pointerId: 71 });
  });

  it('commits a body move across an editable arbitrary lane', () => {
    const onMoveItem = vi.fn();
    const sourceLane = lane('ada', 'Ada', [TIMED_ITEM]);
    const targetLane = lane('grace', 'Grace');
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[sourceLane, targetLane]}
        pixelsPerHour={60}
        viewportWidth={800}
        onMoveItem={onMoveItem}
      />,
    );

    const body = screen.getByRole('button', { name: /^Focus block/ });
    fireEvent.pointerDown(body, { button: 0, pointerId: 8, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { pointerId: 8, clientX: 500, clientY: 130 });
    expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent(
      'Moving Focus block to Grace, 9:30 AM – 10:30 AM.',
    );
    fireEvent.pointerUp(window, { pointerId: 8, clientX: 500, clientY: 130 });

    expect(onMoveItem).toHaveBeenCalledOnce();
    expect(onMoveItem).toHaveBeenCalledWith({
      item: TIMED_ITEM,
      fromLane: sourceLane,
      toLane: targetLane,
      startMinutes: 9 * 60 + 30,
      endMinutes: 10 * 60 + 30,
    });
  });

  it('keeps a below-threshold body press as an open click with no move', () => {
    const onOpenItem = vi.fn();
    const onMoveItem = vi.fn();
    const sourceLane = lane('ada', 'Ada', [TIMED_ITEM]);
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[sourceLane]}
        pixelsPerHour={60}
        viewportWidth={500}
        onOpenItem={onOpenItem}
        onMoveItem={onMoveItem}
      />,
    );

    const body = screen.getByRole('button', { name: /^Focus block/ });
    fireEvent.pointerDown(body, { button: 0, pointerId: 9, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { pointerId: 9, clientX: 100, clientY: 103 });
    fireEvent.pointerUp(window, { pointerId: 9, clientX: 100, clientY: 103 });
    fireEvent.click(body, { detail: 1 });

    expect(onMoveItem).not.toHaveBeenCalled();
    expect(onOpenItem).toHaveBeenCalledOnce();
    expect(onOpenItem).toHaveBeenCalledWith({ item: TIMED_ITEM, lane: sourceLane });
  });

  it('activates at exactly four Euclidean pixels but commits only a changed preview', () => {
    const onMoveItem = vi.fn();
    const onOpenItem = vi.fn();
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[lane('ada', 'Ada', [TIMED_ITEM])]}
        pixelsPerHour={240}
        viewportWidth={500}
        onMoveItem={onMoveItem}
        onOpenItem={onOpenItem}
      />,
    );

    const body = screen.getByRole('button', { name: /^Focus block/ });
    fireEvent.pointerDown(body, { button: 0, pointerId: 10, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { pointerId: 10, clientX: 100, clientY: 104 });

    expect(renderedItem('focus')).toHaveAttribute('data-gesture-preview', 'move');
    fireEvent.pointerUp(window, { pointerId: 10, clientX: 100, clientY: 104 });
    fireEvent.click(body, { detail: 1 });
    expect(onMoveItem).not.toHaveBeenCalled();
    expect(onOpenItem).not.toHaveBeenCalled();
  });

  it('previews and commits both edge resizes with exact semantic bounds', () => {
    const onResizeItem = vi.fn();
    const sourceLane = lane('ada', 'Ada', [TIMED_ITEM]);
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[sourceLane]}
        pixelsPerHour={60}
        viewportWidth={500}
        onResizeItem={onResizeItem}
      />,
    );

    const startGrip = screen.getByRole('button', { name: 'Resize Focus block from start' });
    const startIndicator = startGrip.querySelector('[data-schedule-resize-indicator="start"]');
    expect(renderedItem('focus')).toHaveClass('overflow-visible');
    expect(startGrip).toHaveAttribute('data-schedule-resize-target', 'start');
    expect(startGrip).toHaveClass(
      '-top-3',
      'left-0',
      'size-6',
      'touch-none',
      'bg-transparent',
      'pointer-events-none',
      'group-hover:pointer-events-auto',
      'group-focus-within:pointer-events-auto',
      '[@media(pointer:coarse)]:-top-8',
      '[@media(pointer:coarse)]:size-11',
      '[@media(pointer:coarse)]:pointer-events-auto',
    );
    expect(startGrip).not.toHaveClass('-left-3', '[@media(pointer:coarse)]:-left-8');
    expect(startIndicator).toHaveClass(
      'bottom-2.5',
      'h-0.5',
      'opacity-0',
      'motion-reduce:transition-none',
      '[@media(pointer:coarse)]:opacity-100',
    );
    fireEvent.pointerDown(startGrip, { button: 0, pointerId: 11, clientY: 100 });
    fireEvent.pointerMove(window, { pointerId: 11, clientY: 130 });
    expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent(
      'Resizing start of Focus block in Ada, 9:30 AM – 10:00 AM.',
    );
    fireEvent.pointerUp(window, { pointerId: 11, clientY: 130 });

    const endGrip = screen.getByRole('button', { name: 'Resize Focus block from end' });
    const endIndicator = endGrip.querySelector('[data-schedule-resize-indicator="end"]');
    expect(endGrip).toHaveAttribute('data-schedule-resize-target', 'end');
    expect(endGrip).toHaveClass(
      'right-0',
      '-bottom-3',
      'size-6',
      'touch-none',
      'bg-transparent',
      'pointer-events-none',
      'group-hover:pointer-events-auto',
      'group-focus-within:pointer-events-auto',
      '[@media(pointer:coarse)]:-bottom-8',
      '[@media(pointer:coarse)]:size-11',
      '[@media(pointer:coarse)]:pointer-events-auto',
    );
    expect(endGrip).not.toHaveClass('-right-3', '[@media(pointer:coarse)]:-right-8');
    expect(endIndicator).toHaveClass(
      'top-2.5',
      'h-0.5',
      'opacity-0',
      '[@media(pointer:coarse)]:opacity-100',
    );
    fireEvent.pointerDown(endGrip, { button: 0, pointerId: 12, clientY: 100 });
    fireEvent.pointerMove(window, { pointerId: 12, clientY: 130 });
    expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent(
      'Resizing end of Focus block in Ada, 9:00 AM – 10:30 AM.',
    );
    fireEvent.pointerUp(window, { pointerId: 12, clientY: 130 });

    expect(onResizeItem).toHaveBeenCalledTimes(2);
    expect(onResizeItem.mock.calls).toEqual([
      [
        {
          item: TIMED_ITEM,
          lane: sourceLane,
          edge: 'start',
          startMinutes: 9 * 60 + 30,
          endMinutes: 10 * 60,
        },
      ],
      [
        {
          item: TIMED_ITEM,
          lane: sourceLane,
          edge: 'end',
          startMinutes: 9 * 60,
          endMinutes: 10 * 60 + 30,
        },
      ],
    ]);
  });

  it.each([
    {
      edge: 'start',
      item: timedItem('preview-start', 'Preview start', '00:30', '01:30'),
      pointerId: 111,
      clientY: 70,
      previewMode: 'resize-start',
      boundaryClass: 'top-0',
      outsideClasses: ['-top-3', '[@media(pointer:coarse)]:-top-8'],
      indicatorBoundaryClass: 'top-0',
      indicatorOutsideClass: 'bottom-2.5',
      expectedTime: '12:00 AM – 1:30 AM',
    },
    {
      edge: 'end',
      item: timedItem('preview-end', 'Preview end', '22:30', '23:30'),
      pointerId: 112,
      clientY: 130,
      previewMode: 'resize-end',
      boundaryClass: 'bottom-0',
      outsideClasses: ['-bottom-3', '[@media(pointer:coarse)]:-bottom-8'],
      indicatorBoundaryClass: 'bottom-0',
      indicatorOutsideClass: 'top-2.5',
      expectedTime: '10:30 PM – 12:00 AM',
    },
  ])(
    'positions the $edge target from its live day-boundary preview before commit',
    ({
      edge,
      item,
      pointerId,
      clientY,
      previewMode,
      boundaryClass,
      outsideClasses,
      indicatorBoundaryClass,
      indicatorOutsideClass,
      expectedTime,
    }) => {
      const onResizeItem = vi.fn();
      render(
        <SchedulingCanvas
          displayTimezone="UTC"
          lanes={[lane('preview', 'Preview', [item])]}
          pixelsPerHour={60}
          viewportWidth={500}
          onResizeItem={onResizeItem}
        />,
      );

      const grip = screen.getByRole('button', {
        name: `Resize ${item.title} from ${edge}`,
      });
      fireEvent.pointerDown(grip, { button: 0, pointerId, clientY: 100 });
      fireEvent.pointerMove(window, { pointerId, clientY });

      const card = renderedItem(item.id);
      const indicator = grip.querySelector(`[data-schedule-resize-indicator="${edge}"]`);
      expect(card).toHaveAttribute('data-gesture-preview', previewMode);
      expect(card).toHaveTextContent(expectedTime);
      expect(grip).toHaveClass(boundaryClass);
      expect(grip).not.toHaveClass(...outsideClasses);
      expect(indicator).toHaveClass(indicatorBoundaryClass);
      expect(indicator).not.toHaveClass(indicatorOutsideClass);
      expect(onResizeItem).not.toHaveBeenCalled();

      fireEvent.pointerCancel(window, { pointerId });
      expect(card).not.toHaveAttribute('data-gesture-preview');
      expect(onResizeItem).not.toHaveBeenCalled();
    },
  );

  it('keeps first-lane day-start and last-lane day-end targets inside canvas boundaries', () => {
    const dayStart = timedItem('day-start', 'Day start', '00:00', '01:00');
    const dayEnd: ScheduleItem = {
      ...timedItem('day-end', 'Day end', '23:00', '23:30'),
      endsAt: '2026-07-02T00:00:00.000Z',
    };
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[lane('first', 'First', [dayStart]), lane('last', 'Last', [dayEnd])]}
        pixelsPerHour={60}
        viewportWidth={800}
        onResizeItem={vi.fn()}
      />,
    );

    const firstCard = renderedItem('day-start');
    const startGrip = screen.getByRole('button', { name: 'Resize Day start from start' });
    const startIndicator = startGrip.querySelector('[data-schedule-resize-indicator="start"]');
    expect(firstCard.closest('[data-schedule-lane]')).toHaveAttribute(
      'data-schedule-lane',
      'first',
    );
    expect(firstCard).toHaveStyle({
      top: '0px',
      left: '4px',
      width: 'calc(100% - 8px)',
    });
    expect(startGrip).toHaveClass('top-0', 'left-0', 'size-6', '[@media(pointer:coarse)]:size-11');
    expect(startGrip).not.toHaveClass('-top-3', '-left-3', '[@media(pointer:coarse)]:-top-8');
    expect(startIndicator).toHaveClass(
      'top-0',
      'opacity-0',
      'group-hover:opacity-100',
      'group-focus-within:opacity-100',
      '[@media(pointer:coarse)]:opacity-100',
    );

    const lastCard = renderedItem('day-end');
    const endGrip = screen.getByRole('button', { name: 'Resize Day end from end' });
    const endIndicator = endGrip.querySelector('[data-schedule-resize-indicator="end"]');
    expect(lastCard.closest('[data-schedule-lane]')).toHaveAttribute('data-schedule-lane', 'last');
    expect(lastCard).toHaveStyle({
      top: '1380px',
      left: '4px',
      width: 'calc(100% - 8px)',
      height: '60px',
    });
    expect(endGrip).toHaveClass(
      'right-0',
      'bottom-0',
      'size-6',
      '[@media(pointer:coarse)]:size-11',
    );
    expect(endGrip).not.toHaveClass('-right-3', '-bottom-3', '[@media(pointer:coarse)]:-bottom-8');
    expect(endIndicator).toHaveClass(
      'bottom-0',
      'opacity-0',
      'group-hover:opacity-100',
      'group-focus-within:opacity-100',
      '[@media(pointer:coarse)]:opacity-100',
    );
  });

  it('respects lane and item editability while preserving open behavior', () => {
    const onOpenItem = vi.fn();
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[lane('ada', 'Ada', [{ ...TIMED_ITEM, editable: true }], false)]}
        pixelsPerHour={60}
        viewportWidth={500}
        onOpenItem={onOpenItem}
        onMoveItem={vi.fn()}
        onResizeItem={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Move Focus block' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Resize Focus block from end' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Focus block is read-only')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Focus block/ }));
    expect(onOpenItem).toHaveBeenCalledOnce();
  });

  it('shows an application-owned read-only label without adding move or resize controls', () => {
    const item = {
      ...TIMED_ITEM,
      editable: false,
      readOnlyLabel: 'Read-only',
    } as ScheduleItem & { readonly readOnlyLabel: string };
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[lane('ada', 'Ada', [item])]}
        pixelsPerHour={60}
        viewportWidth={500}
        onOpenItem={vi.fn()}
        onMoveItem={vi.fn()}
        onResizeItem={vi.fn()}
      />,
    );

    const body = screen.getByRole('button', { name: /^Focus block/ });
    const description = screen.getByText('Read-only');
    expect(description).toHaveAttribute('id');
    expect(body).toHaveAttribute('aria-describedby', description.id);
    expect(body).toHaveAccessibleDescription('Read-only');
    expect(screen.queryByRole('button', { name: 'Move Focus block' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Resize Focus block from end' }),
    ).not.toBeInTheDocument();
  });

  it('clears a live preview and emits no commit on Escape', () => {
    const onMoveItem = vi.fn();
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[lane('ada', 'Ada', [TIMED_ITEM])]}
        pixelsPerHour={60}
        viewportWidth={500}
        onMoveItem={onMoveItem}
      />,
    );

    const body = screen.getByRole('button', { name: /^Focus block/ });
    fireEvent.pointerDown(body, { button: 0, pointerId: 13, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { pointerId: 13, clientX: 100, clientY: 130 });
    expect(renderedItem('focus')).toHaveAttribute('data-gesture-preview', 'move');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(renderedItem('focus')).not.toHaveAttribute('data-gesture-preview');
    expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent('');
    fireEvent.pointerUp(window, { pointerId: 13, clientX: 100, clientY: 130 });
    expect(onMoveItem).not.toHaveBeenCalled();
  });

  it('clears a live preview and emits no commit on pointer cancel', () => {
    const onResizeItem = vi.fn();
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[lane('ada', 'Ada', [TIMED_ITEM])]}
        pixelsPerHour={60}
        viewportWidth={500}
        onResizeItem={onResizeItem}
      />,
    );

    const grip = screen.getByRole('button', { name: 'Resize Focus block from end' });
    fireEvent.pointerDown(grip, { button: 0, pointerId: 14, clientY: 100 });
    fireEvent.pointerMove(window, { pointerId: 14, clientY: 130 });
    expect(renderedItem('focus')).toHaveAttribute('data-gesture-preview', 'resize-end');

    fireEvent.pointerCancel(window, { pointerId: 14 });
    expect(renderedItem('focus')).not.toHaveAttribute('data-gesture-preview');
    fireEvent.pointerUp(window, { pointerId: 14, clientY: 130 });
    expect(onResizeItem).not.toHaveBeenCalled();
  });

  it('keeps body, move, link, and resize paths distinct on an 18px card', () => {
    const onOpenItem = vi.fn();
    const onMoveItem = vi.fn();
    const onResizeItem = vi.fn();
    const dragObject = {
      kind: 'calendar_item' as const,
      itemId: 'short-overview',
      title: 'Short overview',
    };
    const short = {
      ...timedItem('short-overview', 'Short overview', '09:00', '09:05'),
      dragObject,
    };
    const sourceLane = lane('ada', 'Ada', [short]);
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[sourceLane]}
        pixelsPerHour={24}
        viewportWidth={500}
        onOpenItem={onOpenItem}
        onMoveItem={onMoveItem}
        onResizeItem={onResizeItem}
      />,
    );

    const article = renderedItem('short-overview');
    const body = screen.getByRole('button', { name: /^Short overview/ });
    const move = screen.getByRole('button', { name: 'Move Short overview' });
    const link = screen.getByRole('button', {
      name: 'Drag Short overview to create a relationship',
    });
    const startGrip = screen.getByRole('button', { name: 'Resize Short overview from start' });
    const endGrip = screen.getByRole('button', { name: 'Resize Short overview from end' });
    expect(article).toHaveClass('overflow-visible');
    expect(body).toHaveClass('cursor-grab', 'overflow-hidden', 'rounded-sm');
    expect(move).toHaveClass('z-30');
    expect(link).toHaveClass('z-30');
    expect(link).toHaveAttribute('draggable', 'true');
    expect(startGrip).toHaveClass(
      '-top-3',
      'left-0',
      'z-20',
      'size-6',
      '[@media(pointer:coarse)]:size-11',
    );
    expect(endGrip).toHaveClass(
      'right-0',
      '-bottom-3',
      'z-20',
      'size-6',
      '[@media(pointer:coarse)]:size-11',
    );
    fireEvent.click(body);
    expect(onOpenItem).toHaveBeenCalledOnce();

    fireEvent.pointerDown(move, { button: 0, pointerId: 15, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { pointerId: 15, clientX: 100, clientY: 112 });
    fireEvent.pointerUp(window, { pointerId: 15, clientX: 100, clientY: 112 });
    expect(onMoveItem).toHaveBeenCalledWith({
      item: short,
      fromLane: sourceLane,
      toLane: sourceLane,
      startMinutes: 9 * 60 + 30,
      endMinutes: 9 * 60 + 35,
    });

    const transfer = { effectAllowed: 'none', setData: vi.fn() };
    fireEvent.pointerDown(link, { button: 0, pointerId: 16, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { pointerId: 16, clientX: 100, clientY: 112 });
    fireEvent.pointerUp(window, { pointerId: 16, clientX: 100, clientY: 112 });
    fireEvent.dragStart(link, { dataTransfer: transfer });
    expect(transfer.setData.mock.calls).toEqual([
      [SCHEDULE_DRAG_MIME, JSON.stringify(dragObject)],
      ['text/plain', short.title],
    ]);
    expect(onMoveItem).toHaveBeenCalledOnce();

    for (const edge of ['start', 'end'] as const) {
      const grip = screen.getByRole('button', {
        name: `Resize Short overview from ${edge}`,
      });
      fireEvent.pointerDown(grip, {
        button: 0,
        pointerId: edge === 'start' ? 17 : 18,
        clientY: 100,
      });
      fireEvent.pointerUp(window, { pointerId: edge === 'start' ? 17 : 18, clientY: 100 });
    }

    expect(onResizeItem).not.toHaveBeenCalled();
    expect(renderedItem('short-overview')).toHaveStyle({ top: '216px', height: '18px' });
  });

  it('exposes no valid preview or commit over a forbidden target lane', () => {
    const onMoveItem = vi.fn();
    const onOpenItem = vi.fn();
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[lane('ada', 'Ada', [TIMED_ITEM]), lane('grace', 'Grace', [], false)]}
        pixelsPerHour={60}
        viewportWidth={800}
        onMoveItem={onMoveItem}
        onOpenItem={onOpenItem}
      />,
    );

    const body = screen.getByRole('button', { name: /^Focus block/ });
    fireEvent.pointerDown(body, { button: 0, pointerId: 17, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { pointerId: 17, clientX: 500, clientY: 130 });
    expect(renderedItem('focus')).not.toHaveAttribute('data-gesture-preview');
    expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent('');
    fireEvent.pointerUp(window, { pointerId: 17, clientX: 500, clientY: 130 });
    fireEvent.click(body, { detail: 1 });
    expect(onMoveItem).not.toHaveBeenCalled();
    expect(onOpenItem).not.toHaveBeenCalled();
  });

  it('captures an activated pointer and releases it exactly once at completion', () => {
    const onMoveItem = vi.fn();
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[lane('ada', 'Ada', [TIMED_ITEM])]}
        pixelsPerHour={60}
        viewportWidth={500}
        onMoveItem={onMoveItem}
      />,
    );

    const body = screen.getByRole('button', { name: /^Focus block/ });
    const setPointerCapture = vi.fn();
    const releasePointerCapture = vi.fn();
    Object.defineProperties(body, {
      setPointerCapture: { configurable: true, value: setPointerCapture },
      releasePointerCapture: { configurable: true, value: releasePointerCapture },
    });

    fireEvent.pointerDown(body, { button: 0, pointerId: 18, clientX: 100, clientY: 100 });
    expect(setPointerCapture).not.toHaveBeenCalled();
    fireEvent.pointerMove(window, { pointerId: 18, clientX: 100, clientY: 130 });
    expect(setPointerCapture).toHaveBeenCalledOnce();
    expect(setPointerCapture).toHaveBeenCalledWith(18);
    fireEvent.pointerUp(window, { pointerId: 18, clientX: 100, clientY: 130 });
    expect(releasePointerCapture).toHaveBeenCalledOnce();
    expect(releasePointerCapture).toHaveBeenCalledWith(18);
  });

  it('cancels only its matching lost pointer capture and ignores the later pointerup', () => {
    const onMoveItem = vi.fn();
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[lane('ada', 'Ada', [TIMED_ITEM])]}
        pixelsPerHour={60}
        viewportWidth={500}
        onMoveItem={onMoveItem}
      />,
    );

    const body = screen.getByRole('button', { name: /^Focus block/ });
    Object.defineProperties(body, {
      setPointerCapture: { configurable: true, value: vi.fn() },
      releasePointerCapture: { configurable: true, value: vi.fn() },
    });
    fireEvent.pointerDown(body, { button: 0, pointerId: 181, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { pointerId: 181, clientX: 100, clientY: 130 });
    const mismatchedCapture = new Event('lostpointercapture', { bubbles: false });
    Object.defineProperty(mismatchedCapture, 'pointerId', { value: 999 });
    fireEvent(body, mismatchedCapture);
    expect(renderedItem('focus')).toHaveAttribute('data-gesture-preview', 'move');

    const matchingCapture = new Event('lostpointercapture', { bubbles: false });
    Object.defineProperty(matchingCapture, 'pointerId', { value: 181 });
    fireEvent(body, matchingCapture);
    fireEvent.pointerUp(window, { pointerId: 181, clientX: 100, clientY: 130 });

    expect(renderedItem('focus')).not.toHaveAttribute('data-gesture-preview');
    expect(onMoveItem).not.toHaveBeenCalled();
  });

  it('runs sequential gestures without multiplying commits or replacing the card and live node', () => {
    const onMoveItem = vi.fn();
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[lane('ada', 'Ada', [TIMED_ITEM])]}
        pixelsPerHour={60}
        viewportWidth={500}
        onMoveItem={onMoveItem}
      />,
    );

    const body = screen.getByRole('button', { name: /^Focus block/ });
    const article = renderedItem('focus');
    const liveNode = document.querySelector('[aria-live="polite"]');
    expect(liveNode).not.toBeNull();
    for (const pointerId of [182, 183]) {
      fireEvent.pointerDown(body, { button: 0, pointerId, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(window, { pointerId, clientX: 100, clientY: 130 });
      expect(renderedItem('focus')).toBe(article);
      expect(renderedItem('focus')).toHaveAttribute('data-layout-column', '0');
      expect(document.querySelector('[aria-live="polite"]')).toBe(liveNode);
      fireEvent.pointerUp(window, { pointerId, clientX: 100, clientY: 130 });
    }

    expect(onMoveItem).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[aria-live="polite"]')).toBe(liveNode);
  });

  it('adjusts the dedicated move control and both resize grips by one active snap per key', () => {
    const onMoveItem = vi.fn();
    const onResizeItem = vi.fn();
    const sourceLane = lane('ada', 'Ada', [TIMED_ITEM]);
    const targetLane = lane('grace', 'Grace');
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[sourceLane, targetLane]}
        pixelsPerHour={60}
        viewportWidth={800}
        onMoveItem={onMoveItem}
        onResizeItem={onResizeItem}
      />,
    );

    const move = screen.getByRole('button', { name: 'Move Focus block' });
    fireEvent.keyDown(move, { key: 'ArrowDown' });
    fireEvent.keyUp(move, { key: 'ArrowDown' });
    expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent(
      'Moving Focus block to Ada, 9:10 AM – 10:10 AM.',
    );
    fireEvent.keyDown(move, { key: 'ArrowRight' });
    fireEvent.keyUp(move, { key: 'ArrowRight' });
    expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent(
      'Moving Focus block to Grace, 9:00 AM – 10:00 AM.',
    );
    fireEvent.keyDown(screen.getByRole('button', { name: 'Resize Focus block from start' }), {
      key: 'ArrowDown',
    });
    expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent(
      'Resizing start of Focus block in Ada, 9:10 AM – 10:00 AM.',
    );
    fireEvent.keyDown(screen.getByRole('button', { name: 'Resize Focus block from end' }), {
      key: 'ArrowUp',
    });
    expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent(
      'Resizing end of Focus block in Ada, 9:00 AM – 9:50 AM.',
    );

    expect(onMoveItem.mock.calls).toEqual([
      [
        {
          item: TIMED_ITEM,
          fromLane: sourceLane,
          toLane: sourceLane,
          startMinutes: 9 * 60 + 10,
          endMinutes: 10 * 60 + 10,
        },
      ],
      [
        {
          item: TIMED_ITEM,
          fromLane: sourceLane,
          toLane: targetLane,
          startMinutes: 9 * 60,
          endMinutes: 10 * 60,
        },
      ],
    ]);
    expect(onResizeItem.mock.calls).toEqual([
      [
        {
          item: TIMED_ITEM,
          lane: sourceLane,
          edge: 'start',
          startMinutes: 9 * 60 + 10,
          endMinutes: 10 * 60,
        },
      ],
      [
        {
          item: TIMED_ITEM,
          lane: sourceLane,
          edge: 'end',
          startMinutes: 9 * 60,
          endMinutes: 10 * 60 - 10,
        },
      ],
    ]);
  });

  it('does not emit duplicate or unchanged keyboard commits at lane and day boundaries', () => {
    const onMoveItem = vi.fn();
    const onResizeItem = vi.fn();
    const midnight = timedItem('midnight', 'Midnight', '00:00', '01:00');
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[lane('ada', 'Ada', [midnight])]}
        pixelsPerHour={60}
        viewportWidth={500}
        onMoveItem={onMoveItem}
        onResizeItem={onResizeItem}
      />,
    );

    const move = screen.getByRole('button', { name: 'Move Midnight' });
    fireEvent.keyDown(move, { key: 'ArrowLeft' });
    fireEvent.keyUp(move, { key: 'ArrowLeft' });
    fireEvent.keyDown(move, { key: 'ArrowUp' });
    fireEvent.keyUp(move, { key: 'ArrowUp' });
    const start = screen.getByRole('button', { name: 'Resize Midnight from start' });
    fireEvent.keyDown(start, { key: 'ArrowUp' });
    fireEvent.keyUp(start, { key: 'ArrowUp' });

    expect(onMoveItem).not.toHaveBeenCalled();
    expect(onResizeItem).not.toHaveBeenCalled();
    expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent('');
  });

  it('takes one bounded auto-scroll step per active pointer movement near viewport edges', () => {
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[lane('ada', 'Ada', [TIMED_ITEM])]}
        pixelsPerHour={60}
        viewportWidth={500}
        onMoveItem={vi.fn()}
      />,
    );
    const viewport = screen.getByRole('region', { name: 'Schedule' });
    const scrollBy = vi.fn((options: ScrollToOptions) => {
      viewport.scrollLeft += options.left ?? 0;
      viewport.scrollTop += options.top ?? 0;
    });
    Object.defineProperties(viewport, {
      clientWidth: { configurable: true, value: 500 },
      clientHeight: { configurable: true, value: 500 },
      scrollWidth: { configurable: true, value: 1_000 },
      scrollHeight: { configurable: true, value: 2_000 },
      scrollLeft: { configurable: true, writable: true, value: 100 },
      scrollTop: { configurable: true, writable: true, value: 100 },
      scrollBy: { configurable: true, value: scrollBy },
      getBoundingClientRect: {
        configurable: true,
        value: () => ({ left: 0, right: 500, top: 0, bottom: 500, width: 500, height: 500 }),
      },
    });

    const body = screen.getByRole('button', { name: /^Focus block/ });
    fireEvent.pointerDown(body, { button: 0, pointerId: 19, clientX: 250, clientY: 250 });
    fireEvent.pointerMove(window, { pointerId: 19, clientX: 250, clientY: 490 });
    expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent(
      'Moving Focus block to Ada, 1:20 PM – 2:20 PM.',
    );
    fireEvent.pointerMove(window, { pointerId: 19, clientX: 250, clientY: 491 });
    expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent(
      'Moving Focus block to Ada, 1:30 PM – 2:30 PM.',
    );

    expect(scrollBy).toHaveBeenCalledTimes(2);
    expect(scrollBy).toHaveBeenNthCalledWith(1, { left: 0, top: 16, behavior: 'auto' });
    expect(scrollBy).toHaveBeenNthCalledWith(2, { left: 0, top: 16, behavior: 'auto' });
    fireEvent.pointerCancel(window, { pointerId: 19 });
  });

  it('removes every armed global handler on source disappearance without warnings or commit', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onMoveItem = vi.fn();
    const { unmount } = render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[lane('ada', 'Ada', [TIMED_ITEM])]}
        pixelsPerHour={60}
        viewportWidth={500}
        onMoveItem={onMoveItem}
      />,
    );

    fireEvent.pointerDown(screen.getByRole('button', { name: /^Focus block/ }), {
      button: 0,
      pointerId: 20,
      clientX: 100,
      clientY: 100,
    });
    const gestureAdds = addSpy.mock.calls.filter(([type]) =>
      ['pointermove', 'pointerup', 'pointercancel', 'keydown'].includes(type),
    );
    expect(gestureAdds).toHaveLength(4);
    unmount();

    for (const [type, listener, options] of gestureAdds) {
      if (options === undefined) expect(removeSpy).toHaveBeenCalledWith(type, listener);
      else expect(removeSpy).toHaveBeenCalledWith(type, listener, options);
    }
    expect(onMoveItem).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('emits a typed object drop only for an explicit item target', () => {
    const onDropObjectOnItem = vi.fn();
    const target = { ...TIMED_ITEM, dropTarget: true };
    const payload = {
      kind: 'task',
      taskId: 'task_1',
      organizationId: 'org_1',
      title: 'Prepare review',
    };
    const transfer = {
      types: [SCHEDULE_DRAG_MIME],
      dropEffect: 'none',
      getData: (type: string) => (type === SCHEDULE_DRAG_MIME ? JSON.stringify(payload) : ''),
    };

    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[lane('ada', 'Ada', [target])]}
        pixelsPerHour={60}
        viewportWidth={500}
        onDropObjectOnItem={onDropObjectOnItem}
      />,
    );

    fireEvent.dragOver(screen.getByRole('button', { name: /^Focus block/ }), {
      dataTransfer: transfer,
    });
    fireEvent.drop(screen.getByRole('button', { name: /^Focus block/ }), {
      dataTransfer: transfer,
    });

    expect(onDropObjectOnItem).toHaveBeenCalledWith({
      object: payload,
      targetItem: target,
      targetLane: expect.objectContaining({ id: 'ada' }),
    });
  });

  it('keeps a read-only all-day pill openable, droppable, and relationship-draggable', () => {
    const dragObject = {
      kind: 'calendar_item' as const,
      itemId: ALL_DAY_ITEM.id,
      title: ALL_DAY_ITEM.title,
    };
    const target = {
      ...ALL_DAY_ITEM,
      editable: false,
      dragObject,
      dropTarget: true,
    };
    const sourceLane = lane('ada', 'Ada', [target], false);
    const onOpenItem = vi.fn();
    const onDropObjectOnItem = vi.fn();
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[sourceLane]}
        pixelsPerHour={60}
        viewportWidth={500}
        onOpenItem={onOpenItem}
        onDropObjectOnItem={onDropObjectOnItem}
      />,
    );

    const pill = screen.getByRole('button', { name: ALL_DAY_ITEM.title });
    expect(pill).toHaveClass(
      'hover:bg-surface-container-high',
      'focus-visible:ring-2',
      'transition-colors',
      'motion-reduce:transition-none',
    );
    fireEvent.click(pill);
    expect(onOpenItem).toHaveBeenCalledWith({ item: target, lane: sourceLane });

    const affordance = screen.getByRole('button', {
      name: `Drag ${ALL_DAY_ITEM.title} to create a relationship`,
    });
    expect(affordance).toHaveAttribute('draggable', 'true');
    const dragTransfer = { effectAllowed: 'none', setData: vi.fn() };
    fireEvent.dragStart(affordance, { dataTransfer: dragTransfer });
    expect(dragTransfer.effectAllowed).toBe('link');
    expect(dragTransfer.setData.mock.calls).toEqual([
      [SCHEDULE_DRAG_MIME, JSON.stringify(dragObject)],
      ['text/plain', ALL_DAY_ITEM.title],
    ]);

    const taskPayload = {
      kind: 'task',
      taskId: 'task_1',
      organizationId: 'org_1',
      title: 'Prepare offsite',
    };
    const taskTransfer = {
      types: [SCHEDULE_DRAG_MIME],
      dropEffect: 'none',
      getData: (type: string) => (type === SCHEDULE_DRAG_MIME ? JSON.stringify(taskPayload) : ''),
    };
    fireEvent.dragOver(pill, { dataTransfer: taskTransfer });
    fireEvent.drop(pill, { dataTransfer: taskTransfer });
    expect(onDropObjectOnItem).toHaveBeenCalledWith({
      object: taskPayload,
      targetItem: target,
      targetLane: sourceLane,
    });

    const selfTransfer = {
      types: [SCHEDULE_DRAG_MIME],
      dropEffect: 'none',
      getData: (type: string) => (type === SCHEDULE_DRAG_MIME ? JSON.stringify(dragObject) : ''),
    };
    fireEvent.drop(pill, { dataTransfer: selfTransfer });
    expect(onDropObjectOnItem).toHaveBeenCalledOnce();
  });

  it('describes an explicit all-day domain read-only label from its open control', () => {
    const item = { ...ALL_DAY_ITEM, editable: false, readOnlyLabel: 'Read-only' };
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[lane('ada', 'Ada', [item])]}
        pixelsPerHour={60}
        viewportWidth={500}
        onOpenItem={vi.fn()}
      />,
    );

    const body = screen.getByRole('button', { name: ALL_DAY_ITEM.title });
    const description = screen.getByText('Read-only');
    expect(description).toHaveAttribute('id');
    expect(body).toHaveAttribute('aria-describedby', description.id);
    expect(body).toHaveAccessibleDescription('Read-only');
  });

  it('keeps read-only description ids unique when an item appears in multiple lanes', () => {
    const timed = { ...TIMED_ITEM, editable: false, readOnlyLabel: 'Read-only' };
    const allDay = { ...ALL_DAY_ITEM, editable: false, readOnlyLabel: 'Read-only' };
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[lane('ada', 'Ada', [timed, allDay]), lane('grace', 'Grace', [timed, allDay])]}
        pixelsPerHour={60}
        viewportWidth={800}
      />,
    );

    const descriptionIds = screen.getAllByText('Read-only').map((description) => description.id);
    expect(descriptionIds).toHaveLength(4);
    expect(new Set(descriptionIds).size).toBe(4);
  });

  it('separates relationship drag onto a dedicated affordance with the exact typed payload', () => {
    const dragObject = {
      kind: 'calendar_item' as const,
      itemId: TIMED_ITEM.id,
      title: TIMED_ITEM.title,
    };
    const onOpenItem = vi.fn();
    const onMoveItem = vi.fn();
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[lane('ada', 'Ada', [{ ...TIMED_ITEM, dragObject }], false)]}
        pixelsPerHour={60}
        viewportWidth={500}
        onOpenItem={onOpenItem}
        onMoveItem={onMoveItem}
      />,
    );

    const article = renderedItem('focus');
    expect(article).not.toHaveAttribute('draggable');
    const affordance = screen.getByRole('button', {
      name: 'Drag Focus block to create a relationship',
    });
    expect(affordance).toHaveAttribute('draggable', 'true');

    const transfer = { effectAllowed: 'none', setData: vi.fn() };
    fireEvent.pointerDown(affordance, {
      button: 0,
      pointerId: 21,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(window, { pointerId: 21, clientX: 100, clientY: 130 });
    fireEvent.pointerUp(window, { pointerId: 21, clientX: 100, clientY: 130 });
    fireEvent.dragStart(affordance, { dataTransfer: transfer });
    expect(transfer.effectAllowed).toBe('link');
    expect(transfer.setData.mock.calls).toEqual([
      [SCHEDULE_DRAG_MIME, JSON.stringify(dragObject)],
      ['text/plain', TIMED_ITEM.title],
    ]);
    expect(onMoveItem).not.toHaveBeenCalled();
    expect(onOpenItem).not.toHaveBeenCalled();
  });

  it('does not expose a relationship-drag affordance without a drag object', () => {
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[lane('ada', 'Ada', [TIMED_ITEM])]}
        pixelsPerHour={60}
        viewportWidth={500}
      />,
    );

    expect(
      screen.queryByRole('button', { name: 'Drag Focus block to create a relationship' }),
    ).not.toBeInTheDocument();
  });

  it('preserves vertical time position while a rolling host replaces its lane window', () => {
    const { rerender } = render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[lane('window-a', 'Window A')]}
        pixelsPerHour={60}
        viewportWidth={500}
      />,
    );
    const canvas = screen.getByRole('region', { name: 'Schedule' });
    canvas.scrollTop = 615;

    rerender(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[lane('window-b', 'Window B')]}
        pixelsPerHour={60}
        viewportWidth={500}
      />,
    );

    expect(canvas.scrollTop).toBe(615);
  });

  it('notifies a rolling host once per horizontal boundary arrival', () => {
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
    const canvas = screen.getByRole('region', { name: 'Schedule' });
    Object.defineProperties(canvas, {
      clientWidth: { configurable: true, value: 500 },
      scrollWidth: { configurable: true, value: 1_000 },
      scrollLeft: { configurable: true, writable: true, value: 500 },
    });

    fireEvent.scroll(canvas);
    fireEvent.scroll(canvas);
    expect(onReachBoundary).toHaveBeenCalledTimes(1);
    expect(onReachBoundary).toHaveBeenLastCalledWith('next');

    canvas.scrollLeft = 200;
    fireEvent.scroll(canvas);
    canvas.scrollLeft = 500;
    fireEvent.scroll(canvas);
    expect(onReachBoundary).toHaveBeenCalledTimes(2);
  });

  it('renders adaptive major labels and minor lines at exact wall-minute positions', () => {
    const { rerender } = render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[lane('date', 'Date')]}
        pixelsPerHour={24}
        viewportWidth={500}
      />,
    );

    const overviewMajor = document.querySelectorAll('[data-schedule-tick="major"]');
    const overviewMinor = document.querySelectorAll('[data-schedule-tick="minor"]');
    expect(overviewMajor).toHaveLength(13);
    expect(overviewMinor).toHaveLength(36);
    expect(document.querySelector('[data-schedule-label="120"]')).toHaveStyle({ top: '48px' });
    expect(document.querySelector('[data-schedule-tick-minutes="30"]')).toHaveStyle({
      top: '12px',
    });

    rerender(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[lane('date', 'Date')]}
        pixelsPerHour={144}
        viewportWidth={500}
      />,
    );
    expect(document.querySelectorAll('[data-schedule-tick="major"]')).toHaveLength(49);
    expect(document.querySelectorAll('[data-schedule-tick="minor"]')).toHaveLength(240);
    expect(document.querySelector('[data-schedule-label="30"]')).toHaveStyle({ top: '72px' });
    expect(document.querySelector('[data-schedule-tick-minutes="5"]')).toHaveStyle({ top: '12px' });
  });

  it('renders a deterministic current-time line only in lanes for its display-zone date', () => {
    render(
      <SchedulingCanvas
        displayTimezone="America/Los_Angeles"
        lanes={[
          { ...lane('yesterday', 'Yesterday'), date: '2026-06-30' },
          { ...lane('today-a', 'Today A'), date: '2026-07-01' },
          { ...lane('today-b', 'Today B'), date: '2026-07-01' },
        ]}
        now="2026-07-01T16:30:00Z"
        pixelsPerHour={60}
        viewportWidth={800}
      />,
    );

    const lines = document.querySelectorAll('[data-current-time-line]');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toHaveAttribute('data-current-time-line', 'today-a');
    expect(lines[1]).toHaveAttribute('data-current-time-line', 'today-b');
    expect(lines[0]).toHaveStyle({ top: '570px' });
    expect(lines[0]?.closest('[data-schedule-current-layer]')).toHaveClass('z-30');
  });

  it('annotates skipped and repeated wall-clock positions in their relevant date lanes', () => {
    render(
      <SchedulingCanvas
        displayTimezone="America/Los_Angeles"
        lanes={[
          { ...lane('spring', 'Spring'), date: '2026-03-08' },
          { ...lane('fall', 'Fall'), date: '2026-11-01' },
        ]}
        pixelsPerHour={60}
        viewportWidth={800}
      />,
    );

    const skipped = document.querySelectorAll(
      '[data-schedule-transition-lane="spring"][data-schedule-transition="skipped"]',
    );
    const repeated = document.querySelectorAll(
      '[data-schedule-transition-lane="fall"][data-schedule-transition="repeated"]',
    );
    expect(skipped).toHaveLength(1);
    expect(repeated).toHaveLength(1);
    expect(skipped[0]).toHaveStyle({ top: '120px', height: '60px' });
    expect(repeated[0]).toHaveStyle({ top: '60px', height: '60px' });
    expect(skipped[0]).toHaveTextContent('Skipped hour · DST');
    expect(repeated[0]).toHaveTextContent('Repeated hour · DST');
    expect(skipped[0]?.closest('[data-schedule-transition-layer]')).toHaveClass('z-0');
  });

  it('keeps one display-zone geometry while showing resource timezones as header metadata', () => {
    const instantA = { ...TIMED_ITEM, id: 'same-a', title: 'Same A' };
    const instantB = { ...TIMED_ITEM, id: 'same-b', title: 'Same B' };
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[
          { ...lane('los-angeles', 'Los Angeles', [instantA]), timezone: 'America/Los_Angeles' },
          { ...lane('london', 'London', [instantB]), timezone: 'Europe/London' },
        ]}
        pixelsPerHour={60}
        viewportWidth={800}
      />,
    );

    expect(screen.getByText('America/Los_Angeles')).toBeInTheDocument();
    expect(screen.getByText('Europe/London')).toBeInTheDocument();
    expect(document.querySelector('[data-schedule-item="same-a"]')).toHaveStyle({ top: '540px' });
    expect(document.querySelector('[data-schedule-item="same-b"]')).toHaveStyle({ top: '540px' });
  });

  it.each([
    {
      name: 'identical pair',
      items: [
        timedItem('identical-b', 'Identical B', '09:00', '10:00'),
        timedItem('identical-a', 'Identical A', '09:00', '10:00'),
      ],
    },
    {
      name: 'partial pair',
      items: [
        timedItem('partial-a', 'Partial A', '09:00', '10:00'),
        timedItem('partial-b', 'Partial B', '09:30', '10:30'),
      ],
    },
    {
      name: 'nested triple',
      items: [
        timedItem('nested-a', 'Nested A', '09:00', '11:00'),
        timedItem('nested-b', 'Nested B', '09:15', '10:45'),
        timedItem('nested-c', 'Nested C', '09:30', '10:00'),
      ],
    },
  ])('gives every item in a $name a distinct horizontal column', ({ items }) => {
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[lane('collision', 'Collision', items)]}
        pixelsPerHour={60}
        viewportWidth={500}
      />,
    );

    const cards = items.map((item) => renderedItem(item.id));
    expect(new Set(cards.map((card) => card.style.left)).size).toBe(items.length);
    expect(new Set(cards.map((card) => card.style.width)).size).toBe(1);
    expect(cards[0]?.style.width).not.toBe('');
    expect(cards[0]?.style.width).not.toBe('calc(100% - 8px)');
    for (const card of cards) {
      expect(card).toHaveAttribute('data-layout-column-count', String(items.length));
      expect(card).not.toHaveStyle({ right: '4px' });
    }
  });

  it.each([5, 6])(
    'clamps resize targets inside the first and last cards of a %i-column collision',
    (columnCount) => {
      const items = Array.from({ length: columnCount }, (_, index) =>
        timedItem(
          `dense-${String(columnCount)}-${String(index)}`,
          `Dense ${String(columnCount)} ${String(index)}`,
          '09:00',
          '10:00',
        ),
      );
      render(
        <SchedulingCanvas
          displayTimezone="UTC"
          lanes={[lane('dense', 'Dense', items)]}
          pixelsPerHour={60}
          viewportWidth={280}
          onResizeItem={vi.fn()}
        />,
      );

      const firstItem = items[0]!;
      const lastItem = items.at(-1)!;
      const firstCard = renderedItem(firstItem.id);
      const lastCard = renderedItem(lastItem.id);
      expect(firstCard).toHaveAttribute('data-layout-column', '0');
      expect(lastCard).toHaveAttribute('data-layout-column', String(columnCount - 1));
      expect(firstCard).toHaveAttribute('data-layout-column-count', String(columnCount));
      expect(lastCard).toHaveAttribute('data-layout-column-count', String(columnCount));
      expect(firstCard).toHaveStyle({ left: '4px' });
      expect(lastCard.style.left).not.toBe(firstCard.style.left);
      expect(firstCard.style.width).toBe(lastCard.style.width);
      expect(firstCard.style.width).not.toBe('calc(100% - 8px)');

      const firstStart = screen.getByRole('button', {
        name: `Resize ${firstItem.title} from start`,
      });
      const lastEnd = screen.getByRole('button', {
        name: `Resize ${lastItem.title} from end`,
      });
      expect(firstStart.closest('[data-schedule-item]')).toBe(firstCard);
      expect(lastEnd.closest('[data-schedule-item]')).toBe(lastCard);
      expect(firstStart).toHaveClass(
        'left-0',
        'max-w-full',
        'size-6',
        '[@media(pointer:coarse)]:size-11',
      );
      expect(lastEnd).toHaveClass(
        'right-0',
        'max-w-full',
        'size-6',
        '[@media(pointer:coarse)]:size-11',
      );
      expect(firstStart.querySelector('[data-schedule-resize-indicator="start"]')).toHaveClass(
        'max-w-full',
      );
      expect(lastEnd.querySelector('[data-schedule-resize-indicator="end"]')).toHaveClass(
        'max-w-full',
      );
    },
  );

  it('gives disjoint timed items the full usable lane width', () => {
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[
          lane('disjoint', 'Disjoint', [
            timedItem('early', 'Early', '09:00', '09:30'),
            timedItem('late', 'Late', '10:00', '10:30'),
          ]),
        ]}
        pixelsPerHour={60}
        viewportWidth={500}
      />,
    );

    for (const id of ['early', 'late']) {
      expect(renderedItem(id)).toHaveAttribute('data-layout-column', '0');
      expect(renderedItem(id)).toHaveAttribute('data-layout-column-count', '1');
      expect(renderedItem(id)).toHaveStyle({ left: '4px', width: 'calc(100% - 8px)' });
    }
  });

  it('keeps horizontal styles and chronological button order stable after input reversal', () => {
    const items = [
      timedItem('later', 'Later', '10:30', '11:00'),
      timedItem('short', 'Short', '09:00', '09:30'),
      timedItem('long', 'Long', '09:00', '10:00'),
    ];
    const { rerender } = render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[lane('stable', 'Stable', items)]}
        pixelsPerHour={60}
        viewportWidth={500}
      />,
    );
    const initialStyles = new Map(items.map((item) => [item.id, horizontalStyle(item.id)]));
    expect(timedItemOrder()).toEqual(['long', 'short', 'later']);

    rerender(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[lane('stable', 'Stable', [...items].reverse())]}
        pixelsPerHour={60}
        viewportWidth={500}
      />,
    );

    expect(timedItemOrder()).toEqual(['long', 'short', 'later']);
    expect(new Map(items.map((item) => [item.id, horizontalStyle(item.id)]))).toEqual(
      initialStyles,
    );
  });

  it('isolates collisions inside each arbitrary resource lane', () => {
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[
          lane('empty', 'Empty'),
          lane('busy', 'Busy', [
            timedItem('busy-a', 'Busy A', '09:00', '10:00'),
            timedItem('busy-b', 'Busy B', '09:15', '09:45'),
          ]),
          lane('solo', 'Solo', [timedItem('solo-a', 'Solo A', '09:15', '09:45')]),
          lane('also-empty', 'Also empty'),
        ]}
        pixelsPerHour={60}
        viewportWidth={1_000}
      />,
    );

    expect(renderedItem('busy-a')).toHaveAttribute('data-layout-column-count', '2');
    expect(renderedItem('busy-b')).toHaveAttribute('data-layout-column-count', '2');
    expect(renderedItem('solo-a')).toHaveAttribute('data-layout-column-count', '1');
    expect(renderedItem('solo-a')).toHaveStyle({ width: 'calc(100% - 8px)' });
  });

  it('uses the 18px minimum height for low-zoom collisions without inflating high zoom', () => {
    const items = [
      timedItem('short-a', 'Short A', '09:00', '09:05'),
      timedItem('short-b', 'Short B', '09:10', '09:15'),
    ];
    const { rerender } = render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[lane('zoom', 'Zoom', items)]}
        pixelsPerHour={60}
        viewportWidth={500}
      />,
    );

    expect(renderedItem('short-a')).toHaveStyle({ height: '18px' });
    expect(renderedItem('short-a')).toHaveAttribute('data-layout-column-count', '2');
    expect(renderedItem('short-b')).toHaveAttribute('data-layout-column-count', '2');

    rerender(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[lane('zoom', 'Zoom', [...items].reverse())]}
        pixelsPerHour={240}
        viewportWidth={500}
      />,
    );
    expect(renderedItem('short-a')).toHaveStyle({ height: '20px' });
    expect(renderedItem('short-a')).toHaveAttribute('data-layout-column-count', '1');
    expect(renderedItem('short-b')).toHaveAttribute('data-layout-column-count', '1');
  });

  it('supports canonical sequential keyboard and pointer activation for identical-time items', async () => {
    const user = userEvent.setup();
    const onOpenItem = vi.fn();
    const items = [
      timedItem('open-c', 'Open C', '09:00', '10:00'),
      timedItem('open-a', 'Open A', '09:00', '10:00'),
      timedItem('open-b', 'Open B', '09:00', '10:00'),
    ];
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[lane('open', 'Open', items)]}
        pixelsPerHour={60}
        viewportWidth={500}
        onOpenItem={onOpenItem}
      />,
    );

    const buttons = screen.getAllByRole('button', { name: /^Open [ABC]/ });
    expect(buttons).toHaveLength(3);
    expect(timedItemOrder()).toEqual(['open-a', 'open-b', 'open-c']);

    await user.tab();
    expect(buttons[0]).toHaveFocus();
    await user.keyboard('{Enter}');
    await user.tab();
    expect(buttons[1]).toHaveFocus();
    await user.keyboard('[Space]');
    await user.tab();
    expect(buttons[2]).toHaveFocus();
    await user.click(buttons[2]!);

    expect(onOpenItem).toHaveBeenCalledTimes(3);
    expect(onOpenItem.mock.calls.map(([request]) => request.item.id)).toEqual([
      'open-a',
      'open-b',
      'open-c',
    ]);
  });

  it('keeps editable controls explicitly named for every identical-time item', () => {
    const items = [
      timedItem('edit-c', 'Edit C', '09:00', '10:00'),
      timedItem('edit-a', 'Edit A', '09:00', '10:00'),
      timedItem('edit-b', 'Edit B', '09:00', '10:00'),
    ];
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[lane('edit', 'Edit', items)]}
        pixelsPerHour={60}
        viewportWidth={500}
        onMoveItem={vi.fn()}
        onResizeItem={vi.fn()}
      />,
    );

    for (const item of items) {
      expect(screen.getByRole('button', { name: `Move ${item.title}` })).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: `Resize ${item.title} from start` }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: `Resize ${item.title} from end` }),
      ).toBeInTheDocument();
    }
  });

  it('gives timed move and relationship controls visible interaction states', () => {
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[
          lane('edit', 'Edit', [
            {
              ...TIMED_ITEM,
              dragObject: { kind: 'calendar_item', itemId: TIMED_ITEM.id, title: TIMED_ITEM.title },
            },
          ]),
        ]}
        pixelsPerHour={60}
        viewportWidth={500}
        onMoveItem={vi.fn()}
      />,
    );

    for (const control of [
      screen.getByRole('button', { name: 'Move Focus block' }),
      screen.getByRole('button', { name: 'Drag Focus block to create a relationship' }),
    ]) {
      expect(control).toHaveClass(
        'hover:bg-surface-container-high',
        'active:bg-surface-container-highest',
        'transition-colors',
        'motion-reduce:transition-none',
      );
    }
  });

  it('uses marker, compact, and full treatments while showing locale time at full height', () => {
    const renderItem = vi.fn(({ item }: { readonly item: ScheduleItem }) => `Custom ${item.title}`);
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[
          lane('density', 'Density', [
            timedItem('marker', 'Marker', '09:00', '09:05'),
            timedItem('compact', 'Compact', '10:00', '10:30'),
            timedItem('full', 'Full', '11:00', '12:00'),
          ]),
        ]}
        pixelsPerHour={72}
        viewportWidth={500}
        renderItem={renderItem}
      />,
    );

    expect(renderedItem('marker')).toHaveAttribute('data-item-density', 'marker');
    expect(renderedItem('compact')).toHaveAttribute('data-item-density', 'compact');
    expect(renderedItem('full')).toHaveAttribute('data-item-density', 'full');
    expect(screen.getByRole('button', { name: /^Marker.*9:00.*9:05/ })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /^Custom Compact.*10:00.*10:30/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Custom Full.*11:00.*12:00/ })).toBeInTheDocument();
    expect(renderedItem('full')).toHaveTextContent(/11:00.*12:00/);
    expect(renderedItem('full').getAttribute('style')).toContain('color-mix');
    expect(renderItem).toHaveBeenCalledTimes(3);
  });

  it('distinguishes overlapping items with duplicate titles by their accessible time range', () => {
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[
          lane('duplicate', 'Duplicate', [
            timedItem('duplicate-later', 'Duplicate', '09:30', '10:30'),
            timedItem('duplicate-earlier', 'Duplicate', '09:00', '10:00'),
          ]),
        ]}
        pixelsPerHour={60}
        viewportWidth={500}
      />,
    );

    const buttons = screen.getAllByRole('button', { name: /Duplicate/ });
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveAccessibleName(/Duplicate.*9:00.*10:00/);
    expect(buttons[1]).toHaveAccessibleName(/Duplicate.*9:30.*10:30/);
  });

  it('elevates on hover without translating exact time or collision geometry', () => {
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[lane('hover', 'Hover', [TIMED_ITEM])]}
        pixelsPerHour={60}
        viewportWidth={500}
      />,
    );

    expect(renderedItem('focus')).toHaveClass(
      'hover:z-20',
      'hover:shadow-md',
      'motion-reduce:transition-none',
    );
    expect(renderedItem('focus')).not.toHaveClass('motion-safe:hover:-translate-y-px');
  });

  it('keeps the grid mounted when the deterministic clock is absent or invalid', () => {
    const { rerender } = render(
      <SchedulingCanvas displayTimezone="UTC" lanes={[]} pixelsPerHour={24} viewportWidth={500} />,
    );
    expect(document.querySelectorAll('[data-schedule-tick]')).toHaveLength(49);
    expect(document.querySelector('[data-current-time-line]')).not.toBeInTheDocument();

    rerender(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[]}
        now="not-an-instant"
        pixelsPerHour={24}
        viewportWidth={500}
      />,
    );
    expect(document.querySelectorAll('[data-schedule-tick]')).toHaveLength(49);
    expect(document.querySelector('[data-current-time-line]')).not.toBeInTheDocument();
  });
});
