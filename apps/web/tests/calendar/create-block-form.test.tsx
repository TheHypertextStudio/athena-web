import '@testing-library/jest-dom/vitest';

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

import CreateBlockForm from '../../src/components/calendar/create-block-form';

afterEach(() => {
  cleanup();
  mutate.mockReset();
  mutationState.isError = false;
  reset.mockReset().mockImplementation(() => {
    mutationState.isError = false;
  });
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
    expect(screen.getByRole('dialog', { name: 'Create calendar item' })).toBeInTheDocument();
    expect(screen.getByLabelText('Starts')).toHaveValue('2026-07-01T22:00');
    expect(screen.getByLabelText('Ends')).toHaveValue('2026-07-01T22:30');
  });

  it('chooses the later future occurrence when rounding inside a repeated hour', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-01T09:10:00Z'));
    render(<CreateBlockForm displayTimezone="America/Los_Angeles" />);

    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    expect(screen.getByLabelText('Starts')).toHaveValue('2026-11-01T01:30');
    expect(screen.getByRole('button', { name: 'Later · PST' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
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

  it('shows and submits a selected region without changing its instants, then consumes it', async () => {
    const onSelectionConsumed = vi.fn();
    render(
      <CreateBlockForm
        displayTimezone="America/Los_Angeles"
        selection={{
          startsAt: '2026-11-01T09:30:00.000Z',
          endsAt: '2026-11-01T10:30:00.000Z',
        }}
        onSelectionConsumed={onSelectionConsumed}
      />,
    );

    expect(await screen.findByLabelText('Starts')).toHaveValue('2026-11-01T01:30');
    expect(screen.getByLabelText('Ends')).toHaveValue('2026-11-01T02:30');
    expect(screen.getByRole('button', { name: 'Later · PST' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
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
    const mutationOptions = mutate.mock.calls[0]![1] as { readonly onSuccess: () => void };
    act(() => {
      mutationOptions.onSuccess();
    });
    expect(onSelectionConsumed).toHaveBeenCalledOnce();
  });

  it('anchors a selected-region editor to the region and consumes it when dismissed', async () => {
    const anchor = document.createElement('div');
    const getBoundingClientRect = vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue({
      x: 240,
      y: 160,
      top: 160,
      right: 500,
      bottom: 220,
      left: 240,
      width: 260,
      height: 60,
      toJSON: () => ({}),
    });
    const onSelectionConsumed = vi.fn();

    render(
      <CreateBlockForm
        displayTimezone="UTC"
        selection={{
          startsAt: '2026-07-01T01:40:00.000Z',
          endsAt: '2026-07-01T02:40:00.000Z',
        }}
        selectionAnchorRef={{ current: anchor }}
        onSelectionConsumed={onSelectionConsumed}
      />,
    );

    expect(await screen.findByLabelText('Title')).toBeInTheDocument();
    await waitFor(() => {
      expect(getBoundingClientRect).toHaveBeenCalled();
    });

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(onSelectionConsumed).toHaveBeenCalledOnce();
    });
  });

  it('requires and applies an explicit occurrence for an edited repeated start', async () => {
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
    const occurrence = screen.getByRole('group', { name: 'Starts occurrence' });
    expect(within(occurrence).getByRole('button', { name: 'Earlier · PDT' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(within(occurrence).getByRole('button', { name: 'Later · PST' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    fireEvent.change(screen.getByPlaceholderText('Event title'), {
      target: { value: 'Ambiguous planning' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create event' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Choose Earlier or Later for the repeated start time.',
    );
    expect(mutate).not.toHaveBeenCalled();

    fireEvent.click(within(occurrence).getByRole('button', { name: 'Later · PST' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create event' }));

    expect(mutate).toHaveBeenCalledWith(
      {
        intent: 'event',
        title: 'Ambiguous planning',
        startsAt: '2026-11-01T09:30:00Z',
        endsAt: '2026-11-01T10:30:00.000Z',
      },
      expect.any(Object),
    );
  });

  it('keeps a skipped edited time invalid without offering occurrence choices', async () => {
    render(
      <CreateBlockForm
        displayTimezone="America/Los_Angeles"
        selection={{
          startsAt: '2026-03-08T09:30:00.000Z',
          endsAt: '2026-03-08T11:00:00.000Z',
        }}
      />,
    );

    fireEvent.change(await screen.findByLabelText('Starts'), {
      target: { value: '2026-03-08T02:30' },
    });
    expect(screen.queryByRole('group', { name: 'Starts occurrence' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Event title'), {
      target: { value: 'Skipped planning' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create event' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'That start time does not exist because clocks change.',
    );
    expect(mutate).not.toHaveBeenCalled();
  });

  it.each([
    ['zero-length', '2026-07-01T16:00', '2026-07-01T16:00'],
    ['reversed', '2026-07-01T17:00', '2026-07-01T16:00'],
  ])('rejects a %s timed range with an accessible inline error', async (_label, start, end) => {
    render(
      <CreateBlockForm
        displayTimezone="UTC"
        selection={{
          startsAt: '2026-07-01T16:00:00.000Z',
          endsAt: '2026-07-01T17:00:00.000Z',
        }}
      />,
    );

    const startInput = await screen.findByLabelText('Starts');
    const endInput = screen.getByLabelText('Ends');
    fireEvent.change(startInput, { target: { value: start } });
    fireEvent.change(endInput, { target: { value: end } });
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Invalid range' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create event' }));

    const error = screen.getByRole('alert');
    expect(error).toHaveTextContent('End must be after start.');
    expect(startInput).toHaveAttribute('aria-invalid', 'true');
    expect(endInput).toHaveAttribute('aria-invalid', 'true');
    expect(startInput).toHaveAttribute('aria-describedby', error.id);
    expect(endInput).toHaveAttribute('aria-describedby', error.id);
    expect(mutate).not.toHaveBeenCalled();
  });

  it('starts a clean create flow after the user dismisses a draft', async () => {
    render(<CreateBlockForm displayTimezone="UTC" />);

    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Abandoned draft' } });
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByLabelText('Title')).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    expect(screen.getByLabelText('Title')).toHaveValue('');
    expect(reset).toHaveBeenCalled();
  });

  it('clears a failed mutation before the next create flow', async () => {
    const result = render(<CreateBlockForm displayTimezone="UTC" />);
    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Failed draft' } });
    mutationState.isError = true;
    result.rerender(<CreateBlockForm displayTimezone="UTC" />);
    expect(screen.getByText('Could not create this calendar item. Try again.')).toBeInTheDocument();

    reset.mockClear();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByLabelText('Title')).not.toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'New' }));

    expect(screen.getByLabelText('Title')).toHaveValue('');
    expect(
      screen.queryByText('Could not create this calendar item. Try again.'),
    ).not.toBeInTheDocument();
    expect(reset).toHaveBeenCalled();
  });

  it('hydrates an untouched item type when preferences arrive late', async () => {
    const result = render(<CreateBlockForm displayTimezone="UTC" />);
    fireEvent.click(screen.getByRole('button', { name: 'New' }));

    result.rerender(
      <CreateBlockForm displayTimezone="UTC" preferences={{ defaultCreateIntent: 'timebox' }} />,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'timebox' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });
  });

  it('preserves a user-selected item type when preferences arrive late', async () => {
    const result = render(<CreateBlockForm displayTimezone="UTC" />);
    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    fireEvent.click(screen.getByRole('button', { name: 'timebox' }));

    result.rerender(
      <CreateBlockForm displayTimezone="UTC" preferences={{ defaultCreateIntent: 'event' }} />,
    );

    expect(screen.getByRole('button', { name: 'timebox' })).toHaveAttribute('aria-pressed', 'true');
  });
});
