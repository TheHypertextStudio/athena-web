import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { mutate } = vi.hoisted(() => ({ mutate: vi.fn() }));

vi.mock('../../src/components/calendar/calendar-mutations', () => ({
  useCreateCalendarItem: () => ({ mutate, isPending: false, isError: false }),
}));

import CreateBlockForm from '../../src/components/calendar/create-block-form';

afterEach(() => {
  cleanup();
  mutate.mockReset();
  vi.useRealTimers();
});

describe('CreateBlockForm display timezone', () => {
  it('rebases an open untouched toolbar draft and preserves its exact seed instants', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T16:10:00Z'));
    const result = render(<CreateBlockForm displayTimezone="UTC" />);

    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    expect(screen.getByLabelText('Starts')).toHaveValue('2026-07-01T16:30');
    result.rerender(<CreateBlockForm displayTimezone="Asia/Kathmandu" />);
    expect(screen.getByLabelText('Starts')).toHaveValue('2026-07-01T22:15');
    expect(screen.getByLabelText('Ends')).toHaveValue('2026-07-01T22:45');

    fireEvent.change(screen.getByPlaceholderText('Event title'), {
      target: { value: 'Hydrated toolbar draft' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create event' }));
    expect(mutate).toHaveBeenCalledWith(
      {
        intent: 'event',
        title: 'Hydrated toolbar draft',
        startsAt: '2026-07-01T16:30:00Z',
        endsAt: '2026-07-01T17:00:00.000Z',
      },
      expect.any(Object),
    );
  });

  it('preserves an edited selected-region field while rebasing its untouched peer', async () => {
    const selection = {
      startsAt: '2026-07-01T16:00:00.000Z',
      endsAt: '2026-07-01T17:00:00.000Z',
    };
    const result = render(<CreateBlockForm displayTimezone="UTC" selection={selection} />);
    expect(await screen.findByLabelText('Starts')).toHaveValue('2026-07-01T16:00');
    fireEvent.change(screen.getByLabelText('Starts'), {
      target: { value: '2026-07-01T18:00' },
    });

    result.rerender(<CreateBlockForm displayTimezone="Asia/Tokyo" selection={selection} />);
    expect(screen.getByLabelText('Starts')).toHaveValue('2026-07-01T18:00');
    expect(screen.getByLabelText('Ends')).toHaveValue('2026-07-02T02:00');

    fireEvent.change(screen.getByPlaceholderText('Event title'), {
      target: { value: 'Hydrated selection' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create event' }));
    await waitFor(() => {
      expect(mutate).toHaveBeenCalledWith(
        {
          intent: 'event',
          title: 'Hydrated selection',
          startsAt: '2026-07-01T09:00:00Z',
          endsAt: '2026-07-01T17:00:00.000Z',
        },
        expect.any(Object),
      );
    });
  });

  it('rounds toolbar defaults to the next Hub-zone half hour', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T16:10:00Z'));
    render(<CreateBlockForm displayTimezone="Asia/Kathmandu" />);

    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    expect(screen.getByLabelText('Starts')).toHaveValue('2026-07-01T22:00');
    expect(screen.getByLabelText('Ends')).toHaveValue('2026-07-01T22:30');
  });

  it('chooses the later future occurrence when rounding inside a repeated hour', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-01T09:10:00Z'));
    render(<CreateBlockForm displayTimezone="America/Los_Angeles" />);

    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    expect(screen.getByLabelText('Starts')).toHaveValue('2026-11-01T01:30');
    fireEvent.change(screen.getByPlaceholderText('Event title'), {
      target: { value: 'Later fold planning' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create event' }));

    expect(mutate).toHaveBeenCalledWith(
      {
        intent: 'event',
        title: 'Later fold planning',
        startsAt: '2026-11-01T09:30:00Z',
        endsAt: '2026-11-01T10:00:00.000Z',
      },
      expect.any(Object),
    );
  });

  it('shows and submits a selected region without changing its instants', async () => {
    render(
      <CreateBlockForm
        displayTimezone="America/Los_Angeles"
        selection={{
          startsAt: '2026-11-01T09:30:00.000Z',
          endsAt: '2026-11-01T10:30:00.000Z',
        }}
      />,
    );

    expect(await screen.findByLabelText('Starts')).toHaveValue('2026-11-01T01:30');
    expect(screen.getByLabelText('Ends')).toHaveValue('2026-11-01T02:30');
    fireEvent.change(screen.getByPlaceholderText('Event title'), {
      target: { value: 'Tokyo planning' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create event' }));

    await waitFor(() => {
      expect(mutate).toHaveBeenCalledWith(
        {
          intent: 'event',
          title: 'Tokyo planning',
          startsAt: '2026-11-01T09:30:00.000Z',
          endsAt: '2026-11-01T10:30:00.000Z',
        },
        expect.any(Object),
      );
    });
  });

  it('rejects an edited start inside a repeated wall-clock hour', async () => {
    render(
      <CreateBlockForm
        displayTimezone="America/Los_Angeles"
        selection={{
          startsAt: '2026-11-01T07:30:00.000Z',
          endsAt: '2026-11-01T10:30:00.000Z',
        }}
      />,
    );

    expect(await screen.findByLabelText('Starts')).toHaveValue('2026-11-01T00:30');
    fireEvent.change(screen.getByLabelText('Starts'), {
      target: { value: '2026-11-01T01:30' },
    });
    fireEvent.change(screen.getByPlaceholderText('Event title'), {
      target: { value: 'Ambiguous planning' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create event' }));

    expect(
      screen.getByText('Choose valid start and end times in your calendar timezone.'),
    ).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });
});
