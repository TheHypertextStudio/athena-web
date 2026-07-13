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

/** Read accessible button names without depending on the visual time-detail treatment. */
function buttonNames(): (string | null)[] {
  return screen
    .getAllByRole('button')
    .map((button) => button.getAttribute('aria-label') ?? button.textContent);
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
    expect(buttonNames()).toEqual(['Long', 'Short', 'Later']);

    rerender(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[lane('stable', 'Stable', [...items].reverse())]}
        pixelsPerHour={60}
        viewportWidth={500}
      />,
    );

    expect(buttonNames()).toEqual(['Long', 'Short', 'Later']);
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

  it('keeps every identical-time item focusable, openable, and explicitly editable', () => {
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
        onMoveItem={vi.fn()}
        onResizeItem={vi.fn()}
      />,
    );

    for (const item of items) {
      const button = screen.getByRole('button', { name: item.title });
      button.focus();
      expect(button).toHaveFocus();
      fireEvent.click(button);
      expect(screen.getByRole('button', { name: `Move ${item.title}` })).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: `Resize ${item.title} from start` }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: `Resize ${item.title} from end` }),
      ).toBeInTheDocument();
    }
    expect(onOpenItem).toHaveBeenCalledTimes(3);
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
    expect(renderedItem('full')).toHaveTextContent(/11:00.*12:00/);
    expect(renderedItem('full').getAttribute('style')).toContain('color-mix');
    expect(renderItem).toHaveBeenCalledTimes(3);
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
