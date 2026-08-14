import '@testing-library/jest-dom/vitest';

import { WorkPlaceId, type WorkPlaceOut } from '@docket/types';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { mutate, reset, mutationState } = vi.hoisted(() => ({
  mutate: vi.fn(),
  reset: vi.fn(),
  mutationState: { isError: false },
}));

vi.mock('../../src/components/calendar/calendar-mutations', () => ({
  useCreateCalendarItem: () => ({
    mutate,
    reset,
    isPending: false,
    isError: mutationState.isError,
  }),
}));

import CreateBlockForm, {
  type CalendarRegionSelection,
} from '../../src/components/calendar/create-block-form';

const SELECTION = {
  startsAt: '2026-08-10T17:00:00.000Z',
  endsAt: '2026-08-10T18:00:00.000Z',
};
const LIBRARY_ID = WorkPlaceId.parse('01BX5ZZKBKACTAV9WEVGEMMWV1');
const LIBRARY: WorkPlaceOut = {
  id: LIBRARY_ID,
  name: 'Eastside library',
  geofence: null,
  providerMappings: [],
  sort: 0,
  archivedAt: null,
  createdAt: '2026-08-10T00:00:00.000Z',
  updatedAt: '2026-08-10T00:00:00.000Z',
};

afterEach(() => {
  cleanup();
  mutate.mockReset();
  mutationState.isError = false;
  reset.mockReset();
});

describe('CreateBlockForm progressive quick create', () => {
  it('uses a triggerless focus-managed dialog for an Agenda-selected draft', async () => {
    render(
      <CreateBlockForm
        presentation="agenda"
        trigger="hidden"
        displayTimezone="America/Los_Angeles"
        selection={SELECTION}
      />,
    );

    const dialog = await screen.findByRole('dialog', { name: 'Create calendar item' });
    expect(dialog).toHaveAttribute('data-create-presentation', 'agenda-mobile');
    expect(screen.queryByRole('button', { name: 'New' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Edit schedule/ })).toHaveTextContent(
      'Los Angeles · Does not repeat',
    );
    expect(screen.queryByRole('button', { name: 'Time zone' })).not.toBeInTheDocument();
  });

  it('separates date and time only after the schedule summary is opened', async () => {
    const onDraftChange = vi.fn();
    const onDirtyChange = vi.fn();
    render(
      <CreateBlockForm
        presentation="agenda"
        displayTimezone="America/Los_Angeles"
        selection={SELECTION}
        onDraftChange={onDraftChange}
        onDirtyChange={onDirtyChange}
      />,
    );

    const summary = await screen.findByRole('button', { name: /Edit schedule/ });
    expect(summary).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(summary);
    expect(screen.getByRole('button', { name: /Start date/ })).toHaveTextContent('Aug 10, 2026');
    expect(screen.getByLabelText('Start time')).toHaveValue('10:00');
    expect(screen.queryByRole('button', { name: /End date/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add end date' })).toBeInTheDocument();
    expect(screen.getByLabelText('End time')).toHaveValue('11:00');
    expect(screen.getByLabelText('All day')).not.toBeChecked();
    expect(screen.getByLabelText('Repeat')).toHaveValue('none');
    expect(screen.getByRole('button', { name: 'Time zone' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('End time'), { target: { value: '12:00' } });
    await waitFor(() => {
      expect(onDraftChange).toHaveBeenLastCalledWith({
        startsAt: '2026-08-10T17:00:00Z',
        endsAt: '2026-08-10T19:00:00Z',
      });
      expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    });
    expect(mutate).not.toHaveBeenCalled();
  });

  it('does not reset fields when the controlled parent projects an edited schedule', async () => {
    function ControlledQuickCreate() {
      const [selection, setSelection] = useState<CalendarRegionSelection>(SELECTION);
      return (
        <CreateBlockForm
          presentation="agenda"
          displayTimezone="America/Los_Angeles"
          selection={selection}
          onDraftChange={setSelection}
        />
      );
    }

    render(<ControlledQuickCreate />);
    fireEvent.change(await screen.findByLabelText('Title'), {
      target: { value: 'Keep projected fields' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Edit schedule/ }));
    fireEvent.change(screen.getByLabelText('End time'), { target: { value: '12:00' } });
    await waitFor(() => {
      expect(screen.getByLabelText('Title')).toHaveValue('Keep projected fields');
      expect(screen.getByLabelText('End time')).toHaveValue('12:00');
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    });
  });

  it('highlights incomplete fields and disables Save without validation prose', async () => {
    render(<CreateBlockForm presentation="agenda" displayTimezone="UTC" selection={SELECTION} />);
    const title = await screen.findByLabelText('Title');
    const save = screen.getByRole('button', { name: 'Save' });
    expect(title).toHaveAttribute('aria-invalid', 'true');
    expect(save).toBeDisabled();
    expect(within(screen.getByRole('dialog')).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('saves one valid timed item with its start timezone', async () => {
    render(
      <CreateBlockForm
        presentation="agenda"
        displayTimezone="America/Los_Angeles"
        selection={SELECTION}
      />,
    );
    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'Planning' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(mutate).toHaveBeenCalledWith(
      {
        intent: 'event',
        title: 'Planning',
        startsAt: '2026-08-10T17:00:00Z',
        endsAt: '2026-08-10T18:00:00Z',
        timezone: 'America/Los_Angeles',
      },
      expect.any(Object),
    );
  });

  it('binds a created block to any selected regular place', async () => {
    render(
      <CreateBlockForm
        presentation="agenda"
        displayTimezone="America/Los_Angeles"
        selection={SELECTION}
        workPlaces={[LIBRARY]}
      />,
    );
    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'Research' } });
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    fireEvent.change(screen.getByLabelText('Saved place'), { target: { value: LIBRARY_ID } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Research',
        workPlaceId: LIBRARY_ID,
        location: 'Eastside library',
      }),
      expect.any(Object),
    );
  });

  it('searches time zones by code and applies independent start/end zones', async () => {
    render(
      <CreateBlockForm
        presentation="agenda"
        displayTimezone="America/Los_Angeles"
        selection={SELECTION}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: /Edit schedule/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Time zone' }));
    const zoneDialog = screen.getByRole('dialog', { name: 'Event time zone' });
    fireEvent.click(within(zoneDialog).getByLabelText('Use separate start and end time zones'));
    fireEvent.click(within(zoneDialog).getByRole('button', { name: /Ends/ }));
    fireEvent.change(within(zoneDialog).getByLabelText('Search time zones'), {
      target: { value: 'America/New_York' },
    });
    const search = within(zoneDialog).getByRole('combobox', { name: 'Search time zones' });
    expect(search).toHaveAttribute('aria-controls');
    const newYork = within(zoneDialog).getByRole('option', { name: /New York/ });
    await waitFor(() => {
      expect(search).toHaveAttribute('aria-activedescendant', newYork.id);
    });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(newYork).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(within(zoneDialog).getByRole('button', { name: 'OK' }));
    fireEvent.change(screen.getByLabelText('End time'), { target: { value: '14:00' } });

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Remote handoff' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        timezone: 'America/Los_Angeles',
        endTimezone: 'America/New_York',
      }),
      expect.any(Object),
    );
  });

  it('creates an all-day selection through the same mutation boundary', async () => {
    render(
      <CreateBlockForm
        presentation="agenda"
        displayTimezone="UTC"
        selection={{ allDayStartDate: '2026-08-10', allDayEndDate: '2026-08-11' }}
      />,
    );
    expect(screen.getByRole('button', { name: /Edit schedule/ })).toHaveTextContent('All day');
    fireEvent.click(screen.getByRole('button', { name: /Edit schedule/ }));
    expect(screen.getByLabelText('All day')).toBeChecked();
    expect(screen.queryByRole('button', { name: 'Time zone' })).not.toBeInTheDocument();
    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'Holiday' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(mutate).toHaveBeenCalledWith(
      {
        intent: 'event',
        title: 'Holiday',
        allDayStartDate: '2026-08-10',
        allDayEndDate: '2026-08-11',
      },
      expect.any(Object),
    );
  });

  it('keeps mutation failures outside the dialog while retaining the draft', async () => {
    const result = render(
      <CreateBlockForm presentation="agenda" displayTimezone="UTC" selection={SELECTION} />,
    );
    fireEvent.change(await screen.findByLabelText('Title'), {
      target: { value: 'Retained draft' },
    });
    mutationState.isError = true;
    result.rerender(
      <CreateBlockForm presentation="agenda" displayTimezone="UTC" selection={SELECTION} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Your draft is still open');
    expect(screen.getByRole('dialog')).not.toContainElement(screen.getByRole('status'));
    expect(screen.getByLabelText('Title')).toHaveValue('Retained draft');
  });

  it('consumes the selected region only after persistence succeeds', async () => {
    const onSelectionConsumed = vi.fn();
    render(
      <CreateBlockForm
        presentation="agenda"
        displayTimezone="UTC"
        selection={SELECTION}
        onSelectionConsumed={onSelectionConsumed}
      />,
    );
    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'Saved' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const focusTarget = document.createElement('button');
    focusTarget.dataset['scheduleItemBody'] = 'saved-item';
    document.body.append(focusTarget);
    const options = mutate.mock.calls[0]?.[1] as {
      readonly onSuccess: (item: { readonly id: string }) => void;
    };
    act(() => {
      options.onSuccess({ id: 'saved-item' });
    });
    expect(onSelectionConsumed).toHaveBeenCalledOnce();
  });

  it('keeps an edited draft open until discard is confirmed', async () => {
    const confirm = vi
      .spyOn(window, 'confirm')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const onSelectionConsumed = vi.fn();
    render(
      <CreateBlockForm
        presentation="agenda"
        displayTimezone="UTC"
        selection={SELECTION}
        onSelectionConsumed={onSelectionConsumed}
      />,
    );
    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'Keep me' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('dialog', { name: 'Create calendar item' })).toBeInTheDocument();
    expect(onSelectionConsumed).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: 'Create calendar item' }),
      ).not.toBeInTheDocument();
    });
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(onSelectionConsumed).toHaveBeenCalledOnce();
  });
});
