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
  it('rounds toolbar defaults to the next Hub-zone half hour', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T16:10:00Z'));
    render(<CreateBlockForm displayTimezone="Asia/Kathmandu" rangeKeys={[]} />);

    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    expect(screen.getByLabelText('Starts')).toHaveValue('2026-07-01T22:00');
    expect(screen.getByLabelText('Ends')).toHaveValue('2026-07-01T22:30');
  });

  it('shows and submits a selected region without changing its instants', async () => {
    render(
      <CreateBlockForm
        displayTimezone="America/Los_Angeles"
        rangeKeys={[]}
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
          input: {
            intent: 'event',
            title: 'Tokyo planning',
            startsAt: '2026-11-01T09:30:00.000Z',
            endsAt: '2026-11-01T10:30:00.000Z',
          },
          rangeKeys: [],
        },
        expect.any(Object),
      );
    });
  });
});
