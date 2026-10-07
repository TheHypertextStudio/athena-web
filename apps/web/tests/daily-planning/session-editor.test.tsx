import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DailyPlanSnapshot } from '@docket/planning/daily-plan-flow';
import { SessionEditor } from '../../src/components/daily-planning/daily-planning-session-editor';

const date = '2026-10-07';
const names = new Map([
  ['a', 'Write announcement'],
  ['b', 'Review release'],
  ['c', 'Send update'],
  ['d', 'Check launch'],
]);
const draft: DailyPlanSnapshot = {
  date,
  finishAt: '2026-10-07T17:00:00.000Z',
  mainTaskId: null,
  tasks: [
    { taskId: 'a', organizationId: 'org', plannedMinutes: 45, sort: 0 },
    { taskId: 'b', organizationId: 'org', plannedMinutes: 15, sort: 1 },
    { taskId: 'c', organizationId: 'org', plannedMinutes: 10, sort: 2 },
    { taskId: 'd', organizationId: 'org', plannedMinutes: 30, sort: 3 },
  ],
  sessions: [
    {
      id: 'block',
      startsAt: '2026-10-07T09:00:00.000Z',
      endsAt: '2026-10-07T09:45:00.000Z',
      allocations: [
        { taskId: 'a', plannedMinutes: 20 },
        { taskId: 'b', plannedMinutes: 15 },
        { taskId: 'c', plannedMinutes: 10 },
      ],
      pinned: false,
      placementSource: 'automatic',
    },
  ],
};
function mount(
  editing: { taskId: string; sessionId?: string } = { taskId: 'a', sessionId: 'block' },
) {
  const onSave = vi.fn();
  const onRemove = vi.fn();
  const onCancel = vi.fn();
  render(
    <SessionEditor
      date={date}
      timezone="UTC"
      earliestAt="2026-10-07T08:00:00.000Z"
      events={[]}
      draft={draft}
      names={names}
      editing={editing}
      onSave={onSave}
      onRemove={onRemove}
      onCancel={onCancel}
    />,
  );
  return { onSave, onRemove, onCancel };
}
afterEach(cleanup);

describe('daily planning block editor controls', () => {
  it('keeps every allocation when a block with three tasks is saved', () => {
    const { onSave } = mount();
    expect(screen.getByRole('spinbutton', { name: 'Duration for Write announcement' })).toHaveValue(
      20,
    );
    expect(screen.getByRole('spinbutton', { name: 'Duration for Review release' })).toHaveValue(15);
    expect(screen.getByRole('spinbutton', { name: 'Duration for Send update' })).toHaveValue(10);
    fireEvent.click(screen.getByRole('button', { name: 'Save block' }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'block',
        allocations: draft.sessions[0]?.allocations,
        startsAt: '2026-10-07T09:00:00.000Z',
        endsAt: '2026-10-07T09:45:00.000Z',
        placementSource: 'manual',
      }),
    );
  });
  it('edits one allocation and updates the full block duration', () => {
    const { onSave } = mount();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Duration for Review release' }), {
      target: { value: '25' },
    });
    expect(screen.getByText('55 minutes in this block')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Save block' }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        allocations: [
          { taskId: 'a', plannedMinutes: 20 },
          { taskId: 'b', plannedMinutes: 25 },
          { taskId: 'c', plannedMinutes: 10 },
        ],
        endsAt: '2026-10-07T09:55:00.000Z',
      }),
    );
  });
  it('adds an unscheduled task through the labeled picker', () => {
    const { onSave } = mount();
    fireEvent.change(screen.getByRole('combobox', { name: 'Add to block' }), {
      target: { value: 'd' },
    });
    expect(screen.getByRole('spinbutton', { name: 'Duration for Check launch' })).toHaveValue(30);
    fireEvent.click(screen.getByRole('button', { name: 'Save block' }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        allocations: [
          ...(draft.sessions[0]?.allocations ?? []),
          { taskId: 'd', plannedMinutes: 30 },
        ],
        endsAt: '2026-10-07T10:15:00.000Z',
      }),
    );
  });
  it('pins the block through a labeled control', () => {
    const { onSave } = mount();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Keep this block in place' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save block' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ pinned: true }));
  });
  it('unschedules only after the person activates Unschedule', () => {
    const { onRemove, onSave } = mount();
    expect(onRemove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Unschedule' }));
    expect(onRemove).toHaveBeenCalledWith('block');
    expect(onSave).not.toHaveBeenCalled();
  });
  it('cancels through the touch-accessible button without saving changes', () => {
    const { onCancel, onSave } = mount();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Duration for Send update' }), {
      target: { value: '30' },
    });
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    fireEvent.pointerDown(cancel, { pointerType: 'touch' });
    fireEvent.pointerUp(cancel, { pointerType: 'touch' });
    fireEvent.click(cancel);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });
  it('cancels through Escape without saving the block', () => {
    const { onCancel, onSave } = mount();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });
  it('offers a new block without Unschedule and rejects a nonpositive duration', () => {
    const { onSave } = mount({ taskId: 'd' });
    expect(screen.queryByRole('button', { name: 'Unschedule' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Duration for Check launch' }), {
      target: { value: '0' },
    });
    expect(screen.getByRole('button', { name: 'Save block' })).toBeDisabled();
    expect(onSave).not.toHaveBeenCalled();
  });
});
