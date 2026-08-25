import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { SchedulingCanvas, type ScheduleLane } from '@/components/scheduling';

const LANE: ScheduleLane = {
  id: 'agenda-day',
  date: '2026-08-10',
  label: 'Agenda date label',
  resourceId: 'single-day',
  items: [
    {
      id: 'all-day',
      title: 'Team offsite',
      startsAt: '2026-08-10T00:00:00.000Z',
      endsAt: '2026-08-11T00:00:00.000Z',
      allDay: true,
    },
  ],
};

function renderAgendaAllDayState({
  items,
  context,
}: {
  readonly items: ScheduleLane['items'];
  readonly context?: ReactNode;
}): HTMLElement {
  render(
    <SchedulingCanvas
      presentation="agenda"
      displayTimezone="UTC"
      lanes={[{ ...LANE, items }]}
      pixelsPerHour={48}
      viewportWidth={320}
      renderAllDayLaneContext={context === undefined ? undefined : () => context}
      onSelectAllDayRegion={vi.fn()}
    />,
  );
  const lane = document.querySelector<HTMLElement>('[data-schedule-all-day-lane="agenda-day"]');
  if (!lane) throw new Error('Agenda all-day lane did not render.');
  return lane;
}

describe('SchedulingCanvas Agenda presentation', () => {
  it('keeps all-day content while omitting duplicated lane-date chrome', () => {
    render(
      <SchedulingCanvas
        presentation="agenda"
        displayTimezone="UTC"
        lanes={[LANE]}
        pixelsPerHour={48}
        viewportWidth={320}
      />,
    );

    const canvas = screen.getByRole('region', { name: 'Schedule' });
    expect(canvas).toHaveAttribute('data-schedule-presentation', 'agenda');
    expect(canvas).toHaveClass('overflow-auto', 'overscroll-contain', 'scrollbar-none');
    expect(canvas).not.toHaveClass('rounded-xl');
    expect(screen.queryByText('Agenda date label')).not.toBeInTheDocument();
    expect(screen.getByText('Team offsite')).toBeInTheDocument();
  });

  it('keeps visible scrollbar styling on the Calendar presentation', () => {
    render(
      <SchedulingCanvas
        presentation="calendar"
        displayTimezone="UTC"
        lanes={[LANE]}
        pixelsPerHour={48}
        viewportWidth={320}
      />,
    );

    expect(screen.getByRole('region', { name: 'Schedule' })).not.toHaveClass('scrollbar-none');
  });

  it('uses one forty-pixel create row when the Agenda all-day lane is empty', () => {
    const lane = renderAgendaAllDayState({ items: [] });

    expect(lane).toHaveClass('min-h-10');
    const create = screen.getByRole('button', {
      name: 'Create all-day item for Agenda date label',
    });
    expect(create).toHaveClass('absolute', 'size-10');
    expect(create.parentElement).toBe(lane);
    expect(screen.queryByText('+ All day')).not.toBeInTheDocument();
  });

  it.each([
    {
      name: 'location only',
      items: [],
      context: <span>Home location</span>,
      primaryCount: 0,
    },
    {
      name: 'event only',
      items: LANE.items,
      context: undefined,
      primaryCount: 1,
    },
    {
      name: 'location and event',
      items: LANE.items,
      context: <span>Home location</span>,
      primaryCount: 1,
    },
  ])(
    'overlays creation without adding a second row for $name',
    ({ items, context, primaryCount }) => {
      const lane = renderAgendaAllDayState({ items, context });

      expect(lane).not.toHaveClass('min-h-10');
      expect(lane.querySelectorAll('[data-schedule-all-day-primary]')).toHaveLength(primaryCount);
      const create = screen.getByRole('button', {
        name: 'Create all-day item for Agenda date label',
      });
      expect(create).toHaveClass('absolute', 'size-10');
      expect(create.parentElement).toBe(lane);
      expect(screen.queryByText('+ All day')).not.toBeInTheDocument();
    },
  );

  it('lets a focused Agenda grid create a thirty-minute draft from the keyboard', () => {
    const onSelectRegion = vi.fn();
    render(
      <SchedulingCanvas
        presentation="agenda"
        displayTimezone="UTC"
        lanes={[{ ...LANE, items: [] }]}
        pixelsPerHour={48}
        viewportWidth={320}
        initialScrollMinutes={9 * 60}
        onSelectRegion={onSelectRegion}
      />,
    );

    const grid = screen.getByLabelText('Agenda date label time grid');
    grid.focus();
    fireEvent.keyDown(grid, { key: 'Enter' });

    expect(onSelectRegion).toHaveBeenCalledWith({
      lane: expect.objectContaining({ id: 'agenda-day' }),
      startMinutes: 540,
      endMinutes: 570,
    });
  });

  it('adjusts a focused keyboard draft by one snap and exposes day shortcuts', () => {
    const onSelectRegion = vi.fn();
    const onDateShortcut = vi.fn();
    render(
      <SchedulingCanvas
        presentation="agenda"
        displayTimezone="UTC"
        lanes={[{ ...LANE, items: [] }]}
        pixelsPerHour={48}
        viewportWidth={320}
        selectedRegion={{ lane: LANE, startMinutes: 540, endMinutes: 570 }}
        onSelectRegion={onSelectRegion}
        onDateShortcut={onDateShortcut}
      />,
    );

    const grid = screen.getByLabelText('Agenda date label time grid');
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    expect(onSelectRegion).toHaveBeenLastCalledWith({
      lane: expect.objectContaining({ id: 'agenda-day' }),
      startMinutes: 550,
      endMinutes: 580,
    });

    fireEvent.keyDown(grid, { key: 'ArrowLeft' });
    fireEvent.keyDown(grid, { key: 'ArrowRight' });
    fireEvent.keyDown(grid, { key: 't' });
    expect(onDateShortcut.mock.calls.map(([shortcut]) => shortcut)).toEqual([
      'previous',
      'next',
      'today',
    ]);
  });
});
