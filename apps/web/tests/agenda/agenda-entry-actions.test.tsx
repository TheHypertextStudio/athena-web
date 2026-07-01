import '@testing-library/jest-dom/vitest';

/**
 * Behavior tests for the agenda entry action menu.
 *
 * @remarks
 * The menu is intentionally small: it should expose edit/clear/move/remove commands for planned
 * task entries and dispatch those commands through the agenda context mutation callbacks.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { clearTimebox, moveToDay, removeFromPlan, setTimebox } = vi.hoisted(() => ({
  clearTimebox: vi.fn(),
  moveToDay: vi.fn(),
  removeFromPlan: vi.fn(),
  setTimebox: vi.fn(),
}));

vi.mock('../../src/components/agenda/agenda-context', () => ({
  isTimeboxed: (entry: { startsAt?: string; endsAt?: string }) =>
    entry.startsAt != null && entry.endsAt != null,
  shiftISODate: (date: string, deltaDays: number) => (deltaDays === 1 ? '2026-07-02' : date),
  useAgenda: () => ({
    date: '2026-07-01',
    clearTimebox,
    moveToDay,
    removeFromPlan,
    setTimebox,
  }),
}));

import type { AgendaEntry } from '../../src/components/agenda/agenda-context';
import AgendaEntryActions from '../../src/components/agenda/agenda-entry-actions';

const ENTRY: AgendaEntry = {
  id: '01ARZ3NDEKTSV4RRFFQ69G5FA0',
  source: 'task',
  taskId: '01ARZ3NDEKTSV4RRFFQ69G5FA0',
  organizationId: '01BX5ZZKBKACTAV9WEVGEMMVRZ',
  title: 'Draft launch memo',
  startsAt: '2026-07-01T16:00:00.000Z',
  endsAt: '2026-07-01T17:00:00.000Z',
  sort: 0,
  done: false,
  planItemId: '01J0PLANITEM00000000000001',
};

/** Open the Radix dropdown trigger in jsdom. */
function openMenu(): void {
  const trigger = screen.getByRole('button', { name: 'Entry actions' });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  fireEvent.click(trigger);
}

beforeEach(() => {
  clearTimebox.mockReset();
  moveToDay.mockReset();
  removeFromPlan.mockReset();
  setTimebox.mockReset();
});

describe('AgendaEntryActions', () => {
  it('dispatches direct menu actions for a timeboxed task', async () => {
    render(<AgendaEntryActions entry={ENTRY} />);

    openMenu();
    fireEvent.click(await screen.findByText('Clear timebox'));
    expect(clearTimebox).toHaveBeenCalledWith(ENTRY);

    openMenu();
    fireEvent.click(await screen.findByText('Move to tomorrow'));
    expect(moveToDay).toHaveBeenCalledWith(ENTRY, '2026-07-02');

    openMenu();
    fireEvent.click(await screen.findByText('Remove from plan'));
    expect(removeFromPlan).toHaveBeenCalledWith(ENTRY);
  });

  it('validates and submits a custom timebox window', async () => {
    render(<AgendaEntryActions entry={ENTRY} />);

    openMenu();
    fireEvent.click(await screen.findByText('Edit timebox…'));

    const start = await screen.findByLabelText('Start');
    const end = screen.getByLabelText('End');
    fireEvent.change(start, { target: { value: '11:00' } });
    fireEvent.change(end, { target: { value: '10:00' } });
    expect(screen.getByText('End time must be after the start time.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set timebox' })).toBeDisabled();

    fireEvent.change(end, { target: { value: '12:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set timebox' }));

    await waitFor(() => {
      expect(setTimebox).toHaveBeenCalledWith(
        ENTRY,
        new Date('2026-07-01T11:00:00').toISOString(),
        new Date('2026-07-01T12:00:00').toISOString(),
      );
    });
  });
});
