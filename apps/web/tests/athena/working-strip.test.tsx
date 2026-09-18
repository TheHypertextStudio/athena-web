import '@testing-library/jest-dom/vitest';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AthenaWorkingStrip } from '../../src/components/athena/athena-working-strip';
import type {
  PersonalAthenaDecision,
  PersonalAthenaSessionDetail,
  PersonalAthenaSessionSummary,
} from '../../src/lib/athena/presentation';
import type { PersonalAthenaTransport } from '../../src/lib/athena/query-defs';
import { okResponse } from '../support/query';

function job(overrides: Partial<PersonalAthenaSessionSummary> = {}): PersonalAthenaSessionSummary {
  return {
    id: 'session_1',
    objective: 'Protect two hours for the launch review',
    status: 'running',
    queueState: 'working',
    workspace: { id: 'workspace_1', name: 'Hypertext Studio' },
    createdAt: '2026-07-15T15:00:00.000Z',
    updatedAt: '2026-07-15T16:00:00.000Z',
    ...overrides,
  };
}

function detailWith(
  overrides: Partial<PersonalAthenaSessionDetail> = {},
): PersonalAthenaSessionDetail {
  return { ...job(), activities: [], ...overrides };
}

function transportFor(detail: PersonalAthenaSessionDetail): PersonalAthenaTransport {
  return {
    pulse: vi.fn(),
    queue: vi.fn(),
    detail: vi.fn().mockResolvedValue(okResponse(detail)),
    activity: vi.fn(),
    create: vi.fn(),
    sendMessage: vi.fn(),
    decide: vi.fn().mockResolvedValue(okResponse(detail)),
    lifecycle: vi.fn(),
    undoChange: vi.fn(),
  };
}

function renderStrip(
  jobs: readonly PersonalAthenaSessionSummary[],
  detail: PersonalAthenaSessionDetail,
  onOpen: (jobId: string) => void = vi.fn(),
): PersonalAthenaTransport {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const api = transportFor(detail);
  render(
    <QueryClientProvider client={client}>
      <AthenaWorkingStrip jobs={jobs} transport={api} onOpen={onOpen} />
    </QueryClientProvider>,
  );
  return api;
}

afterEach(() => {
  cleanup();
});

describe('AthenaWorkingStrip', () => {
  it('renders nothing when no job is running or waiting', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={client}>
        <AthenaWorkingStrip
          jobs={[job({ status: 'completed', queueState: 'finished' })]}
          onOpen={vi.fn()}
        />
      </QueryClientProvider>,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('shows a trigger naming the count and every open job as a row', async () => {
    renderStrip(
      [
        job({ id: 'session_1', status: 'running' }),
        job({ id: 'session_2', status: 'awaiting_approval', queueState: 'needs_you' }),
      ],
      detailWith(),
    );

    expect(screen.getByRole('button', { name: /Working · 2/ })).toBeVisible();
    expect(await screen.findAllByText('Protect two hours for the launch review')).toHaveLength(2);
  });

  it('shows two decide buttons on an attention row with a pending approval and calls decide', async () => {
    const decision: PersonalAthenaDecision = {
      kind: 'approval',
      id: 'proposal_1',
      title: 'Move the launch review',
      options: [
        { id: 'approve', label: 'Approve' },
        { id: 'reject', label: 'Keep current time' },
      ],
    };
    const api = renderStrip(
      [job({ id: 'session_1', status: 'awaiting_approval', queueState: 'needs_you' })],
      detailWith({
        id: 'session_1',
        status: 'awaiting_approval',
        queueState: 'needs_you',
        decision,
      }),
    );

    expect(await screen.findByRole('button', { name: 'Keep current time' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    await waitFor(() => {
      expect(api.decide).toHaveBeenCalledWith('session_1', 'proposal_1', 'approve');
    });
  });

  it('does not fetch detail for a merely running row', () => {
    const api = renderStrip([job({ id: 'session_1', status: 'running' })], detailWith());

    expect(api.detail).not.toHaveBeenCalled();
  });

  it('calls onOpen with the job id when a row is clicked', async () => {
    const onOpen = vi.fn();
    renderStrip(
      [job({ id: 'session_9', status: 'running' })],
      detailWith({ id: 'session_9' }),
      onOpen,
    );

    fireEvent.click(await screen.findByRole('button', { name: /Protect two hours/ }));

    expect(onOpen).toHaveBeenCalledWith('session_9');
  });
});
