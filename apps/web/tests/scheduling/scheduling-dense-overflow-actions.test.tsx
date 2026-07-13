import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  SCHEDULE_DRAG_MIME,
  SchedulingCanvas,
  type ScheduleItem,
  type ScheduleLane,
} from '@/components/scheduling';

/** Build one fully interactive event in a deliberately dense collision cluster. */
function denseItem(index: number): ScheduleItem {
  const id = `dense-${String(index)}`;
  return {
    id,
    title: `Dense event ${String(index)}`,
    startsAt: '2026-07-13T09:00:00Z',
    endsAt: '2026-07-13T10:00:00Z',
    editable: true,
    openable: true,
    dropTarget: true,
    dragObject: { kind: 'calendar_item', itemId: id, title: `Dense event ${String(index)}` },
  };
}

afterEach(cleanup);

describe('SchedulingCanvas dense-overflow actions', () => {
  it('promotes a hidden event into the real move, resize, relationship, and drop surface', async () => {
    const user = userEvent.setup();
    const items = Array.from({ length: 5 }, (_, index) => denseItem(index));
    const lane: ScheduleLane = {
      id: 'date:2026-07-13',
      label: 'Mon, Jul 13',
      date: '2026-07-13',
      items,
    };
    const onMoveItem = vi.fn();
    const onResizeItem = vi.fn();
    const onDropObjectOnItem = vi.fn();
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[lane]}
        pixelsPerHour={60}
        viewportWidth={300}
        onOpenItem={vi.fn()}
        onMoveItem={onMoveItem}
        onResizeItem={onResizeItem}
        onDropObjectOnItem={onDropObjectOnItem}
      />,
    );

    expect(document.querySelector('[data-schedule-item="dense-4"]')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show 3 more events in Mon, Jul 13' }));
    await user.click(screen.getByRole('button', { name: 'Show Dense event 4 on calendar' }));

    const promoted = document.querySelector<HTMLElement>('[data-schedule-item="dense-4"]');
    expect(promoted).toBeInTheDocument();
    expect(promoted?.querySelector('[data-schedule-item-body="dense-4"]')).toHaveFocus();

    fireEvent.keyDown(screen.getByRole('button', { name: 'Move Dense event 4' }), {
      key: 'ArrowDown',
    });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Resize Dense event 4 from end' }), {
      key: 'ArrowDown',
    });
    expect(onMoveItem).toHaveBeenCalledOnce();
    expect(onResizeItem).toHaveBeenCalledOnce();

    await user.click(
      screen.getByRole('button', { name: 'Create relationship from Dense event 4' }),
    );
    await user.click(screen.getByRole('button', { name: 'Link Dense event 4 to Dense event 0' }));
    expect(onDropObjectOnItem).toHaveBeenCalledWith({
      object: items[4]?.dragObject,
      targetItem: items[0],
      targetLane: lane,
    });

    const task = {
      kind: 'task' as const,
      taskId: 'task-1',
      organizationId: 'org-1',
      title: 'Prepare review',
    };
    const transfer = {
      types: [SCHEDULE_DRAG_MIME],
      dropEffect: 'none',
      getData: (type: string) => (type === SCHEDULE_DRAG_MIME ? JSON.stringify(task) : ''),
    };
    fireEvent.dragOver(promoted!, { dataTransfer: transfer });
    fireEvent.drop(promoted!, { dataTransfer: transfer });
    expect(onDropObjectOnItem).toHaveBeenLastCalledWith({
      object: task,
      targetItem: items[4],
      targetLane: lane,
    });
  });

  it('reveals a hidden relationship target and moves focus to its full-card action', async () => {
    const user = userEvent.setup();
    const items = Array.from({ length: 5 }, (_, index) => denseItem(index));
    const lane: ScheduleLane = {
      id: 'date:2026-07-13',
      label: 'Mon, Jul 13',
      date: '2026-07-13',
      items,
    };
    const onDropObjectOnItem = vi.fn();
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[lane]}
        pixelsPerHour={60}
        viewportWidth={300}
        onDropObjectOnItem={onDropObjectOnItem}
      />,
    );

    await user.click(
      screen.getByRole('button', { name: 'Create relationship from Dense event 0' }),
    );
    await user.click(screen.getByRole('button', { name: 'Show 3 more events in Mon, Jul 13' }));
    await user.click(screen.getByRole('button', { name: 'Show Dense event 4 on calendar' }));

    const target = screen.getByRole('button', { name: 'Link Dense event 0 to Dense event 4' });
    expect(target).toHaveFocus();
    await user.click(target);
    expect(onDropObjectOnItem).toHaveBeenCalledWith({
      object: items[0]?.dragObject,
      targetItem: items[4],
      targetLane: lane,
    });
  });
});
