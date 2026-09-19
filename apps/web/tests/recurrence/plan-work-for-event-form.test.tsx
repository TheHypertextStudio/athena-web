import '@testing-library/jest-dom/vitest';

import type { CalendarItemOut } from '@docket/planning/calendar-contract';
import { Toaster, dismissAllNotices } from '@docket/ui/components';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { okResponse, problemResponse } from '../support/query';

const ORG_ID = '01BX5ZZKBKACTAV9WEVGEMMVRC';

const apiCalls = vi.hoisted(() => ({
  list: vi.fn(),
  bind: vi.fn(),
}));

vi.mock('@/components/active-org', () => ({
  useActiveOrg: () => ({
    activeOrgId: '01BX5ZZKBKACTAV9WEVGEMMVRC',
    orgs: [{ id: '01BX5ZZKBKACTAV9WEVGEMMVRC', name: 'LVBT' }],
  }),
}));

vi.mock('@/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        ':orgId': {
          'process-definitions': { $get: apiCalls.list },
          'recurrence-series': { 'calendar-bindings': { $post: apiCalls.bind } },
        },
      },
    },
  },
}));

import { PlanWorkForEventForm } from '@/components/recurrence/plan-work-for-event-form';

const ITEM = {
  id: 'CAL00000000000000000000001',
  recurringEventId: null,
} as unknown as CalendarItemOut;

const DEFINITION = {
  id: 'PDF00000000000000000000001',
  organizationId: ORG_ID,
  name: 'Workshop prep',
};

afterEach(() => {
  dismissAllNotices();
  cleanup();
  apiCalls.list.mockReset();
  apiCalls.bind.mockReset();
});

/** The form under a fresh retry-free query client, with the notice stack mounted. */
function renderForm(): JSX.Element {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={client}>
      <PlanWorkForEventForm item={ITEM} onDone={vi.fn()} />
      <Toaster />
    </QueryClientProvider>
  );
}

describe('PlanWorkForEventForm', () => {
  it('keeps the form usable and offers a retry when reusable work could not load', async () => {
    apiCalls.list.mockResolvedValueOnce(problemResponse('server detail', 500, 'internal'));
    apiCalls.list.mockResolvedValue(okResponse({ items: [DEFINITION] }));
    render(renderForm());

    const alert = await screen.findByRole('alert');
    expect(alert).not.toHaveTextContent(/server detail/);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('option', { name: 'Workshop prep' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('presents a refused binding as a notice and leaves the choice in place', async () => {
    apiCalls.list.mockResolvedValue(okResponse({ items: [DEFINITION] }));
    apiCalls.bind.mockResolvedValue(problemResponse('server detail', 500, 'internal'));
    render(renderForm());

    await screen.findByRole('option', { name: 'Workshop prep' });
    fireEvent.click(screen.getByRole('button', { name: 'Plan work around this event' }));

    await waitFor(() => {
      expect(apiCalls.bind).toHaveBeenCalledTimes(1);
    });
    const alert = await screen.findByRole('alert');
    expect(alert).not.toHaveTextContent(/server detail/);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Plan work around this event' })).toBeEnabled();
  });
});
