import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkLocationAssertionId, WorkPlaceId } from '@docket/types';
import { assertDefined } from '@docket/test-utils';

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
import {
  SCHEDULE_TEST_THEMES,
  scheduleSurfaceContrast,
} from '../scheduling/scheduling-surface-contrast-test-utils';

const assertionId = WorkLocationAssertionId.parse('01BX5ZZKBKACTAV9WEVGEMMVRZ');
const placeId = WorkPlaceId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV');

function region(overrides: Partial<WorkLocationCalendarRegion> = {}): WorkLocationCalendarRegion {
  const startsAt = overrides.startsAt ?? '2026-07-01T09:00:00.000Z';
  const endsAt = overrides.endsAt ?? '2026-07-01T12:00:00.000Z';
  return {
    id: 'location',
    placeId,
    label: 'Main library',
    startsAt,
    endsAt,
    sourceStartsAt: overrides.sourceStartsAt ?? startsAt,
    sourceEndsAt: overrides.sourceEndsAt ?? endsAt,
    allDay: false,
    source: 'assertion',
    editable: true,
    assertionId,
    occurrenceDate: '2026-07-01',
    assertionKind: 'one_off',
    ownsStart: true,
    ownsEnd: true,
    ...overrides,
  };
}

const firstLane: ScheduleLane = { id: 'first', label: 'July 1', date: '2026-07-01', items: [] };
const secondLane: ScheduleLane = { id: 'second', label: 'July 2', date: '2026-07-02', items: [] };

function timedContext(
  lane = firstLane,
  laneIndex = 0,
  onAnnouncementChange = vi.fn(),
  laneWidth = 200,
): ScheduleTimedLaneContextRenderContext {
  return {
    lane,
    lanes: [firstLane, secondLane],
    snapMinutes: 15,
    onAnnouncementChange,
    geometry: { laneIndex, laneWidth, laneHeight: 1_440, pixelsPerHour: 60 },
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

  it('renders a compact interactive all-day chip inside a 44px target for every pointer', () => {
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
            onAnnouncementChange: vi.fn(),
          } satisfies ScheduleAllDayLaneRenderContext
        }
        displayTimezone="UTC"
        onOpen={onOpen}
        onMove={vi.fn()}
      />,
    );

    const chip = screen.getByRole('button', { name: 'Main library work location' });
    expect(chip).toHaveClass('min-h-11', 'min-w-11');
    expect(chip.querySelector('[data-work-location-chip-visual]')).toHaveClass('min-h-7');
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
        context={{
          lane: firstLane,
          geometry: { laneIndex: 0, laneWidth: 200 },
          onAnnouncementChange: vi.fn(),
        }}
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

  it('renders a 2px rail with 44px move and resize targets and commits cross-lane gestures', () => {
    const onEdit = vi.fn(() => ({ status: 'accepted' as const }));
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
      expect(control).toHaveClass('min-h-11');
      expect(control).toHaveClass('min-w-11');
    }
    expect(screen.getByTestId('work-location-rail')).not.toHaveClass('w-11');

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

  it('renders a rail preview and treats sub-snap pointer jitter as an ordinary click', () => {
    const onEdit = vi.fn(() => ({ status: 'accepted' as const }));
    const onOpen = vi.fn();
    render(
      <WorkLocationTimedLaneContext
        regions={[region()]}
        context={timedContext()}
        displayTimezone="UTC"
        onOpen={onOpen}
        onEdit={onEdit}
      />,
    );

    const move = screen.getByRole('button', { name: 'Move Main library work location' });
    fireEvent.pointerDown(move, { button: 0, pointerId: 71, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { pointerId: 71, clientX: 300, clientY: 130 });
    expect(screen.getByTestId('work-location-rail-preview')).toHaveStyle({
      top: '570px',
      height: '180px',
      transform: 'translateX(200px)',
    });
    fireEvent.pointerCancel(window, { pointerId: 71 });
    expect(screen.queryByTestId('work-location-rail-preview')).not.toBeInTheDocument();

    fireEvent.pointerDown(move, { button: 0, pointerId: 72, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { pointerId: 72, clientX: 103, clientY: 102 });
    fireEvent.pointerUp(window, { pointerId: 72, clientX: 103, clientY: 102 });
    fireEvent.click(move);

    expect(onEdit).not.toHaveBeenCalled();
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('uses the timed pointer release position when a drag returns to its origin', () => {
    const onEdit = vi.fn(() => ({ status: 'accepted' as const }));
    const onOpen = vi.fn();
    render(
      <WorkLocationTimedLaneContext
        regions={[region()]}
        context={timedContext()}
        displayTimezone="UTC"
        onOpen={onOpen}
        onEdit={onEdit}
      />,
    );

    const move = screen.getByRole('button', { name: 'Move Main library work location' });
    fireEvent.pointerDown(move, { button: 0, pointerId: 75, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { pointerId: 75, clientX: 300, clientY: 130 });
    fireEvent.pointerUp(window, { pointerId: 75, clientX: 100, clientY: 100 });
    fireEvent.click(move);

    expect(onEdit).not.toHaveBeenCalled();
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('does not announce completion when the exact edit rejects a repeated wall time', () => {
    const onAnnouncementChange = vi.fn();
    const onEdit = vi.fn(() => ({
      status: 'rejected' as const,
      announcement: 'That work-location time is unavailable.',
    }));
    render(
      <WorkLocationTimedLaneContext
        regions={[region()]}
        context={timedContext(firstLane, 0, onAnnouncementChange)}
        displayTimezone="UTC"
        onOpen={vi.fn()}
        onEdit={onEdit}
      />,
    );

    fireEvent.keyDown(screen.getByRole('button', { name: 'Move Main library work location' }), {
      key: 'ArrowDown',
    });

    expect(onEdit).toHaveBeenCalledOnce();
    expect(onAnnouncementChange).toHaveBeenLastCalledWith(
      'That work-location time is unavailable.',
    );
    expect(onAnnouncementChange).not.toHaveBeenCalledWith(
      expect.stringMatching(/^Moved Main library/),
    );
  });

  it.each([
    ['Calendar', 240],
    ['Agenda', 180],
  ] as const)(
    'keeps adjacent short-region targets inside a %s lane without accumulated offsets',
    (_surface, laneWidth) => {
      const onEdit = vi.fn(() => ({ status: 'accepted' as const }));
      render(
        <WorkLocationTimedLaneContext
          regions={[
            region({ id: 'first-short', endsAt: '2026-07-01T09:15:00.000Z' }),
            region({
              id: 'second-short',
              startsAt: '2026-07-01T09:15:00.000Z',
              endsAt: '2026-07-01T09:30:00.000Z',
            }),
          ]}
          context={timedContext(firstLane, 0, vi.fn(), laneWidth)}
          displayTimezone="UTC"
          onOpen={vi.fn()}
          onEdit={onEdit}
        />,
      );

      const moves = screen.getAllByRole('button', { name: /Move Main library work location/ });
      const starts = screen.getAllByRole('button', { name: /Resize start of Main library/ });
      const ends = screen.getAllByRole('button', { name: /Resize end of Main library/ });
      expect(moves).toHaveLength(2);
      expect(starts).toHaveLength(2);
      expect(ends).toHaveLength(2);
      for (const move of moves) {
        expect(move).toHaveStyle({ left: '44px', width: `${String(laneWidth - 88)}px` });
        expect(move).toHaveClass('min-h-11', 'min-w-11');
        expect(move).toHaveTextContent('Main library');
      }
      for (const start of starts) {
        expect(start).toHaveStyle({ left: '0px', width: '44px', height: '44px' });
      }
      for (const end of ends) {
        expect(end).toHaveStyle({
          left: `${String(laneWidth - 44)}px`,
          width: '44px',
          height: '44px',
        });
      }
      expect(starts[0]).toHaveStyle({ top: '-22px' });
      expect(ends[0]).toHaveStyle({ top: '-7px' });
      expect(starts[1]).toHaveStyle({ top: '-22px' });
      expect(ends[1]).toHaveStyle({ top: '-7px' });

      fireEvent.pointerDown(assertDefined(moves[0]), {
        button: 0,
        pointerId: 76,
        clientX: 80,
        clientY: 555,
      });
      fireEvent.pointerMove(window, { pointerId: 76, clientX: 80, clientY: 570 });
      fireEvent.pointerUp(window, { pointerId: 76, clientX: 80, clientY: 570 });
      expect(onEdit).toHaveBeenCalledWith(
        expect.objectContaining({
          region: expect.objectContaining({ id: 'second-short' }),
          mode: 'move',
        }),
      );

      fireEvent.pointerDown(assertDefined(starts[0]), {
        button: 0,
        pointerId: 78,
        clientX: 10,
        clientY: 555,
      });
      fireEvent.pointerMove(window, { pointerId: 78, clientX: 10, clientY: 540 });
      fireEvent.pointerUp(window, { pointerId: 78, clientX: 10, clientY: 540 });
      expect(onEdit).toHaveBeenLastCalledWith(
        expect.objectContaining({
          region: expect.objectContaining({ id: 'second-short' }),
          mode: 'resize-start',
        }),
      );

      fireEvent.pointerDown(assertDefined(ends[1]), {
        button: 0,
        pointerId: 79,
        clientX: laneWidth - 10,
        clientY: 555,
      });
      fireEvent.pointerMove(window, { pointerId: 79, clientX: laneWidth - 10, clientY: 570 });
      fireEvent.pointerUp(window, { pointerId: 79, clientX: laneWidth - 10, clientY: 570 });
      expect(onEdit).toHaveBeenLastCalledWith(
        expect.objectContaining({
          region: expect.objectContaining({ id: 'first-short' }),
          mode: 'resize-end',
        }),
      );
    },
  );

  it('routes resize handles only to lane fragments that own the true source endpoint', () => {
    const source = {
      ...region(),
      startsAt: '2026-08-12T23:00:00.000Z',
      endsAt: '2026-08-14T01:00:00.000Z',
      sourceStartsAt: '2026-08-12T23:00:00.000Z',
      sourceEndsAt: '2026-08-14T01:00:00.000Z',
      ownsStart: true,
      ownsEnd: true,
    };
    const lanes: readonly ScheduleLane[] = [
      { id: 'aug-12', label: 'August 12', date: '2026-08-12', items: [] },
      { id: 'aug-13', label: 'August 13', date: '2026-08-13', items: [] },
      { id: 'aug-14', label: 'August 14', date: '2026-08-14', items: [] },
    ];
    const context = (laneIndex: number): ScheduleTimedLaneContextRenderContext => ({
      lane: assertDefined(lanes[laneIndex]),
      lanes,
      snapMinutes: 15,
      onAnnouncementChange: vi.fn(),
      geometry: { laneIndex, laneWidth: 180, laneHeight: 1_440, pixelsPerHour: 60 },
    });
    const onEdit = vi.fn(() => ({ status: 'accepted' as const }));
    const { rerender } = render(
      <WorkLocationTimedLaneContext
        regions={[source]}
        context={context(0)}
        displayTimezone="UTC"
        onOpen={vi.fn()}
        onEdit={onEdit}
      />,
    );
    expect(screen.getByRole('button', { name: 'Resize start of Main library' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Resize end of Main library' })).toBeNull();
    const start = screen.getByRole('button', { name: 'Resize start of Main library' });
    fireEvent.pointerDown(start, { button: 0, pointerId: 80, clientX: 10, clientY: 1_380 });
    fireEvent.pointerMove(window, { pointerId: 80, clientX: 10, clientY: 1_395 });
    fireEvent.pointerUp(window, { pointerId: 80, clientX: 10, clientY: 1_395 });
    expect(onEdit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mode: 'resize-start',
        sourceDate: '2026-08-12',
        sourceStartMinutes: 1_380,
        sourceEndMinutes: 1_440,
        startMinutes: 1_395,
      }),
    );

    rerender(
      <WorkLocationTimedLaneContext
        regions={[source]}
        context={context(1)}
        displayTimezone="UTC"
        onOpen={vi.fn()}
        onEdit={onEdit}
      />,
    );
    expect(screen.queryByRole('button', { name: /Resize/ })).toBeNull();

    rerender(
      <WorkLocationTimedLaneContext
        regions={[source]}
        context={context(2)}
        displayTimezone="UTC"
        onOpen={vi.fn()}
        onEdit={onEdit}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Resize start of Main library' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Resize end of Main library' })).toBeVisible();
    const end = screen.getByRole('button', { name: 'Resize end of Main library' });
    fireEvent.pointerDown(end, { button: 0, pointerId: 81, clientX: 170, clientY: 60 });
    fireEvent.pointerMove(window, { pointerId: 81, clientX: 170, clientY: 45 });
    fireEvent.pointerUp(window, { pointerId: 81, clientX: 170, clientY: 45 });
    expect(onEdit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mode: 'resize-end',
        sourceDate: '2026-08-14',
        sourceStartMinutes: 0,
        sourceEndMinutes: 60,
        endMinutes: 45,
      }),
    );
  });

  it('does not expose either resize edge for a fragment clipped inside its source assertion', () => {
    render(
      <WorkLocationTimedLaneContext
        regions={[{ ...region(), ownsStart: false, ownsEnd: false }]}
        context={timedContext()}
        displayTimezone="UTC"
        onOpen={vi.fn()}
        onEdit={vi.fn(() => ({ status: 'accepted' as const }))}
      />,
    );

    expect(screen.getByRole('button', { name: 'Move Main library work location' })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Resize/ })).toBeNull();
  });

  it('moves and resizes timed locations by keyboard using the scheduling snap interval', () => {
    const onEdit = vi.fn(() => ({ status: 'accepted' as const }));
    const onAnnouncementChange = vi.fn();
    render(
      <WorkLocationTimedLaneContext
        regions={[region()]}
        context={timedContext(firstLane, 0, onAnnouncementChange)}
        displayTimezone="UTC"
        onOpen={vi.fn()}
        onEdit={onEdit}
      />,
    );

    const move = screen.getByRole('button', { name: 'Move Main library work location' });
    fireEvent.keyDown(move, { key: 'ArrowDown' });
    expect(onEdit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        targetDate: '2026-07-01',
        startMinutes: 555,
        endMinutes: 735,
      }),
    );
    expect(onAnnouncementChange).toHaveBeenLastCalledWith(
      'Moved Main library work location to July 1, 9:15 AM to 12:15 PM.',
    );
    expect(screen.queryByTestId('work-location-rail-preview')).toBeNull();

    fireEvent.keyDown(move, { key: 'ArrowRight' });
    expect(onEdit).toHaveBeenLastCalledWith(
      expect.objectContaining({ targetDate: '2026-07-02', startMinutes: 540, endMinutes: 720 }),
    );

    fireEvent.keyDown(screen.getByRole('button', { name: 'Resize start of Main library' }), {
      key: 'ArrowDown',
    });
    expect(onEdit).toHaveBeenLastCalledWith(
      expect.objectContaining({ startMinutes: 555, endMinutes: 720 }),
    );
    expect(onAnnouncementChange).toHaveBeenLastCalledWith(
      'Resized Main library work location to July 1, 9:15 AM to 12:00 PM.',
    );

    fireEvent.keyDown(screen.getByRole('button', { name: 'Resize end of Main library' }), {
      key: 'ArrowUp',
    });
    expect(onEdit).toHaveBeenLastCalledWith(
      expect.objectContaining({ startMinutes: 540, endMinutes: 705 }),
    );
  });

  it('announces timed pointer previews and completion through the shared live region', () => {
    const onAnnouncementChange = vi.fn();
    render(
      <WorkLocationTimedLaneContext
        regions={[region()]}
        context={timedContext(firstLane, 0, onAnnouncementChange)}
        displayTimezone="UTC"
        onOpen={vi.fn()}
        onEdit={vi.fn(() => ({ status: 'accepted' as const }))}
      />,
    );

    const move = screen.getByRole('button', { name: 'Move Main library work location' });
    fireEvent.pointerDown(move, { button: 0, pointerId: 17, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { pointerId: 17, clientX: 300, clientY: 130 });
    expect(onAnnouncementChange).toHaveBeenLastCalledWith(
      'Moving Main library work location to July 2, 9:30 AM to 12:30 PM.',
    );
    fireEvent.pointerUp(window, { pointerId: 17, clientX: 300, clientY: 130 });
    expect(onAnnouncementChange).toHaveBeenLastCalledWith(
      'Moved Main library work location to July 2, 9:30 AM to 12:30 PM.',
    );
    expect(screen.queryByTestId('work-location-rail-preview')).toBeNull();
  });

  it('clears an active preview when refetched regions replace its source id', async () => {
    const { rerender } = render(
      <WorkLocationTimedLaneContext
        regions={[region()]}
        context={timedContext()}
        displayTimezone="UTC"
        onOpen={vi.fn()}
        onEdit={vi.fn(() => ({ status: 'accepted' as const }))}
      />,
    );
    const move = screen.getByRole('button', { name: 'Move Main library work location' });
    fireEvent.pointerDown(move, { button: 0, pointerId: 77, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { pointerId: 77, clientX: 300, clientY: 130 });
    expect(screen.getByTestId('work-location-rail-preview')).toBeVisible();

    rerender(
      <WorkLocationTimedLaneContext
        regions={[region({ id: 'refetched-location' })]}
        context={timedContext()}
        displayTimezone="UTC"
        onOpen={vi.fn()}
        onEdit={vi.fn(() => ({ status: 'accepted' as const }))}
      />,
    );
    await waitFor(() => {
      expect(screen.queryByTestId('work-location-rail-preview')).toBeNull();
    });
    fireEvent.pointerCancel(window, { pointerId: 77 });
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
        context={{
          lane: firstLane,
          geometry: { laneIndex: 0, laneWidth: 200 },
          onAnnouncementChange: vi.fn(),
        }}
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

  it('opens an all-day chip after a clamped zero-lane gesture without mutating it', () => {
    const onMove = vi.fn();
    const onOpen = vi.fn();
    render(
      <WorkLocationAllDayContext
        regions={[
          region({
            allDay: true,
            startsAt: '2026-07-02T00:00:00.000Z',
            endsAt: '2026-07-03T00:00:00.000Z',
          }),
        ]}
        context={{
          lane: secondLane,
          geometry: { laneIndex: 1, laneWidth: 200 },
          onAnnouncementChange: vi.fn(),
        }}
        displayTimezone="UTC"
        lanes={[firstLane, secondLane]}
        onOpen={onOpen}
        onMove={onMove}
      />,
    );

    const chip = screen.getByRole('button', { name: 'Main library work location' });
    fireEvent.pointerDown(chip, { button: 0, pointerId: 73, clientX: 300, clientY: 20 });
    fireEvent.pointerMove(window, { pointerId: 73, clientX: 500, clientY: 20 });
    fireEvent.pointerUp(window, { pointerId: 73, clientX: 500, clientY: 20 });
    fireEvent.click(chip);

    expect(onMove).not.toHaveBeenCalled();
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('opens an all-day chip when a pointer returns to its source lane before release', () => {
    const onMove = vi.fn();
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
        context={{
          lane: firstLane,
          geometry: { laneIndex: 0, laneWidth: 200 },
          onAnnouncementChange: vi.fn(),
        }}
        displayTimezone="UTC"
        lanes={[firstLane, secondLane]}
        onOpen={onOpen}
        onMove={onMove}
      />,
    );

    const chip = screen.getByRole('button', { name: 'Main library work location' });
    fireEvent.pointerDown(chip, { button: 0, pointerId: 74, clientX: 100, clientY: 20 });
    fireEvent.pointerMove(window, { pointerId: 74, clientX: 300, clientY: 20 });
    fireEvent.pointerMove(window, { pointerId: 74, clientX: 100, clientY: 20 });
    fireEvent.pointerUp(window, { pointerId: 74, clientX: 100, clientY: 20 });
    fireEvent.click(chip);

    expect(onMove).not.toHaveBeenCalled();
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('moves all-day chips by keyboard and announces the completed date change', () => {
    const onMove = vi.fn();
    const onAnnouncementChange = vi.fn();
    render(
      <WorkLocationAllDayContext
        regions={[
          region({
            allDay: true,
            startsAt: '2026-07-01T00:00:00.000Z',
            endsAt: '2026-07-02T00:00:00.000Z',
          }),
        ]}
        context={{
          lane: firstLane,
          geometry: { laneIndex: 0, laneWidth: 200 },
          onAnnouncementChange,
        }}
        displayTimezone="UTC"
        lanes={[firstLane, secondLane]}
        onOpen={vi.fn()}
        onMove={onMove}
      />,
    );

    fireEvent.keyDown(screen.getByRole('button', { name: 'Main library work location' }), {
      key: 'ArrowRight',
    });

    expect(onMove).toHaveBeenCalledWith(expect.objectContaining({ id: 'location' }), '2026-07-02');
    expect(onAnnouncementChange).toHaveBeenCalledWith(
      'Moved Main library work location to July 2.',
    );
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
        leadingOffset: 101,
        pixelsPerHour: 60,
      },
      placement: { columnIndex: 1, columnCount: 2 },
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
    const connector = screen.getByTestId('work-location-timebox-connector');
    expect(connector).toHaveClass('pointer-events-none', 'h-0.5');
    expect(connector).toHaveStyle({ left: '-91px', width: '91px' });
  });

  it.each(SCHEDULE_TEST_THEMES)(
    'keeps the %s rail and connector above 3:1 non-text contrast',
    (theme) => {
      const item: ScheduleItem = {
        id: 'timebox',
        title: 'Write brief',
        startsAt: '2026-07-01T09:00:00.000Z',
        endsAt: '2026-07-01T10:00:00.000Z',
        appearance: 'timebox',
      };
      const { rerender } = render(
        <WorkLocationTimedLaneContext
          regions={[region()]}
          context={timedContext()}
          displayTimezone="UTC"
          onOpen={vi.fn()}
          onEdit={vi.fn(() => ({ status: 'accepted' as const }))}
        />,
      );
      expect(screen.getByTestId('work-location-rail')).toHaveClass('bg-outline');
      expect(
        scheduleSurfaceContrast('var(--color-surface)', 'var(--color-outline)', theme),
      ).toBeGreaterThanOrEqual(3);

      rerender(
        <WorkLocationTimeboxDecoration
          regions={[region()]}
          context={{
            item,
            lane: { ...firstLane, items: [item] },
            geometry: {
              laneIndex: 0,
              bounds: { startMinutes: 540, endMinutes: 600 },
              top: 540,
              height: 60,
              laneWidth: 200,
              leadingOffset: 101,
              pixelsPerHour: 60,
            },
            placement: { columnIndex: 1, columnCount: 2 },
          }}
          displayTimezone="UTC"
        />,
      );
      expect(screen.getByTestId('work-location-timebox-connector')).toHaveClass('bg-outline');
    },
  );
});
