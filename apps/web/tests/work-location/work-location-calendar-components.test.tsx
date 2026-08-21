import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkLocationAssertionId, WorkPlaceId } from '@docket/types';

import type {
  ScheduleAllDayLaneRenderContext,
  ScheduleItem,
  ScheduleLane,
  ScheduleTimedItemDecorationContext,
  ScheduleTimedLaneContextRenderContext,
} from '@/components/scheduling';
import {
  WorkLocationAllDayContext,
  WorkLocationTimeboxDecoration,
  WorkLocationTimedLaneContext,
} from '@/components/work-location/work-location-calendar-components';
import { WorkLocationStatusControl } from '@/components/work-location/use-work-location-calendar-composition';
import type { WorkLocationCalendarRegion } from '@/components/work-location/work-location-calendar-model';

const assertionId = WorkLocationAssertionId.parse('01BX5ZZKBKACTAV9WEVGEMMVRZ');
const placeId = WorkPlaceId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV');

function region(overrides: Partial<WorkLocationCalendarRegion> = {}): WorkLocationCalendarRegion {
  return {
    id: 'location',
    placeId,
    label: 'Main library',
    startsAt: '2026-07-01T09:00:00.000Z',
    endsAt: '2026-07-01T12:00:00.000Z',
    allDay: false,
    source: 'assertion',
    editable: true,
    assertionId,
    occurrenceDate: '2026-07-01',
    assertionKind: 'one_off',
    ...overrides,
  };
}

const firstLane: ScheduleLane = { id: 'first', label: 'July 1', date: '2026-07-01', items: [] };
const secondLane: ScheduleLane = { id: 'second', label: 'July 2', date: '2026-07-02', items: [] };

function timedContext(lane = firstLane, laneIndex = 0): ScheduleTimedLaneContextRenderContext {
  return {
    lane,
    lanes: [firstLane, secondLane],
    snapMinutes: 15,
    geometry: { laneIndex, laneWidth: 200, laneHeight: 1_440, pixelsPerHour: 60 },
  };
}

afterEach(cleanup);

describe('work-location calendar components', () => {
  it('uses one compact status control for deduplicated provider notices', () => {
    render(
      <WorkLocationStatusControl
        warnings={[
          { id: 'one', label: 'willie@example.com', message: 'Location sync needs attention.' },
          { id: 'two', label: 'studio@example.com', message: 'Location sync is retrying.' },
        ]}
      />,
    );

    const status = screen.getByRole('button', { name: 'Work-location status, 2 notices' });
    expect(status).toHaveClass('min-h-7', '[@media(pointer:coarse)]:min-h-11');
    expect(screen.queryByText('willie@example.com')).not.toBeInTheDocument();
    fireEvent.click(status);
    expect(screen.getByText('willie@example.com')).toBeInTheDocument();
    expect(screen.getByText('studio@example.com')).toBeInTheDocument();
  });

  it('renders a compact interactive all-day chip with a 44px coarse target', () => {
    const onOpen = vi.fn();
    render(
      <WorkLocationAllDayContext
        regions={[
          region({
            allDay: true,
            startsAt: '2026-07-01T00:00:00.000Z',
            endsAt: '2026-07-02T00:00:00.000Z',
          }),
        ]}
        context={
          {
            lane: firstLane,
            geometry: { laneIndex: 0, laneWidth: 200 },
          } satisfies ScheduleAllDayLaneRenderContext
        }
        displayTimezone="UTC"
        onOpen={onOpen}
        onMove={vi.fn()}
      />,
    );

    const chip = screen.getByRole('button', { name: 'Main library work location' });
    expect(chip).toHaveClass('min-h-7', '[@media(pointer:coarse)]:min-h-11');
    expect(chip).toHaveClass('focus-visible:outline-primary');
    chip.focus();
    expect(chip).toHaveFocus();
    fireEvent.click(chip);
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'location' }));
  });

  it('keeps inferred all-day and timed regions visible without move or resize controls', () => {
    const readOnly = region({
      editable: false,
      assertionId: null,
      occurrenceDate: null,
      assertionKind: null,
      source: 'bridged_work_blocks',
    });
    const { rerender } = render(
      <WorkLocationAllDayContext
        regions={[
          {
            ...readOnly,
            allDay: true,
            startsAt: '2026-07-01T00:00:00.000Z',
            endsAt: '2026-07-02T00:00:00.000Z',
          },
        ]}
        context={{ lane: firstLane, geometry: { laneIndex: 0, laneWidth: 200 } }}
        displayTimezone="UTC"
        onOpen={vi.fn()}
        onMove={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(
      screen.getByText('Main library').closest('[data-work-location-read-only]'),
    ).toHaveAttribute('data-work-location-read-only', 'true');

    rerender(
      <WorkLocationTimedLaneContext
        regions={[readOnly]}
        context={timedContext()}
        displayTimezone="UTC"
        onOpen={vi.fn()}
        onEdit={vi.fn()}
      />,
    );
    expect(screen.getByTestId('work-location-rail')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders a 2px rail with coarse move and resize targets and commits cross-lane gestures', () => {
    const onEdit = vi.fn();
    render(
      <WorkLocationTimedLaneContext
        regions={[region()]}
        context={timedContext()}
        displayTimezone="UTC"
        onOpen={vi.fn()}
        onEdit={onEdit}
      />,
    );

    expect(screen.getByTestId('work-location-rail')).toHaveClass('w-0.5');
    const move = screen.getByRole('button', { name: 'Move Main library work location' });
    const resizeStart = screen.getByRole('button', { name: 'Resize start of Main library' });
    const resizeEnd = screen.getByRole('button', { name: 'Resize end of Main library' });
    for (const control of [move, resizeStart, resizeEnd]) {
      expect(control).toHaveClass('[@media(pointer:coarse)]:min-h-11');
      expect(control).toHaveClass('[@media(pointer:coarse)]:min-w-11');
    }

    fireEvent.pointerDown(move, { button: 0, pointerId: 7, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { pointerId: 7, clientX: 300, clientY: 130 });
    fireEvent.pointerUp(window, { pointerId: 7, clientX: 300, clientY: 130 });
    expect(onEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        targetDate: '2026-07-02',
        startMinutes: 570,
        endMinutes: 750,
      }),
    );

    fireEvent.pointerDown(resizeStart, {
      button: 0,
      pointerId: 8,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(window, { pointerId: 8, clientX: 100, clientY: 130 });
    fireEvent.pointerUp(window, { pointerId: 8, clientX: 100, clientY: 130 });
    expect(onEdit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        targetDate: '2026-07-01',
        startMinutes: 570,
        endMinutes: 720,
      }),
    );

    fireEvent.pointerDown(resizeEnd, {
      button: 0,
      pointerId: 9,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(window, { pointerId: 9, clientX: 100, clientY: 130 });
    fireEvent.pointerUp(window, { pointerId: 9, clientX: 100, clientY: 130 });
    expect(onEdit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        targetDate: '2026-07-01',
        startMinutes: 540,
        endMinutes: 750,
      }),
    );
  });

  it('moves all-day chips across visible dates without turning them into schedule items', () => {
    const onMove = vi.fn();
    render(
      <WorkLocationAllDayContext
        regions={[
          region({
            allDay: true,
            startsAt: '2026-07-01T00:00:00.000Z',
            endsAt: '2026-07-02T00:00:00.000Z',
          }),
        ]}
        context={{ lane: firstLane, geometry: { laneIndex: 0, laneWidth: 200 } }}
        displayTimezone="UTC"
        lanes={[firstLane, secondLane]}
        onOpen={vi.fn()}
        onMove={onMove}
      />,
    );

    const chip = screen.getByRole('button', { name: 'Main library work location' });
    fireEvent.pointerDown(chip, { button: 0, pointerId: 9, clientX: 100, clientY: 20 });
    fireEvent.pointerMove(window, { pointerId: 9, clientX: 300, clientY: 20 });
    fireEvent.pointerUp(window, { pointerId: 9, clientX: 300, clientY: 20 });
    expect(onMove).toHaveBeenCalledWith(expect.objectContaining({ id: 'location' }), '2026-07-02');
  });

  it('partitions one timebox decoration across location context and neutral gaps', () => {
    const item: ScheduleItem = {
      id: 'timebox',
      title: 'Write brief',
      startsAt: '2026-07-01T08:00:00.000Z',
      endsAt: '2026-07-01T13:00:00.000Z',
      appearance: 'timebox',
    };
    const context: ScheduleTimedItemDecorationContext = {
      item,
      lane: { ...firstLane, items: [item] },
      geometry: {
        laneIndex: 0,
        bounds: { startMinutes: 480, endMinutes: 780 },
        top: 480,
        height: 300,
        laneWidth: 200,
        pixelsPerHour: 60,
      },
      placement: { columnIndex: 0, columnCount: 1 },
    };
    render(
      <WorkLocationTimeboxDecoration
        regions={[region()]}
        context={context}
        displayTimezone="UTC"
      />,
    );

    expect(
      screen.getAllByTestId('work-location-timebox-section').map((node) => node.dataset['context']),
    ).toEqual(['neutral', 'location', 'neutral']);
  });
});
