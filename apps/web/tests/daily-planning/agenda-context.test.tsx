import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import type { SchedulingCanvasProps } from '../../src/components/scheduling';
import { DailyAgenda } from '../../src/components/daily-planning/daily-planning-agenda';

vi.mock('../../src/components/scheduling', () => ({
  SchedulingCanvas: ({
    lanes,
    onOpenItem,
    onSelectRegion,
    renderTimedLaneUnderlay,
  }: SchedulingCanvasProps) => (
    <div>
      {lanes[0] &&
        renderTimedLaneUnderlay?.({
          lane: lanes[0],
          geometry: { laneIndex: 0, laneWidth: 600, laneHeight: 2016, pixelsPerHour: 84 },
        })}
      {onSelectRegion && lanes[0] ? (
        <button
          onClick={() => {
            const lane = lanes[0];
            if (lane) onSelectRegion({ lane, startMinutes: 600, endMinutes: 630 });
          }}
        >
          Select empty time
        </button>
      ) : null}
      {lanes
        .flatMap((lane) => lane.items)
        .map((item) => (
          <article key={item.id} data-schedule-item={item.id}>
            {item.openable !== false ? (
              <button
                onClick={() => {
                  const lane = lanes[0];
                  if (lane) onOpenItem?.({ item, lane });
                }}
              >
                {item.title}
              </button>
            ) : (
              item.title
            )}
          </article>
        ))}
    </div>
  ),
}));
vi.mock('../../src/components/dnd/use-daily-plan-drop-target', () => ({
  useDailyPlanDropTarget: () => ({ ref: vi.fn(), isOver: false, startMinutes: null }),
}));
afterEach(cleanup);

it('lets a busy all-day entry stop blocking only this plan', async () => {
  const toggle = vi.fn();
  render(
    <DailyAgenda
      date="2026-10-07"
      timezone="UTC"
      startAt="2026-10-07T09:00:00.000Z"
      workStartAt="2026-10-07T09:00:00.000Z"
      draft={{
        date: '2026-10-07',
        finishAt: '2026-10-07T17:00:00.000Z',
        mainTaskId: null,
        tasks: [],
        sessions: [],
      }}
      events={[
        {
          id: 'cycle-id',
          title: 'Cycle',
          allDay: true,
          blocksTime: true,
          startsAt: '2026-10-07T00:00:00.000Z',
          endsAt: '2026-10-08T00:00:00.000Z',
        },
      ]}
      names={new Map()}
      onEdit={vi.fn()}
      onDropTask={vi.fn()}
      onAddToBlock={vi.fn()}
      onChangeSession={vi.fn()}
      onToggleAllDayBlocking={toggle}
    />,
  );
  const checkbox = screen.getByRole('checkbox', { name: 'Cycle blocks work' });
  expect(checkbox).toBeChecked();
  await userEvent.click(checkbox);
  expect(toggle).toHaveBeenCalledWith('cycle-id', false);
});

it('opens fixed calendar events and forwards empty-time selection', async () => {
  const openEvent = vi.fn();
  const select = vi.fn();
  render(
    <DailyAgenda
      date="2026-10-07"
      timezone="UTC"
      startAt="2026-10-07T09:00:00.000Z"
      workStartAt="2026-10-07T09:00:00.000Z"
      draft={{
        date: '2026-10-07',
        finishAt: '2026-10-07T17:00:00.000Z',
        mainTaskId: null,
        tasks: [],
        sessions: [],
      }}
      events={[
        {
          id: 'calendar-event',
          title: 'Community meeting',
          startsAt: '2026-10-07T10:00:00.000Z',
          endsAt: '2026-10-07T11:00:00.000Z',
        },
      ]}
      names={new Map()}
      onEdit={vi.fn()}
      onDropTask={vi.fn()}
      onAddToBlock={vi.fn()}
      onChangeSession={vi.fn()}
      onOpenEvent={openEvent}
      onSelectRegion={select}
    />,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Community meeting' }));
  expect(openEvent).toHaveBeenCalledWith('calendar-event');
  await userEvent.click(screen.getByRole('button', { name: 'Select empty time' }));
  expect(select).toHaveBeenCalledWith(
    expect.objectContaining({ startMinutes: 600, endMinutes: 630 }),
  );
});

it('shows all-day entries directly without repeating an event in a disclosure', () => {
  const events = [
    ...['Home', 'Cycle', 'WWD'].map((title) => ({
      title,
      startsAt: '2026-10-07T00:00:00.000Z',
      endsAt: '2026-10-08T00:00:00.000Z',
      allDay: true,
      blocksTime: false,
    })),
    {
      title: 'Unavailable day',
      startsAt: '2026-10-07T00:00:00.000Z',
      endsAt: '2026-10-08T00:00:00.000Z',
      allDay: true,
      blocksTime: true,
    },
    {
      title: 'Optional calendar note',
      startsAt: '2026-10-07T10:00:00.000Z',
      endsAt: '2026-10-07T10:30:00.000Z',
      blocksTime: false,
    },
  ];
  const { container } = render(
    <DailyAgenda
      date="2026-10-07"
      timezone="UTC"
      startAt="2026-10-07T09:00:00.000Z"
      workStartAt="2026-10-07T09:00:00.000Z"
      draft={{
        date: '2026-10-07',
        mainTaskId: null,
        finishAt: '2026-10-07T17:00:00.000Z',
        tasks: [],
        sessions: [],
      }}
      events={events}
      names={new Map()}
      onEdit={vi.fn()}
      onDropTask={vi.fn()}
      onAddToBlock={vi.fn()}
      onChangeSession={vi.fn()}
    />,
  );
  const context = screen.getByRole('group', { name: 'All-day calendar context' });
  for (const title of ['Home', 'Cycle', 'WWD'])
    expect(within(context).getByText(title)).toBeVisible();
  expect(within(context).getByText('Unavailable day')).toBeVisible();
  expect(within(context).getByText('Busy all day')).toBeVisible();
  expect(within(context).queryByRole('button', { expanded: false })).not.toBeInTheDocument();
  expect(container.querySelectorAll('[data-schedule-item]')).toHaveLength(1);
  expect(screen.getByText('Optional calendar note')).toBeVisible();
  const workdayWindow = container.querySelector('[data-workday-window]');
  expect(workdayWindow).toHaveStyle({ top: '756px', height: '672px' });
});
