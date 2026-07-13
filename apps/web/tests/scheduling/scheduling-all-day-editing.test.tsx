import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SchedulingCanvas, type ScheduleItem, type ScheduleLane } from '@/components/scheduling';

const OFFSITE: ScheduleItem = {
  id: 'offsite',
  title: 'Team offsite',
  startsAt: '2026-07-01T00:00:00.000Z',
  endsAt: '2026-07-04T00:00:00.000Z',
  allDay: true,
  editable: true,
  dragObject: {
    kind: 'calendar_item',
    itemId: 'offsite',
    title: 'Team offsite',
  },
};

function dateLane(date: string, options?: { readonly editable?: boolean }): ScheduleLane {
  const overlaps = date >= '2026-07-01' && date < '2026-07-04';
  return {
    id: `date:${date}`,
    label: date,
    date,
    editable: options?.editable,
    items: overlaps ? [OFFSITE] : [],
  };
}

const LANES: readonly ScheduleLane[] = [
  dateLane('2026-07-01'),
  dateLane('2026-07-02'),
  dateLane('2026-07-03'),
  dateLane('2026-07-04'),
];

function allDayLane(lane: ScheduleLane): HTMLElement {
  const element = document.querySelector(`[data-schedule-all-day-lane="${lane.id}"]`);
  if (!(element instanceof HTMLElement)) throw new Error(`Missing all-day lane ${lane.id}`);
  return element;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SchedulingCanvas all-day direct manipulation', () => {
  it('places move and resize controls only on the segments that own the true edges', () => {
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={LANES}
        pixelsPerHour={60}
        viewportWidth={1_000}
        onMoveAllDayItem={vi.fn()}
        onResizeAllDayItem={vi.fn()}
      />,
    );

    expect(
      within(allDayLane(LANES[0]!)).getByRole('button', { name: 'Move Team offsite' }),
    ).toHaveClass('touch-none');
    expect(
      within(allDayLane(LANES[0]!)).getByRole('button', {
        name: 'Resize Team offsite from start',
      }),
    ).toBeInTheDocument();
    expect(
      within(allDayLane(LANES[0]!)).queryByRole('button', {
        name: 'Resize Team offsite from end',
      }),
    ).not.toBeInTheDocument();

    expect(
      within(allDayLane(LANES[1]!)).queryByRole('button', { name: 'Move Team offsite' }),
    ).not.toBeInTheDocument();
    expect(
      within(allDayLane(LANES[1]!)).queryByRole('button', { name: /Resize Team offsite/ }),
    ).not.toBeInTheDocument();

    expect(
      within(allDayLane(LANES[2]!)).getByRole('button', {
        name: 'Resize Team offsite from end',
      }),
    ).toBeInTheDocument();
    expect(
      within(allDayLane(LANES[2]!))
        .getByRole('button', {
          name: 'Drag Team offsite to create a relationship',
        })
        .closest('[data-schedule-all-day-item]'),
    ).toHaveClass('pr-3', '[@media(pointer:coarse)]:pr-10');
    expect(
      within(allDayLane(LANES[2]!)).queryByRole('button', { name: 'Move Team offsite' }),
    ).not.toBeInTheDocument();
  });

  it('moves a range by keyboard across a read-only lane while preserving its day count', () => {
    const onMoveAllDayItem = vi.fn();
    const lanes = [
      LANES[0]!,
      dateLane('2026-07-02', { editable: false }),
      LANES[2]!,
      LANES[3]!,
    ] as const;
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={lanes}
        pixelsPerHour={60}
        viewportWidth={1_000}
        onMoveAllDayItem={onMoveAllDayItem}
      />,
    );

    fireEvent.keyDown(screen.getByRole('button', { name: 'Move Team offsite' }), {
      key: 'ArrowRight',
    });

    expect(onMoveAllDayItem).toHaveBeenCalledWith({
      item: OFFSITE,
      fromLane: lanes[0],
      toLane: lanes[2],
      startDate: '2026-07-03',
      endDate: '2026-07-06',
    });
    expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent(
      'Moving Team offsite to 2026-07-03, Jul 3 – Jul 5.',
    );
  });

  it('resizes either true edge by keyboard and keeps the range end exclusive', () => {
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

    fireEvent.keyDown(screen.getByRole('button', { name: 'Resize Team offsite from start' }), {
      key: 'ArrowRight',
    });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Resize Team offsite from end' }), {
      key: 'ArrowRight',
    });

    expect(onResizeAllDayItem).toHaveBeenNthCalledWith(1, {
      item: OFFSITE,
      fromLane: LANES[0],
      toLane: LANES[1],
      edge: 'start',
      startDate: '2026-07-02',
      endDate: '2026-07-04',
    });
    expect(onResizeAllDayItem).toHaveBeenNthCalledWith(2, {
      item: OFFSITE,
      fromLane: LANES[2],
      toLane: LANES[3],
      edge: 'end',
      startDate: '2026-07-01',
      endDate: '2026-07-05',
    });
  });

  it('keeps read-only all-day items openable without edit affordances', async () => {
    const user = userEvent.setup();
    const onOpenItem = vi.fn();
    const readOnlyItem: ScheduleItem = {
      ...OFFSITE,
      editable: false,
      readOnlyLabel: 'Read-only',
    };
    const lane: ScheduleLane = {
      ...LANES[0]!,
      items: [readOnlyItem],
    };
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[lane]}
        pixelsPerHour={60}
        viewportWidth={500}
        onOpenItem={onOpenItem}
        onMoveAllDayItem={vi.fn()}
        onResizeAllDayItem={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Move Team offsite' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Resize Team offsite/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Team offsite' }));
    expect(onOpenItem).toHaveBeenCalledWith({ item: readOnlyItem, lane });
  });

  it('does not expose false controls for malformed all-day bounds', () => {
    const malformed: ScheduleItem = {
      ...OFFSITE,
      startsAt: '2026-07-01T09:00:00.000Z',
    };
    const lane: ScheduleLane = { ...LANES[0]!, items: [malformed] };
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[lane]}
        pixelsPerHour={60}
        viewportWidth={500}
        onMoveAllDayItem={vi.fn()}
        onResizeAllDayItem={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Move Team offsite' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Resize Team offsite/ })).not.toBeInTheDocument();
  });

  it('preserves keyboard relationship targeting on an editable all-day item', async () => {
    const user = userEvent.setup();
    const onDropObjectOnItem = vi.fn();
    const target: ScheduleItem = {
      id: 'launch',
      title: 'Launch day',
      startsAt: '2026-07-01T00:00:00.000Z',
      endsAt: '2026-07-02T00:00:00.000Z',
      allDay: true,
      dropTarget: true,
    };
    const lane: ScheduleLane = { ...LANES[0]!, items: [OFFSITE, target] };
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[lane]}
        pixelsPerHour={60}
        viewportWidth={500}
        onMoveAllDayItem={vi.fn()}
        onDropObjectOnItem={onDropObjectOnItem}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Create relationship from Team offsite' }));
    await user.click(screen.getByRole('button', { name: 'Link Team offsite to Launch day' }));

    expect(onDropObjectOnItem).toHaveBeenCalledWith({
      object: OFFSITE.dragObject,
      targetItem: target,
      targetLane: lane,
    });
  });
});
