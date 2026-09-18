import '@testing-library/jest-dom/vitest';

import { Toaster, dismissAllNotices } from '@docket/ui/components';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useAthenaActions } from '../../src/components/athena/use-athena-actions';
import type { PersonalAthenaTransport } from '../../src/lib/athena/query-defs';
import type { PersonalAthenaSessionDetail } from '../../src/lib/athena/presentation';
import type { RpcResponse } from '../../src/lib/query';
import { okResponse, problemResponse } from '../support/query';

const detail: PersonalAthenaSessionDetail = {
  id: 'session_1',
  objective: 'Prepare the review',
  status: 'running',
  queueState: 'working',
  createdAt: '2026-07-16T12:00:00.000Z',
  updatedAt: '2026-07-16T12:01:00.000Z',
  activities: [],
};

function failed<T>(diagnostic: string): RpcResponse<T> {
  return problemResponse(diagnostic, 500);
}

function transport(): PersonalAthenaTransport {
  return {
    pulse: vi.fn().mockResolvedValue(okResponse({ needsYou: 0, working: 1 })),
    queue: vi.fn(),
    detail: vi.fn(),
    activity: vi.fn(),
    create: vi.fn().mockResolvedValue(failed('create provider secret')),
    sendMessage: vi.fn().mockResolvedValue(failed('message provider secret')),
    decide: vi.fn().mockResolvedValue(failed('decision provider secret')),
    lifecycle: vi.fn().mockResolvedValue(failed('lifecycle provider secret')),
    undoChange: vi.fn().mockResolvedValue(failed('undo provider secret')),
  };
}

function Harness({ api }: { readonly api: PersonalAthenaTransport }): JSX.Element {
  const actions = useAthenaActions({ selectedId: detail.id, transport: api, onSelected: vi.fn() });
  return (
    <div>
      <Toaster />
      <button
        type="button"
        onClick={() => {
          actions.create({ prompt: 'Start it' });
        }}
      >
        Create
      </button>
      <button
        type="button"
        onClick={() => {
          actions.sendMessage('Steer it');
        }}
      >
        Message
      </button>
      <button
        type="button"
        onClick={() => {
          actions.decide({ id: 'action_1', option: 'approve' });
        }}
      >
        Decide
      </button>
      <button
        type="button"
        onClick={() => {
          actions.lifecycle('cancel');
        }}
      >
        Lifecycle
      </button>
      <button
        type="button"
        onClick={() => {
          actions.undo('change_1');
        }}
      >
        Undo
      </button>
    </div>
  );
}

afterEach(() => {
  dismissAllNotices();
});

describe('useAthenaActions', () => {
  it('presents every rejected mutation as a notice that carries no provider text', async () => {
    const api = transport();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <Harness api={api} />
      </QueryClientProvider>,
    );

    for (const button of ['Create', 'Message', 'Decide', 'Lifecycle', 'Undo']) {
      fireEvent.click(screen.getByRole('button', { name: button }));
      expect(await screen.findByRole('alert')).not.toHaveTextContent('provider secret');
      dismissAllNotices();
      await waitFor(() => {
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      });
    }
  });

  it('reports no notice when a mutation succeeds', async () => {
    const api = transport();
    vi.mocked(api.sendMessage).mockResolvedValueOnce(okResponse(detail));
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <Harness api={api} />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Message' }));
    await waitFor(() => {
      expect(api.sendMessage).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
