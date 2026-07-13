import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SchedulingCanvas, type ScheduleItem, type ScheduleLane } from '@/components/scheduling';

const SOURCE_OBJECT = {
  kind: 'calendar_item' as const,
  itemId: 'focus',
  title: 'Focus block',
};

const SOURCE_ITEM: ScheduleItem = {
  id: 'focus',
  title: 'Focus block',
  startsAt: '2026-07-01T09:00:00.000Z',
  endsAt: '2026-07-01T10:00:00.000Z',
  dragObject: SOURCE_OBJECT,
  dropTarget: true,
};

const TARGET_ITEM: ScheduleItem = {
  id: 'review',
  title: 'Planning review',
  startsAt: '2026-07-01T11:00:00.000Z',
  endsAt: '2026-07-01T12:00:00.000Z',
  dropTarget: true,
};

const ALL_DAY_SOURCE: ScheduleItem = {
  id: 'offsite',
  title: 'Team offsite',
  startsAt: '2026-07-01T00:00:00.000Z',
  endsAt: '2026-07-02T00:00:00.000Z',
  allDay: true,
  dragObject: {
    kind: 'calendar_item',
    itemId: 'offsite',
    title: 'Team offsite',
  },
};

const ALL_DAY_TARGET: ScheduleItem = {
  id: 'deadline',
  title: 'Launch day',
  startsAt: '2026-07-01T00:00:00.000Z',
  endsAt: '2026-07-02T00:00:00.000Z',
  allDay: true,
  dropTarget: true,
};

const LANE: ScheduleLane = {
  id: 'wednesday',
  label: 'Wednesday',
  date: '2026-07-01',
  timezone: 'UTC',
  items: [SOURCE_ITEM, TARGET_ITEM],
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SchedulingCanvas relationship mode', () => {
  it('lets a keyboard user choose an eligible target without exposing the source as a target', async () => {
    const user = userEvent.setup();
    const onDropObjectOnItem = vi.fn();
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[LANE]}
        pixelsPerHour={60}
        viewportWidth={500}
        onDropObjectOnItem={onDropObjectOnItem}
      />,
    );

    const sourceControl = screen.getByRole('button', {
      name: 'Create relationship from Focus block',
    });
    sourceControl.focus();
    await user.keyboard('{Enter}');

    const cancelControl = screen.getByRole('button', {
      name: 'Cancel relationship from Focus block',
    });
    expect(cancelControl).toHaveAttribute('aria-pressed', 'true');
    expect(cancelControl).toHaveClass('bg-primary-container', 'opacity-100');
    expect(
      screen.getByText(/Choose an event or timebox to link with Focus block/),
    ).toHaveTextContent(
      'Choose an event or timebox to link with Focus block. Press Escape to cancel.',
    );
    expect(
      screen.queryByRole('button', { name: 'Link Focus block to Focus block' }),
    ).not.toBeInTheDocument();

    const targetControl = screen.getByRole('button', {
      name: 'Link Focus block to Planning review',
    });
    expect(targetControl).toHaveFocus();
    const coveredControls = targetControl.parentElement?.querySelector(
      '[data-schedule-relationship-covered]',
    );
    expect(coveredControls).toHaveAttribute('inert');
    await user.keyboard('{Enter}');

    expect(onDropObjectOnItem).toHaveBeenCalledOnce();
    expect(onDropObjectOnItem).toHaveBeenCalledWith({
      object: SOURCE_OBJECT,
      targetItem: TARGET_ITEM,
      targetLane: LANE,
    });
    expect(
      screen.getByText(/Relationship requested between Focus block and Planning review/),
    ).toHaveTextContent('Relationship requested between Focus block and Planning review.');
    expect(
      screen.queryByRole('button', { name: 'Link Focus block to Planning review' }),
    ).not.toBeInTheDocument();
  });

  it('lets a touch user start from an all-day item and cancel the target mode with Escape', async () => {
    const user = userEvent.setup();
    const onDropObjectOnItem = vi.fn();
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[{ ...LANE, items: [ALL_DAY_SOURCE, TARGET_ITEM] }]}
        pixelsPerHour={60}
        viewportWidth={500}
        onDropObjectOnItem={onDropObjectOnItem}
      />,
    );

    const sourceControl = screen.getByRole('button', {
      name: 'Create relationship from Team offsite',
    });
    fireEvent.pointerDown(sourceControl, { pointerId: 7, pointerType: 'touch', isPrimary: true });
    fireEvent.pointerUp(sourceControl, { pointerId: 7, pointerType: 'touch', isPrimary: true });
    fireEvent.click(sourceControl, { detail: 1 });

    expect(
      screen.getByRole('button', { name: 'Link Team offsite to Planning review' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Choose an event or timebox to link with Team offsite/),
    ).toHaveTextContent('Press Escape to cancel.');

    await user.keyboard('{Escape}');

    expect(onDropObjectOnItem).not.toHaveBeenCalled();
    expect(screen.getByText('Relationship creation canceled.')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Link Team offsite to Planning review' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Create relationship from Team offsite' }),
    ).toHaveFocus();
  });

  it('makes an eligible all-day item an activatable relationship target', async () => {
    const user = userEvent.setup();
    const onDropObjectOnItem = vi.fn();
    const sourceLane = { ...LANE, items: [SOURCE_ITEM, ALL_DAY_TARGET] };
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[sourceLane]}
        pixelsPerHour={60}
        viewportWidth={500}
        onDropObjectOnItem={onDropObjectOnItem}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Create relationship from Focus block' }));
    const target = screen.getByRole('button', { name: 'Link Focus block to Launch day' });
    expect(
      target.parentElement?.querySelector('[data-schedule-relationship-covered]'),
    ).toHaveAttribute('inert');
    await user.click(target);

    expect(onDropObjectOnItem).toHaveBeenCalledWith({
      object: SOURCE_OBJECT,
      targetItem: ALL_DAY_TARGET,
      targetLane: sourceLane,
    });
  });

  it('activates a touch target without starting the canvas pan gesture', () => {
    const addListener = vi.spyOn(window, 'addEventListener');
    const onDropObjectOnItem = vi.fn();
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[LANE]}
        pixelsPerHour={60}
        viewportWidth={500}
        onDropObjectOnItem={onDropObjectOnItem}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Create relationship from Focus block' }), {
      detail: 1,
    });
    addListener.mockClear();
    const targetControl = screen.getByRole('button', {
      name: 'Link Focus block to Planning review',
    });
    fireEvent.pointerDown(targetControl, {
      button: 0,
      pointerId: 8,
      pointerType: 'touch',
      isPrimary: true,
      clientX: 100,
      clientY: 200,
    });

    expect(addListener.mock.calls.filter(([type]) => type === 'pointermove')).toHaveLength(0);

    fireEvent.pointerUp(targetControl, {
      button: 0,
      pointerId: 8,
      pointerType: 'touch',
      isPrimary: true,
      clientX: 100,
      clientY: 200,
    });
    fireEvent.click(targetControl, { detail: 1 });
    expect(onDropObjectOnItem).toHaveBeenCalledOnce();
  });
});
