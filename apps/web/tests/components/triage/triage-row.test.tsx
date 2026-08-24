/**
 * Behaviour tests for {@link import('../../../src/components/triage/triage-row').TriageRow}.
 *
 * @remarks
 * Triage is a task list like any other, so it is one of the surfaces required to expose a
 * start-timer affordance for every task it shows. What is worth pinning: the row grows
 * {@link TaskTimerButton} alongside its existing
 * {@link SourceTag}/{@link TriageActions} affordances, and clicking it starts the row's task
 * without also activating the row (opening the task detail) — the same contract every other
 * interactive cell in this row already holds itself to.
 */
import '@testing-library/jest-dom/vitest';

import { TooltipProvider } from '@docket/ui/primitives';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { activeGet, recordsPost } = vi.hoisted(() => ({
  activeGet: vi.fn(),
  recordsPost: vi.fn(),
}));

vi.mock('../../../src/lib/api', () => ({
  api: {
    v1: {
      time: {
        active: { $get: activeGet },
        records: { $post: recordsPost },
      },
    },
  },
}));

const { TriageRow } = await import('@/components/triage/triage-row');

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
        <TriageRow
          task={{
            id: 'task_1',
            organizationId: 'org_1',
            title: 'Unfiled bug report',
            stateType: 'unstarted',
            provenance: { source: 'native', sourceIntegrationId: null, externalId: null },
            assigneeName: null,
          }}
          onActivate={onActivate}
          projects={[]}
          programs={[]}
          projectNoun="Project"
          programNoun="Program"
          providerName={(provider) => provider ?? 'Docket'}
          onAssignProject={vi.fn()}
          onAssignProgram={vi.fn()}
          onDismiss={vi.fn()}
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

describe('TriageRow', () => {
  it('offers the required track-timer affordance for the row’s task', async () => {
    renderRow(vi.fn());
    expect(await screen.findByTestId('task-timer-task_1')).toBeInTheDocument();
  });

  it('starts the row’s task without also activating (opening) the row', async () => {
    recordsPost.mockResolvedValue(jsonResponse({ id: 'rec_new' }));
    const onActivate = vi.fn();
    renderRow(onActivate);

    fireEvent.click(await screen.findByTestId('task-timer-task_1'));

    await waitFor(() => {
      expect(recordsPost).toHaveBeenCalledWith({
        json: { context: { label: 'Unfiled bug report', taskId: 'task_1' } },
      });
    });
    expect(onActivate).not.toHaveBeenCalled();
  });
});
