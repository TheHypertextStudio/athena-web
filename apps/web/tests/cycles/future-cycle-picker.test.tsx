import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { cyclesGet, ensurePost } = vi.hoisted(() => ({
  cyclesGet: vi.fn(),
  ensurePost: vi.fn(),
}));

vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        ':orgId': {
          cycles: Object.assign({ $get: cyclesGet }, { ensure: { $post: ensurePost } }),
        },
      },
    },
  },
}));

import { FutureCyclePicker } from '../../src/components/pickers/future-cycle-picker';
import { jsonResponse } from '../support/http';

const CYCLES = [
  {
    id: 'current',
    organizationId: 'org',
    teamId: 'team',
    number: 1,
    name: null,
    displayName: 'Sep 14 – Sep 20',
    startsAt: '2026-09-14T00:00:00.000Z',
    endsAt: '2026-09-20T23:59:59.999Z',
    status: 'active',
    isCurrent: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'upcoming',
    organizationId: 'org',
    teamId: 'team',
    number: 2,
    name: null,
    displayName: 'Dec 28 – Jan 3',
    startsAt: '2026-12-28T00:00:00.000Z',
    endsAt: '2027-01-03T23:59:59.999Z',
    status: 'upcoming',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'old',
    organizationId: 'org',
    teamId: 'team',
    number: 0,
    name: null,
    displayName: 'Old cycle',
    startsAt: '2026-08-01T00:00:00.000Z',
    endsAt: '2026-08-07T23:59:59.999Z',
    status: 'completed',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-19T12:00:00.000Z'));
  cyclesGet.mockReset().mockResolvedValue(jsonResponse(true, { items: CYCLES }));
  ensurePost.mockReset().mockResolvedValue(jsonResponse(true, { items: [] }));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderPicker(value: string | null = null, onChange = vi.fn()): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <FutureCyclePicker
        orgId="org"
        teamId="team"
        cadenceDays={7}
        cadenceAnchor="2024-01-01"
        value={value}
        onChange={onChange}
      />
    </QueryClientProvider>,
  );
}

async function openPicker(name: RegExp): Promise<void> {
  const trigger = await screen.findByRole('button', { name });
  await waitFor(() => expect(trigger).toBeEnabled());
  fireEvent.click(trigger);
}

describe('FutureCyclePicker', () => {
  it('ensures through next quarter and groups current and upcoming choices', async () => {
    renderPicker();
    await openPicker(/Cycle — not set/i);
    await waitFor(() => {
      expect(ensurePost).toHaveBeenCalled();
    });
    expect(ensurePost.mock.calls[0]?.[0].json).toMatchObject({
      teamId: 'team',
      throughDate: '2026-12-31',
    });

    const list = screen.getByRole('listbox', { name: 'Cycle' });
    await waitFor(() => expect(list).not.toHaveAttribute('aria-busy', 'true'));
    expect(within(list).getByText('Current')).toBeTruthy();
    expect(within(list).getByText('Upcoming')).toBeTruthy();
    expect(within(list).queryByText('Old cycle')).toBeNull();
    expect(screen.getByRole('button', { name: /Go to date — not set/i })).toBeTruthy();
  });

  it('retains the selected completed cycle as an assigned choice', async () => {
    renderPicker('old');
    await openPicker(/Cycle — Old cycle/i);
    const list = await screen.findByRole('listbox', { name: 'Cycle' });
    expect(within(list).getByText('Assigned')).toBeTruthy();
    expect(within(list).getByText('Old cycle')).toBeTruthy();
  });

  it('reports the selected cycle', async () => {
    const onChange = vi.fn();
    renderPicker(null, onChange);
    await openPicker(/Cycle — not set/i);
    const option = await screen.findByRole('option', { name: /Sep 14 – Sep 20/ });
    fireEvent.click(within(option).getByRole('button'));

    expect(onChange).toHaveBeenCalledWith('current', undefined);
  });

  it('keeps loaded choices and shows application copy when generation fails', async () => {
    ensurePost.mockResolvedValue(jsonResponse(false, { code: 'conflict' }, 409));
    renderPicker();
    await openPicker(/Cycle — not set/i);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not load future cycles. Try again.',
    );
    expect(screen.getByText('Sep 14 – Sep 20')).toBeTruthy();
  });
});
