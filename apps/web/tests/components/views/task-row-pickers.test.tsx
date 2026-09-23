/**
 * A task row's in-place pickers: `L` and `W` open the labels and time-estimate popovers with the
 * row's own value, and the Time cell's estimate opens the time popover without opening the row.
 */
import '@testing-library/jest-dom/vitest';

import type { TaskOut } from '@docket/work/task-model';
import { fireEvent, render, renderHook, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTaskRowPickers } from '@/components/views/task-row-pickers';
import { TaskTimeCell } from '@/components/views/task-time-cell';

const { open } = vi.hoisted(() => ({ open: vi.fn() }));

vi.mock('@/components/pickers/picker-overlay', () => ({
  usePickerOverlay: () => ({ open }),
}));
vi.mock('@/components/time-tracking', () => ({
  TaskTimerButton: () => <button type="button">Track this task</button>,
}));

const ORG_ID = '01HZX5K3QJ9F8B7C6D5E4F3G2H';

/** A task row with the fields the pickers read. */
function taskRow(estimateMinutes: number | null): TaskOut {
  return {
    id: 'task_1',
    organizationId: ORG_ID,
    title: 'Grant report',
    parentTaskId: null,
    labels: [],
    estimateMinutes,
  } as unknown as TaskOut;
}

beforeEach(() => {
  open.mockReset();
});

describe('useTaskRowPickers', () => {
  it('opens the time-estimate popover on W with the row’s estimate', () => {
    const { result } = renderHook(() => useTaskRowPickers());
    const anchor = document.createElement('div');

    expect(result.current.onPropertyKey('w', taskRow(45), anchor)).toBe(true);

    expect(open).toHaveBeenCalledWith({
      kind: 'estimate-time',
      objects: [
        {
          kind: 'task',
          id: 'task_1',
          organizationId: ORG_ID,
          title: 'Grant report',
          meta: { parentTaskId: null },
        },
      ],
      current: new Map([['task:task_1', 45]]),
      anchor,
    });
  });

  it('leaves other letters to the table', () => {
    const { result } = renderHook(() => useTaskRowPickers());

    expect(result.current.onPropertyKey('x', taskRow(null), null)).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });
});

describe('TaskTimeCell', () => {
  it('opens the time-estimate popover from the estimate without activating the row', () => {
    const onRowClick = vi.fn();
    render(
      <div onClick={onRowClick}>
        <TaskTimeCell task={taskRow(null)} editable />
      </div>,
    );
    const estimate = screen.getByRole('button', { name: /^Time estimate/ });

    const notPrevented = fireEvent.click(estimate);

    expect(notPrevented).toBe(false);
    expect(onRowClick).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'estimate-time',
        current: new Map([['task:task_1', null]]),
        anchor: estimate,
      }),
    );
  });

  it('shows the estimate as h:mm', () => {
    render(<TaskTimeCell task={taskRow(90)} editable />);

    expect(screen.getByRole('button', { name: /^Time estimate/ })).toHaveTextContent('1:30');
  });

  it('shows the estimate as text to a viewer who cannot set it', () => {
    render(<TaskTimeCell task={taskRow(0)} editable={false} />);

    expect(screen.queryByRole('button', { name: /^Time estimate/ })).not.toBeInTheDocument();
    expect(screen.getByText('0:00')).toBeInTheDocument();
  });
});
