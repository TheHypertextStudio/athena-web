import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

afterEach(() => {
  cleanup();
});

describe('SchedulingCanvas', () => {
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

  it('emits consumer-owned open, cross-lane move, and end-resize callbacks', () => {
    const onOpenItem = vi.fn();
    const onMoveItem = vi.fn();
    const onResizeItem = vi.fn();
    const displayTimezone = 'UTC';
    const initialStart = scheduleWallPositionForInstant(TIMED_ITEM.startsAt, displayTimezone);
    const initialEnd = scheduleWallPositionForInstant(TIMED_ITEM.endsAt, displayTimezone);
    render(
      <SchedulingCanvas
        displayTimezone={displayTimezone}
        lanes={[lane('ada', 'Ada', [TIMED_ITEM]), lane('grace', 'Grace')]}
        pixelsPerHour={60}
        viewportWidth={800}
        onOpenItem={onOpenItem}
        onMoveItem={onMoveItem}
        onResizeItem={onResizeItem}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Focus block' }));
    expect(onOpenItem).toHaveBeenCalledWith(
      expect.objectContaining({ item: TIMED_ITEM, lane: expect.objectContaining({ id: 'ada' }) }),
    );

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Move Focus block' }), {
      clientX: 20,
      clientY: 100,
    });
    fireEvent.pointerUp(window, { clientX: 500, clientY: 130 });
    expect(onMoveItem).toHaveBeenCalledWith(
      expect.objectContaining({
        item: TIMED_ITEM,
        fromLane: expect.objectContaining({ id: 'ada' }),
        toLane: expect.objectContaining({ id: 'grace' }),
        startMinutes: (initialStart?.wallMinutes ?? Number.NaN) + 30,
        endMinutes: (initialEnd?.wallMinutes ?? Number.NaN) + 30,
      }),
    );

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Resize Focus block from end' }), {
      clientY: 100,
    });
    fireEvent.pointerUp(window, { clientY: 130 });
    expect(onResizeItem).toHaveBeenCalledWith(
      expect.objectContaining({
        item: TIMED_ITEM,
        lane: expect.objectContaining({ id: 'ada' }),
        edge: 'end',
        startMinutes: initialStart?.wallMinutes,
        endMinutes: (initialEnd?.wallMinutes ?? Number.NaN) + 30,
      }),
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
    fireEvent.click(screen.getByRole('button', { name: 'Focus block' }));
    expect(onOpenItem).toHaveBeenCalledOnce();
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

    fireEvent.dragOver(screen.getByRole('button', { name: 'Focus block' }), {
      dataTransfer: transfer,
    });
    fireEvent.drop(screen.getByRole('button', { name: 'Focus block' }), {
      dataTransfer: transfer,
    });

    expect(onDropObjectOnItem).toHaveBeenCalledWith({
      object: payload,
      targetItem: target,
      targetLane: expect.objectContaining({ id: 'ada' }),
    });
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
