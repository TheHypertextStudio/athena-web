import '@testing-library/jest-dom/vitest';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { okResponse } from '../support/query';

import {
  AthenaWorkLedger,
  ledgerFilterOf,
  resolveLedgerFilter,
} from '../../src/components/athena/athena-work-ledger';
import type { PersonalAthenaSessionSummary } from '../../src/lib/athena/presentation';
import type { PersonalAthenaTransport } from '../../src/lib/athena/query-defs';

function job(overrides: Partial<PersonalAthenaSessionSummary> = {}): PersonalAthenaSessionSummary {
  return {
    id: 'session_1',
    objective: 'Protect two hours for the launch review',
    status: 'running',
    queueState: 'working',
    createdAt: '2026-07-15T15:00:00.000Z',
    updatedAt: '2026-07-15T16:00:00.000Z',
    ...overrides,
  };
}

/** A transport whose detail read echoes the summary with no steps. */
function transport(jobs: readonly PersonalAthenaSessionSummary[]): PersonalAthenaTransport {
  return {
    pulse: vi.fn(),
    queue: vi.fn(),
    detail: vi.fn((id: string) =>
      Promise.resolve(
        okResponse({ ...(jobs.find((entry) => entry.id === id) ?? job({ id })), activities: [] }),
      ),
    ),
    activity: vi.fn(),
    create: vi.fn(),
    sendMessage: vi.fn(),
    decide: vi.fn(),
    lifecycle: vi.fn(),
    undoChange: vi.fn(),
    proposals: vi.fn(),
  };
}

function renderWithClient(node: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

afterEach(() => {
  cleanup();
});

describe('AthenaWorkLedger', () => {
  it('shows one tab per lane that has work, with no counts, and entries for the active one', () => {
    const jobs = [
      job({ id: 'running_1', status: 'running', queueState: 'working' }),
      job({ id: 'done_1', status: 'completed', queueState: 'finished' }),
    ];
    renderWithClient(
      <AthenaWorkLedger
        jobs={jobs}
        filter="running"
        onFilterChange={vi.fn()}
        transport={transport(jobs)}
      />,
    );

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    expect(screen.queryByRole('tab', { name: /needs you/i })).toBeNull();
    for (const tab of tabs) expect(tab.textContent).not.toMatch(/\d/);

    const entries = screen.getAllByRole('article');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toHaveAttribute('data-athena-job', 'running_1');
  });

  it('renders each row as the same flat work entry the thread uses', () => {
    const jobs = [job({ id: 'running_1' })];
    renderWithClient(
      <AthenaWorkLedger
        jobs={jobs}
        filter="running"
        onFilterChange={vi.fn()}
        transport={transport(jobs)}
      />,
    );

    const entry = screen.getByRole('article', { name: /Protect two hours/ });
    expect(entry.querySelector('[data-slot="athena-job-dot"]')).not.toBeNull();
    expect(entry.querySelector('[data-slot="athena-job-state"]')).not.toBeNull();
  });

  it('reports the picked filter without owning it', () => {
    const onFilterChange = vi.fn();
    const jobs = [
      job({ id: 'running_1', status: 'running', queueState: 'working' }),
      job({ id: 'needs_1', status: 'awaiting_approval', queueState: 'needs_you' }),
    ];
    renderWithClient(
      <AthenaWorkLedger
        jobs={jobs}
        filter="running"
        onFilterChange={onFilterChange}
        transport={transport(jobs)}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: /needs you/i }));

    expect(onFilterChange).toHaveBeenCalledWith('needs_you');
  });

  it('sorts the done filter newest first', () => {
    const jobs = [
      job({
        id: 'done_old',
        status: 'completed',
        queueState: 'finished',
        updatedAt: '2026-07-01T12:00:00.000Z',
      }),
      job({
        id: 'done_new',
        status: 'completed',
        queueState: 'finished',
        updatedAt: '2026-07-10T12:00:00.000Z',
      }),
    ];
    renderWithClient(
      <AthenaWorkLedger
        jobs={jobs}
        filter="done"
        onFilterChange={vi.fn()}
        transport={transport(jobs)}
      />,
    );

    const ids = screen
      .getAllByRole('article')
      .map((entry) => entry.getAttribute('data-athena-job'));
    expect(ids).toEqual(['done_new', 'done_old']);
  });

  it('falls back to the first lane with work when the chosen one is empty', () => {
    const jobs = [job({ id: 'needs_1', status: 'awaiting_approval', queueState: 'needs_you' })];
    renderWithClient(
      <AthenaWorkLedger
        jobs={jobs}
        filter="running"
        onFilterChange={vi.fn()}
        transport={transport(jobs)}
      />,
    );

    const tablist = screen.getByRole('tablist');
    expect(within(tablist).getByRole('tab', { selected: true })).toHaveTextContent(/needs you/i);
    expect(screen.getByRole('article')).toHaveAttribute('data-athena-job', 'needs_1');
  });

  it('renders nothing when there is no work at all', () => {
    const { container } = renderWithClient(
      <AthenaWorkLedger jobs={[]} filter="running" onFilterChange={vi.fn()} />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});

describe('ledger filters', () => {
  it('maps a job to its lane, preferring the queue-reported one', () => {
    const { queueState: _lane, ...withoutLane } = job({ status: 'completed' });
    expect(ledgerFilterOf(withoutLane)).toBe('done');
    expect(ledgerFilterOf(job({ status: 'running', queueState: 'needs_you' }))).toBe('needs_you');
  });

  it('keeps an occupied choice and returns null with no work', () => {
    const jobs = [job({ id: 'done_1', status: 'completed', queueState: 'finished' })];
    expect(resolveLedgerFilter(jobs, 'done')).toBe('done');
    expect(resolveLedgerFilter(jobs, 'running')).toBe('done');
    expect(resolveLedgerFilter([], 'running')).toBeNull();
  });
});
