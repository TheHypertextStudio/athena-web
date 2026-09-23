import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SchedulingCanvas, type ScheduleItem, type ScheduleLane } from '@/components/scheduling';

afterEach(cleanup);

describe('cross-day scheduling labels', () => {
  it.each([
    {
      name: 'UTC overnight',
      startsAt: '2026-09-23T23:30:00Z',
      endsAt: '2026-09-24T01:15:00Z',
      timezone: 'UTC',
      dates: ['2026-09-23', '2026-09-24'],
      expected: ['11:30 PM – 12:00 AM', '12:00 AM – 1:15 AM'],
    },
    {
      name: 'viewer-local overnight',
      startsAt: '2026-09-24T06:30:00Z',
      endsAt: '2026-09-24T08:15:00Z',
      timezone: 'America/Los_Angeles',
      dates: ['2026-09-23', '2026-09-24'],
      expected: ['11:30 PM – 12:00 AM', '12:00 AM – 1:15 AM'],
    },
    {
      name: 'spring clock change',
      startsAt: '2026-03-08T07:30:00Z',
      endsAt: '2026-03-08T11:30:00Z',
      timezone: 'America/Los_Angeles',
      dates: ['2026-03-07', '2026-03-08'],
      expected: ['11:30 PM – 12:00 AM', '12:00 AM PST – 4:30 AM PDT'],
    },
    {
      name: 'fall clock change',
      startsAt: '2026-11-01T06:30:00Z',
      endsAt: '2026-11-01T10:30:00Z',
      timezone: 'America/Los_Angeles',
      dates: ['2026-10-31', '2026-11-01'],
      expected: ['11:30 PM – 12:00 AM', '12:00 AM PDT – 2:30 AM PST'],
    },
    {
      name: 'year boundary',
      startsAt: '2026-12-31T23:30:00Z',
      endsAt: '2027-01-01T01:15:00Z',
      timezone: 'UTC',
      dates: ['2026-12-31', '2027-01-01'],
      expected: ['11:30 PM – 12:00 AM', '12:00 AM – 1:15 AM'],
    },
  ])('shows exact visible times for $name', ({ startsAt, endsAt, timezone, dates, expected }) => {
    const item: ScheduleItem = { id: 'overnight', title: 'Overnight', startsAt, endsAt };
    const lanes: ScheduleLane[] = dates.map((date) => ({
      id: date,
      label: date,
      date,
      items: [item],
    }));

    render(
      <SchedulingCanvas
        displayTimezone={timezone}
        lanes={lanes}
        pixelsPerHour={60}
        viewportWidth={900}
      />,
    );

    dates.forEach((date, index) => {
      const lane = screen.getByLabelText(`${date} time grid`);
      const card = lane.querySelector<HTMLElement>('[data-schedule-item-body="overnight"]');
      expect(card).toHaveAttribute('title', `Overnight · ${expected[index]}`);
    });
  });

  it('does not render a zero-length card on a midnight end date', () => {
    const item: ScheduleItem = {
      id: 'midnight-end',
      title: 'Midnight end',
      startsAt: '2026-09-23T23:30:00Z',
      endsAt: '2026-09-24T00:00:00Z',
    };
    const lanes: ScheduleLane[] = ['2026-09-23', '2026-09-24'].map((date) => ({
      id: date,
      label: date,
      date,
      items: [item],
    }));

    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={lanes}
        pixelsPerHour={60}
        viewportWidth={900}
      />,
    );

    expect(
      screen
        .getByLabelText('2026-09-23 time grid')
        .querySelector('[data-schedule-item-body="midnight-end"]'),
    ).toHaveAttribute('title', 'Midnight end · 11:30 PM – 12:00 AM');
    expect(
      screen
        .getByLabelText('2026-09-24 time grid')
        .querySelector('[data-schedule-item-body="midnight-end"]'),
    ).toBeNull();
  });

  it('names the next day on a full middle-day card', () => {
    const onOpenItem = vi.fn();
    const item: ScheduleItem = {
      id: 'conference',
      title: 'Conference',
      startsAt: '2026-09-23T22:00:00Z',
      endsAt: '2026-09-25T02:00:00Z',
    };
    const lanes: ScheduleLane[] = ['2026-09-23', '2026-09-24', '2026-09-25'].map((date) => ({
      id: date,
      label: date,
      date,
      items: [item],
    }));

    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={lanes}
        pixelsPerHour={60}
        viewportWidth={900}
        onOpenItem={onOpenItem}
      />,
    );

    const middleLane = screen.getByLabelText('2026-09-24 time grid');
    const middleCard = middleLane.querySelector<HTMLElement>(
      '[data-schedule-item-body="conference"]',
    );
    expect(middleCard).toHaveAccessibleName(/Conference.*12:00 AM.*12:00 AM next day/);
    expect(middleCard).toHaveAttribute('title', 'Conference · 12:00 AM – 12:00 AM next day');

    const lastLane = screen.getByLabelText('2026-09-25 time grid');
    const lastCard = lastLane.querySelector<HTMLElement>('[data-schedule-item-body="conference"]');
    if (!middleCard || !lastCard) throw new Error('Missing a visible conference segment');
    fireEvent.click(middleCard);
    fireEvent.click(lastCard);
    expect(onOpenItem).toHaveBeenCalledTimes(2);
    expect(onOpenItem).toHaveBeenNthCalledWith(1, expect.objectContaining({ item }));
    expect(onOpenItem).toHaveBeenNthCalledWith(2, expect.objectContaining({ item }));
  });
});
