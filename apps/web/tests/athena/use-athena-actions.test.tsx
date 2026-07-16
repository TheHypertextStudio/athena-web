import '@testing-library/jest-dom/vitest';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

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
    create: vi.fn().mockResolvedValue(failed('create provider secret')),
    message: vi.fn().mockResolvedValue(failed('message provider secret')),
    decide: vi.fn().mockResolvedValue(failed('decision provider secret')),
    lifecycle: vi.fn().mockResolvedValue(failed('lifecycle provider secret')),
  };
}

function Harness({ api }: { readonly api: PersonalAthenaTransport }): JSX.Element {
  const actions = useAthenaActions({ selectedId: detail.id, transport: api, onSelected: vi.fn() });
  return (
    <div>
      {actions.feedback ? <p role="alert">{actions.feedback}</p> : null}
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
          actions.message('Steer it');
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
    </div>
  );
}

describe('useAthenaActions', () => {
  it('owns safe feedback for every mutation and clears it on retry success', async () => {
    const api = transport();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <Harness api={api} />
      </QueryClientProvider>,
    );

    for (const [button, copy] of [
      ['Create', 'Athena could not start this work.'],
      ['Message', 'Could not steer this Athena work.'],
      ['Decide', 'Could not record your decision.'],
      ['Lifecycle', 'Could not change this Athena work.'],
    ] as const) {
      fireEvent.click(screen.getByRole('button', { name: button }));
      expect(await screen.findByRole('alert')).toHaveTextContent(copy);
      expect(screen.getByRole('alert')).not.toHaveTextContent('provider secret');
    }

    vi.mocked(api.message).mockResolvedValueOnce(okResponse(detail));
    fireEvent.click(screen.getByRole('button', { name: 'Message' }));
    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });
});
