/** The Focus interruption handoff is a receipt, never a conversation. */
import '@testing-library/jest-dom/vitest';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FocusAthenaTransport } from '@/components/time-tracking/focus-athena-handoff';
import type { PersonalAthenaSessionDetail } from '@/lib/athena/presentation';
import { assertDefined } from '@docket/test-utils';

const { default: FocusAthenaHandoff, FOCUS_ATHENA_HANDOFF_KEY } =
  await import('@/components/time-tracking/focus-athena-handoff');

/** A personal work response carrying deliberately forbidden transcript/provider copy. */
function detail(status: PersonalAthenaSessionDetail['status']): PersonalAthenaSessionDetail {
  return {
    id: 'athena_1',
    objective: 'Create a dentist appointment',
    status,
    workspace: { id: 'personal_1', name: 'Personal' },
    context: { workspaceId: 'personal_1', workspaceName: 'Personal' },
    createdAt: '2026-08-09T12:00:00.000Z',
    updatedAt: '2026-08-09T12:00:00.000Z',
    decision:
      status === 'awaiting_input'
        ? {
            kind: 'question',
            id: 'decision_1',
            title: 'Which dentist?',
            options: [],
          }
        : null,
    activities: [
      {
        id: 'activity_1',
        type: 'message',
        author: 'athena',
        text: 'Raw provider reply that Focus must never render',
        createdAt: '2026-08-09T12:00:00.000Z',
      },
    ],
    result: {
      title: 'Provider result',
      summary: 'Raw provider result that Focus must never render',
    },
  };
}

function renderHandoff(status: PersonalAthenaSessionDetail['status']) {
  const created = detail(status);
  const transport: FocusAthenaTransport = {
    create: vi.fn(async () => ({ ok: true, status: 200, json: async () => created })),
    detail: vi.fn(async () => ({ ok: true, status: 200, json: async () => created })),
  };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <FocusAthenaHandoff transport={transport} />
    </QueryClientProvider>,
  );
  return transport;
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.useRealTimers();
});

describe('FocusAthenaHandoff', () => {
  it('hands an interruption to Personal without active task or workspace context', async () => {
    const transport = renderHandoff('running');
    const field = screen.getByRole('textbox', { name: 'Hand something to Athena' });
    fireEvent.change(field, {
      target: { value: 'I just remembered I need to create a dentist appointment' },
    });
    fireEvent.submit(assertDefined(field.closest('form')));

    await waitFor(() => {
      expect(transport.create).toHaveBeenCalledWith({
        prompt: 'I just remembered I need to create a dentist appointment',
      });
    });
    expect(await screen.findByText('Athena is handling it.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hand to Athena' })).toHaveClass('size-10');
  });

  it('stops polling when a storage-restored handoff reaches a terminal state', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    window.localStorage.setItem(FOCUS_ATHENA_HANDOFF_KEY, 'athena_1');
    const completed = detail('completed');
    const transport: FocusAthenaTransport = {
      create: vi.fn(async () => ({ ok: true, status: 200, json: async () => completed })),
      detail: vi.fn(async () => ({ ok: true, status: 200, json: async () => completed })),
    };
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <FocusAthenaHandoff transport={transport} />
      </QueryClientProvider>,
    );

    await vi.waitFor(() => {
      expect(transport.detail).toHaveBeenCalledTimes(1);
    });
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000);
    });
    expect(transport.detail).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['completed', 'Handled in Personal.'],
    ['awaiting_input', 'Needs one detail.'],
    ['awaiting_approval', 'Needs one detail.'],
    ['failed', 'Athena could not finish it.'],
    ['canceled', 'Athena stopped handling it.'],
  ] as const)('maps %s to a minimal action receipt', async (status, receipt) => {
    renderHandoff(status);
    const field = screen.getByRole('textbox', { name: 'Hand something to Athena' });
    fireEvent.change(field, { target: { value: 'Remember this' } });
    fireEvent.submit(assertDefined(field.closest('form')));

    expect(await screen.findByText(receipt)).toBeInTheDocument();
    expect(screen.queryByText(/Raw provider/)).toBeNull();
    if (status === 'awaiting_input' || status === 'awaiting_approval') {
      expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute(
        'href',
        '/athena?session=athena_1',
      );
    }
  });
});
