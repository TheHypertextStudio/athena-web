import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AthenaWorkLedger } from '../../src/components/athena/athena-work-ledger';
import type { PersonalAthenaSessionSummary } from '../../src/lib/athena/presentation';

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

afterEach(() => {
  cleanup();
});

describe('AthenaWorkLedger', () => {
  it('shows one filter tab per lane with the matching count, and rows for the active filter', () => {
    const jobs = [
      job({ id: 'running_1', status: 'running', queueState: 'working' }),
      job({ id: 'needs_1', status: 'awaiting_approval', queueState: 'needs_you' }),
      job({ id: 'done_1', status: 'completed', queueState: 'finished' }),
    ];
    render(
      <AthenaWorkLedger jobs={jobs} filter="running" onFilterChange={vi.fn()} onOpen={vi.fn()} />,
    );

    const runningTab = screen.getByRole('tab', { name: /running/i });
    const needsYouTab = screen.getByRole('tab', { name: /needs you/i });
    const doneTab = screen.getByRole('tab', { name: /done/i });
    expect(within(runningTab).getByText('1')).toBeInTheDocument();
    expect(within(needsYouTab).getByText('1')).toBeInTheDocument();
    expect(within(doneTab).getByText('1')).toBeInTheDocument();

    expect(screen.getAllByRole('button', { name: /Protect two hours/ })).toHaveLength(1);
  });

  it('reports the picked filter without owning it', () => {
    const onFilterChange = vi.fn();
    const jobs = [
      job({ id: 'running_1', status: 'running', queueState: 'working' }),
      job({ id: 'needs_1', status: 'awaiting_approval', queueState: 'needs_you' }),
    ];
    render(
      <AthenaWorkLedger
        jobs={jobs}
        filter="running"
        onFilterChange={onFilterChange}
        onOpen={vi.fn()}
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
    render(
      <AthenaWorkLedger jobs={jobs} filter="done" onFilterChange={vi.fn()} onOpen={vi.fn()} />,
    );

    const rows = screen.getAllByRole('button', { name: /Protect two hours/ });
    expect(rows).toHaveLength(2);
    const newestIndex = rows.findIndex((row) => within(row).queryByText('Jul 10') !== null);
    const oldestIndex = rows.findIndex((row) => within(row).queryByText('Jul 1') !== null);
    expect(newestIndex).toBe(0);
    expect(oldestIndex).toBe(1);
  });

  it('calls onOpen with the job id when a row is clicked', () => {
    const onOpen = vi.fn();
    render(
      <AthenaWorkLedger
        jobs={[job({ id: 'session_42', status: 'running', queueState: 'working' })]}
        filter="running"
        onFilterChange={vi.fn()}
        onOpen={onOpen}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Protect two hours/ }));

    expect(onOpen).toHaveBeenCalledWith('session_42');
  });
});
