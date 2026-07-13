import '@testing-library/jest-dom/vitest';

/**
 * Behavior tests for the agenda entry action menu.
 *
 * @remarks
 * The menu is intentionally small: it should expose edit/clear/move/remove commands for planned
 * task entries and dispatch those commands through the agenda context mutation callbacks.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { agendaContext, clearTimebox, moveToDay, removeFromPlan, setTimebox } = vi.hoisted(() => ({
  agendaContext: { date: '2026-07-01', displayTimezone: 'Asia/Tokyo' },
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
    date: agendaContext.date,
    displayTimezone: agendaContext.displayTimezone,
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
  startsAt: '2026-07-01T00:00:00.000Z',
  endsAt: '2026-07-01T01:00:00.000Z',
  sort: 0,
  done: false,
  planItemId: '01J0PLANITEM00000000000001',
};

const REPEATED_HOUR_ENTRY: AgendaEntry = {
  ...ENTRY,
  title: 'Review fall launch plan',
  startsAt: '2026-11-01T09:30:00.000Z',
  endsAt: '2026-11-01T10:30:00.000Z',
};

/** Open the Radix dropdown trigger in jsdom. */
function openMenu(): void {
  const trigger = screen.getByRole('button', { name: 'Entry actions' });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  fireEvent.click(trigger);
}

beforeEach(() => {
  agendaContext.date = '2026-07-01';
  agendaContext.displayTimezone = 'Asia/Tokyo';
  clearTimebox.mockReset();
  moveToDay.mockReset();
  removeFromPlan.mockReset();
  setTimebox.mockReset();
});

afterEach(() => {
  cleanup();
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

  it('shows, validates, and submits a timebox in the Hub zone when the browser uses UTC', async () => {
    render(<AgendaEntryActions entry={ENTRY} />);

    openMenu();
    fireEvent.click(await screen.findByText('Edit timebox…'));

    const start = await screen.findByLabelText('Start');
    const end = screen.getByLabelText('End');
    expect(start).toHaveValue('09:00');
    expect(end).toHaveValue('10:00');

    fireEvent.change(start, { target: { value: '11:00' } });
    fireEvent.change(end, { target: { value: '10:00' } });
    expect(screen.getByText('End time must be after the start time.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set timebox' })).toBeDisabled();

    fireEvent.change(end, { target: { value: '12:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set timebox' }));

    await waitFor(() => {
      expect(setTimebox).toHaveBeenCalledWith(
        ENTRY,
        '2026-07-01T02:00:00Z',
        '2026-07-01T03:00:00Z',
      );
    });
  });

  it('saves untouched second-fold times with their exact original instants', async () => {
    agendaContext.date = '2026-11-01';
    agendaContext.displayTimezone = 'America/Los_Angeles';
    render(<AgendaEntryActions entry={REPEATED_HOUR_ENTRY} />);

    openMenu();
    fireEvent.click(await screen.findByText('Edit timebox…'));

    expect(await screen.findByLabelText('Start')).toHaveValue('01:30');
    expect(screen.getByLabelText('End')).toHaveValue('02:30');
    expect(screen.getByRole('button', { name: 'Later · PST' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const submit = screen.getByRole('button', { name: 'Set timebox' });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    await waitFor(() => {
      expect(setTimebox).toHaveBeenCalledWith(
        REPEATED_HOUR_ENTRY,
        REPEATED_HOUR_ENTRY.startsAt,
        REPEATED_HOUR_ENTRY.endsAt,
      );
    });
  });

  it('applies a different fold occurrence without changing the wall-clock value', async () => {
    agendaContext.date = '2026-11-01';
    agendaContext.displayTimezone = 'America/Los_Angeles';
    render(<AgendaEntryActions entry={REPEATED_HOUR_ENTRY} />);

    openMenu();
    fireEvent.click(await screen.findByText('Edit timebox…'));
    fireEvent.click(await screen.findByRole('button', { name: 'Earlier · PDT' }));
    fireEvent.click(screen.getByRole('button', { name: 'Set timebox' }));

    await waitFor(() => {
      expect(setTimebox).toHaveBeenCalledWith(
        REPEATED_HOUR_ENTRY,
        '2026-11-01T08:30:00Z',
        REPEATED_HOUR_ENTRY.endsAt,
      );
    });
  });

  it('requires and applies an explicit occurrence after editing into a repeated hour', async () => {
    agendaContext.date = '2026-11-01';
    agendaContext.displayTimezone = 'America/Los_Angeles';
    render(<AgendaEntryActions entry={REPEATED_HOUR_ENTRY} />);

    openMenu();
    fireEvent.click(await screen.findByText('Edit timebox…'));

    const start = await screen.findByLabelText('Start');
    fireEvent.change(start, { target: { value: '00:30' } });
    fireEvent.change(start, { target: { value: '01:30' } });

    const occurrence = screen.getByRole('group', { name: 'Start occurrence' });
    expect(within(occurrence).getByRole('button', { name: 'Earlier · PDT' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(within(occurrence).getByRole('button', { name: 'Later · PST' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByText('Choose Earlier or Later for the repeated start time.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Set timebox' })).toBeDisabled();
    expect(setTimebox).not.toHaveBeenCalled();

    fireEvent.click(within(occurrence).getByRole('button', { name: 'Earlier · PDT' }));
    fireEvent.click(screen.getByRole('button', { name: 'Set timebox' }));

    await waitFor(() => {
      expect(setTimebox).toHaveBeenCalledWith(
        REPEATED_HOUR_ENTRY,
        '2026-11-01T08:30:00Z',
        REPEATED_HOUR_ENTRY.endsAt,
      );
    });
  });

  it('keeps a skipped wall time invalid without offering occurrence choices', async () => {
    agendaContext.date = '2026-03-08';
    agendaContext.displayTimezone = 'America/Los_Angeles';
    render(
      <AgendaEntryActions
        entry={{
          ...ENTRY,
          startsAt: '2026-03-08T09:30:00.000Z',
          endsAt: '2026-03-08T11:00:00.000Z',
        }}
      />,
    );

    openMenu();
    fireEvent.click(await screen.findByText('Edit timebox…'));
    fireEvent.change(await screen.findByLabelText('Start'), {
      target: { value: '02:30' },
    });

    expect(screen.queryByRole('group', { name: 'Start occurrence' })).not.toBeInTheDocument();
    expect(screen.getByText('That start time does not exist because clocks change.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Set timebox' })).toBeDisabled();
    expect(setTimebox).not.toHaveBeenCalled();
  });
});
