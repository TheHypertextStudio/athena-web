/**
 * Behaviour tests for {@link import('../../src/components/my-work/agent-task-row').AgentTaskRow}.
 *
 * @remarks
 * The My Work agent-aware row is one of the required CORE-40 hosts — a distinct row
 * representing a task. Two things are worth pinning:
 *
 * - the row grows the {@link TaskTimerButton} affordance alongside the existing
 *   {@link LiveSessionPill}/{@link ActorAvatar} cells;
 * - clicking it starts the row's own task without also activating the row (the same contract
 *   the row's own `LiveSessionPill` cell already holds itself to).
 */
import '@testing-library/jest-dom/vitest';

import { TooltipProvider } from '@docket/ui/primitives';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { activeGet, recordsPost } = vi.hoisted(() => ({
  activeGet: vi.fn(),
  recordsPost: vi.fn(),
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    className,
    onClick,
  }: {
    children: ReactNode;
    href: string;
    className?: string;
    onClick?: (event: React.MouseEvent) => void;
  }) => (
    <a href={href} className={className} onClick={onClick}>
      {children}
    </a>
  ),
}));

vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      time: {
        active: { $get: activeGet },
        records: { $post: recordsPost },
      },
    },
  },
}));

const { AgentTaskRow } = await import('@/components/my-work/agent-task-row');

/** A JSON response shaped like the RPC client's. */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

/** Render the row inside the providers `TaskTimerButton` needs. */
function renderRow(onActivate: () => void): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <AgentTaskRow
          task={{ id: 'task_1', title: 'Review the PR', stateType: 'started' }}
          onActivate={onActivate}
        />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  activeGet.mockReset();
  recordsPost.mockReset();
  activeGet.mockResolvedValue(
    jsonResponse({
      record: null,
      suggestion: null,
      serverNow: new Date().toISOString(),
      activeAgentExecutions: [],
    }),
  );
});

afterEach(() => {
  cleanup();
});

describe('AgentTaskRow', () => {
  it('offers the CORE-40 track-timer affordance for the row’s task', async () => {
    renderRow(vi.fn());
    expect(await screen.findByTestId('task-timer-task_1')).toBeInTheDocument();
  });

  it('starts the row’s task without also activating the row', async () => {
    recordsPost.mockResolvedValue(jsonResponse({ id: 'rec_new' }));
    const onActivate = vi.fn();
    renderRow(onActivate);

    fireEvent.click(await screen.findByTestId('task-timer-task_1'));

    await waitFor(() => {
      expect(recordsPost).toHaveBeenCalledWith({
        json: { context: { label: 'Review the PR', taskId: 'task_1' } },
      });
    });
    expect(onActivate).not.toHaveBeenCalled();
  });
});
