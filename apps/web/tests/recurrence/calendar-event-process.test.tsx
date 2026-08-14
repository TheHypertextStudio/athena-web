/** Calendar item UI uses explicit event language to bind reusable process work. */
import type { CalendarItemOut } from '@docket/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const apiCalls = vi.hoisted(() => ({
  list: vi.fn(),
  bind: vi.fn(),
}));

vi.mock('../../src/components/active-org', () => ({
  useActiveOrg: () => ({
    activeOrgId: '01BX5ZZKBKACTAV9WEVGEMMVRC',
    orgs: [{ id: '01BX5ZZKBKACTAV9WEVGEMMVRC', name: 'LVBT' }],
  }),
}));

vi.mock('../../src/components/create-object/create-object-provider', () => ({
  useCreateObject: () => ({ openCreate: vi.fn() }),
}));

vi.mock('../../src/lib/api', () => ({
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

import { LinkedTasksSection } from '../../src/components/calendar/item-drawer/linked-tasks-section';
import { assertDefined } from '@docket/test-utils';

afterEach(() => {
  cleanup();
  apiCalls.list.mockReset();
  apiCalls.bind.mockReset();
});

function response(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function calendarItem(recurringEventId: string | null): CalendarItemOut {
  return {
    id: '01BX5ZZKBKACTAV9WEVGEMMVRA',
    layerId: '01BX5ZZKBKACTAV9WEVGEMMVRD',
    recurringEventId,
    title: 'Transit meetup',
    linkedTasks: [],
  } as unknown as CalendarItemOut;
}

describe('calendar event process setup', () => {
  it('adds reusable work to every occurrence without exposing process terminology', async () => {
    apiCalls.list.mockResolvedValue(
      response({
        items: [
          {
            id: '01BX5ZZKBKACTAV9WEVGEMMVRB',
            organizationId: '01BX5ZZKBKACTAV9WEVGEMMVRC',
            name: 'Meetup event work',
            description: null,
            status: 'published',
            latestRevisionNumber: 1,
            createdAt: '2026-08-12T00:00:00.000Z',
            updatedAt: '2026-08-12T00:00:00.000Z',
          },
        ],
      }),
    );
    const binding = {
      id: 'binding-1',
      organizationId: '01BX5ZZKBKACTAV9WEVGEMMVRC',
      calendarItemId: '01BX5ZZKBKACTAV9WEVGEMMVRA',
      calendarLayerId: '01BX5ZZKBKACTAV9WEVGEMMVRD',
      externalSeriesId: 'provider-meetups',
      scope: 'event_series',
      processDefinitionId: '01BX5ZZKBKACTAV9WEVGEMMVRB',
      recurrenceSeriesId: '01BX5ZZKBKACTAV9WEVGEMMVRE',
      seriesName: 'Transit meetup work',
      createdAt: '2026-08-12T00:00:00.000Z',
    };
    apiCalls.bind.mockImplementation(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(binding) }),
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <LinkedTasksSection item={calendarItem('provider-meetups')} onOpenTask={vi.fn()} />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add tasks for each event' }));
    expect(
      await screen.findByText(
        'Choose the reusable work Docket should create for this event and each future occurrence.',
      ),
    ).toBeTruthy();
    expect(await screen.findByRole('option', { name: 'Meetup event work' })).toBeTruthy();

    const submit = assertDefined(
      screen.getAllByRole('button', { name: 'Add tasks for each event' }).at(-1),
    );
    expect((submit as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(submit);

    await waitFor(() => {
      expect(apiCalls.bind).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText('Tasks will be added for each event.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Manage repeating work' }).getAttribute('href')).toBe(
      '/orgs/01BX5ZZKBKACTAV9WEVGEMMVRC/recurrence-series/01BX5ZZKBKACTAV9WEVGEMMVRE',
    );
    expect(apiCalls.bind).toHaveBeenCalledWith({
      param: { orgId: '01BX5ZZKBKACTAV9WEVGEMMVRC' },
      json: {
        calendarItemId: '01BX5ZZKBKACTAV9WEVGEMMVRA',
        processDefinitionId: '01BX5ZZKBKACTAV9WEVGEMMVRB',
      },
    });
    expect(screen.queryByText(/attach process/i)).toBeNull();
  });

  it('uses singular event language for a one-off calendar item', () => {
    apiCalls.list.mockResolvedValue(response({ items: [] }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <LinkedTasksSection item={calendarItem(null)} onOpenTask={vi.fn()} />
      </QueryClientProvider>,
    );

    expect(screen.getByRole('button', { name: 'Plan work around this event' })).toBeTruthy();
  });
});
