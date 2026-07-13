import '@testing-library/jest-dom/vitest';

import { CalendarItemId, type CalendarItemOut, CalendarLayerId } from '@docket/types';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { mutate } = vi.hoisted(() => ({ mutate: vi.fn() }));

vi.mock('../../src/components/calendar/calendar-mutations', () => ({
  useUpdateCalendarItem: () => ({ mutate, isPending: false, isError: false }),
}));

import { CoreFieldsForm } from '../../src/components/calendar/item-drawer/core-fields-form';

const ITEM_ID = CalendarItemId.parse('01BX5ZZKBKACTAV9WEVGEMMVS1');
const LAYER_ID = CalendarLayerId.parse('01BX5ZZKBKACTAV9WEVGEMMVN1');

/** Calendar item fixture focused on core-field range editing. */
function calendarItem(overrides: Partial<CalendarItemOut> = {}): CalendarItemOut {
  return {
    id: ITEM_ID,
    layerId: LAYER_ID,
    connectionId: null,
    kind: 'native_block',
    provider: null,
    externalCalendarId: null,
    externalEventId: null,
    recurringEventId: null,
    recurrenceInstanceKey: null,
    status: 'confirmed',
    title: 'Design review',
    description: null,
    location: null,
    htmlLink: null,
    startsAt: '2026-07-01T16:00:00.000Z',
    endsAt: '2026-07-01T17:00:00.000Z',
    allDayStartDate: null,
    allDayEndDate: null,
    timezone: null,
    organizer: null,
    attendees: [],
    permissions: { canEditCore: true, canDelete: true, readOnlyReason: null },
    syncState: 'clean',
    hasConflict: false,
    updatedExternalAt: null,
    archivedAt: null,
    linkedTasks: [],
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  mutate.mockReset();
});

describe('CoreFieldsForm range validation', () => {
  it('requires and persists an explicit occurrence for an edited repeated start', () => {
    render(
      <CoreFieldsForm
        displayTimezone="America/Los_Angeles"
        item={calendarItem({
          startsAt: '2026-11-01T07:30:00.000Z',
          endsAt: '2026-11-01T10:30:00.000Z',
        })}
      />,
    );

    fireEvent.change(screen.getByLabelText('Starts'), {
      target: { value: '2026-11-01T01:30' },
    });
    const occurrence = screen.getByRole('group', { name: 'Starts occurrence' });
    expect(within(occurrence).getByRole('button', { name: 'Earlier · PDT' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(within(occurrence).getByRole('button', { name: 'Later · PST' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Choose Earlier or Later for the repeated start time.',
    );
    expect(mutate).not.toHaveBeenCalled();

    fireEvent.click(within(occurrence).getByRole('button', { name: 'Later · PST' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(mutate).toHaveBeenCalledWith({
      title: 'Design review',
      description: '',
      location: '',
      startsAt: '2026-11-01T09:30:00Z',
      endsAt: '2026-11-01T10:30:00.000Z',
    });
  });

  it.each([
    ['zero-length', '2026-07-01T16:00', '2026-07-01T16:00'],
    ['reversed', '2026-07-01T17:00', '2026-07-01T16:00'],
  ])('rejects a %s timed range before mutation', (_label, start, end) => {
    render(<CoreFieldsForm displayTimezone="UTC" item={calendarItem()} />);
    const startInput = screen.getByLabelText('Starts');
    const endInput = screen.getByLabelText('Ends');

    fireEvent.change(startInput, { target: { value: start } });
    fireEvent.change(endInput, { target: { value: end } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    const error = screen.getByRole('alert');
    expect(error).toHaveTextContent('End must be after start.');
    expect(startInput).toHaveAttribute('aria-invalid', 'true');
    expect(endInput).toHaveAttribute('aria-invalid', 'true');
    expect(startInput).toHaveAttribute('aria-describedby', error.id);
    expect(endInput).toHaveAttribute('aria-describedby', error.id);
    expect(mutate).not.toHaveBeenCalled();
  });

  it.each([
    ['zero-length', '2026-07-10', '2026-07-09'],
    ['reversed', '2026-07-10', '2026-07-08'],
  ])('rejects a %s all-day range before mutation', (_label, start, end) => {
    render(
      <CoreFieldsForm
        displayTimezone="UTC"
        item={calendarItem({
          startsAt: null,
          endsAt: null,
          allDayStartDate: '2026-07-10',
          allDayEndDate: '2026-07-11',
        })}
      />,
    );
    const startInput = screen.getByLabelText('Starts');
    const endInput = screen.getByLabelText('Ends');

    fireEvent.change(startInput, { target: { value: start } });
    fireEvent.change(endInput, { target: { value: end } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    const error = screen.getByRole('alert');
    expect(error).toHaveTextContent('End must be after start.');
    expect(startInput).toHaveAttribute('aria-invalid', 'true');
    expect(endInput).toHaveAttribute('aria-invalid', 'true');
    expect(startInput).toHaveAttribute('aria-describedby', error.id);
    expect(endInput).toHaveAttribute('aria-describedby', error.id);
    expect(mutate).not.toHaveBeenCalled();
  });
});

describe('CoreFieldsForm refetch hydration', () => {
  it('preserves an edited repeated occurrence while hydrating a different exact seed', () => {
    const view = render(
      <CoreFieldsForm
        displayTimezone="America/Los_Angeles"
        item={calendarItem({
          startsAt: '2026-11-01T09:30:00.000Z',
          endsAt: '2026-11-01T10:30:00.000Z',
        })}
      />,
    );

    fireEvent.change(screen.getByLabelText('Starts'), {
      target: { value: '2026-11-01T01:15' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Later · PST' }));

    view.rerender(
      <CoreFieldsForm
        displayTimezone="America/Los_Angeles"
        item={calendarItem({
          startsAt: '2026-11-01T08:45:00.000Z',
          endsAt: '2026-11-01T11:00:00.000Z',
        })}
      />,
    );

    expect(screen.getByLabelText('Starts')).toHaveValue('2026-11-01T01:15');
    expect(screen.getByRole('button', { name: 'Later · PST' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByLabelText('Ends')).toHaveValue('2026-11-01T03:00');
  });

  it('hydrates untouched timed fields without reporting unsaved changes', () => {
    const onDirtyChange = vi.fn();
    const view = render(
      <CoreFieldsForm displayTimezone="UTC" item={calendarItem()} onDirtyChange={onDirtyChange} />,
    );
    onDirtyChange.mockClear();

    view.rerender(
      <CoreFieldsForm
        displayTimezone="UTC"
        item={calendarItem({
          title: 'Server title',
          description: 'Server description',
          location: 'Server room',
          startsAt: '2026-07-01T18:00:00.000Z',
          endsAt: '2026-07-01T19:30:00.000Z',
        })}
        onDirtyChange={onDirtyChange}
      />,
    );

    expect(screen.getByLabelText('Title')).toHaveValue('Server title');
    expect(screen.getByLabelText('Description')).toHaveValue('Server description');
    expect(screen.getByLabelText('Location')).toHaveValue('Server room');
    expect(screen.getByLabelText('Starts')).toHaveValue('2026-07-01T18:00');
    expect(screen.getByLabelText('Ends')).toHaveValue('2026-07-01T19:30');
    expect(onDirtyChange).not.toHaveBeenCalledWith(true);
  });

  it('hydrates untouched all-day dates without reporting unsaved changes', () => {
    const onDirtyChange = vi.fn();
    const allDayItem = calendarItem({
      startsAt: null,
      endsAt: null,
      allDayStartDate: '2026-07-10',
      allDayEndDate: '2026-07-11',
    });
    const view = render(
      <CoreFieldsForm displayTimezone="UTC" item={allDayItem} onDirtyChange={onDirtyChange} />,
    );
    onDirtyChange.mockClear();

    view.rerender(
      <CoreFieldsForm
        displayTimezone="UTC"
        item={calendarItem({
          startsAt: null,
          endsAt: null,
          allDayStartDate: '2026-07-12',
          allDayEndDate: '2026-07-15',
        })}
        onDirtyChange={onDirtyChange}
      />,
    );

    expect(screen.getByLabelText('Starts')).toHaveValue('2026-07-12');
    expect(screen.getByLabelText('Ends')).toHaveValue('2026-07-14');
    expect(onDirtyChange).not.toHaveBeenCalledWith(true);
  });

  it('preserves edited fields while hydrating untouched fields from the server', () => {
    const view = render(<CoreFieldsForm displayTimezone="UTC" item={calendarItem()} />);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Local title' } });
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: 'Local description' },
    });
    fireEvent.change(screen.getByLabelText('Starts'), {
      target: { value: '2026-07-01T15:30' },
    });

    view.rerender(
      <CoreFieldsForm
        displayTimezone="UTC"
        item={calendarItem({
          title: 'Server title',
          description: 'Server description',
          location: 'Server room',
          startsAt: '2026-07-01T18:00:00.000Z',
          endsAt: '2026-07-01T19:30:00.000Z',
        })}
      />,
    );

    expect(screen.getByLabelText('Title')).toHaveValue('Local title');
    expect(screen.getByLabelText('Description')).toHaveValue('Local description');
    expect(screen.getByLabelText('Location')).toHaveValue('Server room');
    expect(screen.getByLabelText('Starts')).toHaveValue('2026-07-01T15:30');
    expect(screen.getByLabelText('Ends')).toHaveValue('2026-07-01T19:30');
  });
});
