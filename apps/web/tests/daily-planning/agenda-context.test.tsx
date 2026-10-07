import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ScheduleLane } from '../../src/components/scheduling';
import { DailyAgenda } from '../../src/components/daily-planning/daily-planning-agenda';

vi.mock('../../src/components/scheduling', () => ({
  SchedulingCanvas: ({ lanes }: { lanes: readonly ScheduleLane[] }) => (
    <div>
      {lanes
        .flatMap((lane) => lane.items)
        .map((item) => (
          <article key={item.id} data-schedule-item={item.id}>
            {item.title}
          </article>
        ))}
    </div>
  ),
}));
vi.mock('../../src/components/dnd/use-daily-plan-drop-target', () => ({
  useDailyPlanDropTarget: () => ({ ref: vi.fn(), isOver: false, startMinutes: null }),
}));
afterEach(cleanup);

it('keeps all-day provider context compact and noninteractive while showing timed free events', () => {
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
  expect(within(context).getByText('Unavailable day (busy)')).toBeVisible();
  expect(within(context).queryByRole('button')).not.toBeInTheDocument();
  expect(container.querySelectorAll('[data-schedule-item]')).toHaveLength(1);
  expect(screen.getByText('Optional calendar note')).toBeVisible();
});
