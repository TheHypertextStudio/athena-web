/**
 * Behaviour tests for {@link import('../../../src/components/search/search-client').SearchResultRow}.
 *
 * @remarks
 * `/search` is one of the surfaces that must expose a start-timer affordance for every task it
 * shows — a timer must be startable for any task, at any time, from wherever it appears: a task
 * result should offer {@link TaskTimerButton} beside its link. Two things are worth pinning:
 *
 * - only `task` results grow the control — every other kind links exactly as before;
 * - the timer starts against the task's real id (`route.entityId`), not the top-level
 *   `result.id`, which is a composite search-document id the timer API would reject outright.
 */
import '@testing-library/jest-dom/vitest';

import { TooltipProvider } from '@docket/ui/primitives';
import { OrganizationId, type SearchResult } from '@docket/types';
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
  }: {
    children: ReactNode;
    href: string;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
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

const { SearchResultRow } = await import('@/components/search/search-client');

const ORG_ID = OrganizationId.parse('01BX5ZZKBKACTAV9WEVGEMMVR1');

/** A JSON response shaped like the RPC client's. */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

/** Render a row inside the providers `TaskTimerButton` needs. */
function renderRow(result: SearchResult): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <SearchResultRow result={result} orgName={() => 'Acme'} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

/** A minimal, otherwise-valid search result for the given kind + route. */
function makeResult(overrides: Partial<SearchResult>): SearchResult {
  const base: SearchResult = {
    id: 'task:org_1:task_composite_doc_id',
    organizationId: ORG_ID,
    userId: null,
    kind: 'task',
    family: 'work',
    title: 'Ship the release notes',
    summary: null,
    snippet: null,
    matchedFields: [],
    route: {
      type: 'entity',
      organizationId: ORG_ID,
      entityKind: 'task',
      entityId: 'task_real_id',
      href: '/orgs/org_1/tasks/task_real_id',
    },
    subject: null,
    source: null,
    facets: {},
    entityId: 'task_real_id',
    externalUrl: null,
    usedIn: [],
    updatedAt: '2026-08-01T00:00:00.000Z',
    actions: [],
    score: 1,
  };
  return Object.assign(base, overrides);
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

describe('SearchResultRow', () => {
  it('offers the track-timer affordance for a task result, using the route’s real task id', async () => {
    recordsPost.mockResolvedValue(jsonResponse({ id: 'rec_new' }));
    renderRow(makeResult({}));

    const timerButton = await screen.findByTestId('task-timer-task_real_id');
    fireEvent.click(timerButton);

    await waitFor(() => {
      // The composite `result.id` ("task:org_1:task_composite_doc_id") must never be sent — only
      // the route's `entityId` is a real task the timer API accepts.
      expect(recordsPost).toHaveBeenCalledWith({
        json: { context: { label: 'Ship the release notes', taskId: 'task_real_id' } },
      });
    });
  });

  it('renders no timer control for a non-task result', () => {
    renderRow(
      makeResult({
        kind: 'project',
        route: {
          type: 'entity',
          organizationId: ORG_ID,
          entityKind: 'project',
          entityId: 'project_1',
          href: '/orgs/org_1/projects/project_1',
        },
      }),
    );
    expect(screen.queryByRole('button', { name: /Track this task/ })).not.toBeInTheDocument();
  });
});
