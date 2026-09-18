/** Behavior tests for the one task Activity feed. */
import '@testing-library/jest-dom/vitest';

import { ActorId } from '@docket/identity-access/ids';
import { TaskId } from '@docket/work/ids';
import { type TaskActivityOut } from '@docket/connections/activity-contract';
import {
  AthenaOverviewOut,
  AthenaPulseOut,
  AthenaSessionDetailOut,
} from '@docket/athena/agent-contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { okResponse } from '../support/query';

import type * as QueryModule from '../../src/lib/query';

const queryState = vi.hoisted<{
  data:
    | {
        pages: readonly {
          readonly items: readonly TaskActivityOut[];
          readonly nextCursor?: string;
        }[];
      }
    | undefined;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isFetchNextPageError: boolean;
  fetchNextPage: ReturnType<typeof vi.fn>;
}>(() => ({
  data: { pages: [{ items: [] }] },
  isPending: false,
  isError: false,
  error: undefined,
  hasNextPage: false,
  isFetchingNextPage: false,
  isFetchNextPageError: false,
  fetchNextPage: vi.fn(),
}));

vi.mock('../../src/lib/query', async (importOriginal) => {
  const actual = await importOriginal<typeof QueryModule>();
  return {
    ...actual,
    useApiListQuery: () => ({
      data: queryState.data,
      isPending: queryState.isPending,
      isError: queryState.isError,
      error: queryState.error,
    }),
    useInfiniteApiQuery: () => ({
      data: queryState.data,
      isPending: queryState.isPending,
      isError: queryState.isError,
      error: queryState.error,
      hasNextPage: queryState.hasNextPage,
      isFetchingNextPage: queryState.isFetchingNextPage,
      isFetchNextPageError: queryState.isFetchNextPageError,
      fetchNextPage: queryState.fetchNextPage,
    }),
  };
});

const athenaQueueGet = vi.hoisted(() => vi.fn());
const athenaSessionGet = vi.hoisted(() => vi.fn());
const athenaPulseGet = vi.hoisted(() => vi.fn());

// The Athena block reads the default personal transport directly (`TaskActivityFeed` takes no
// transport override), so the personal Athena queue/detail/pulse endpoints are mocked at the API
// client boundary rather than swapped through a prop, the same technique
// `athena-mcp-panel.test.tsx` uses.
vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      me: {
        athena: {
          $get: athenaQueueGet,
          pulse: { $get: athenaPulseGet },
          sessions: { ':id': { $get: athenaSessionGet } },
        },
      },
    },
  },
}));

const { TaskActivityFeed } = await import('../../src/components/task-detail/task-activity-feed');

const ORG_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
const TASK_ID = TaskId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV');
const OTHER_TASK_ID = TaskId.parse('01ARZ3NDEKTSV4RRFFQ69G5FA0');
const MATCHING_JOB_ID = '01J00000000000000000000001';
const OTHER_JOB_ID = '01J00000000000000000000002';
const MATCHING_OBJECTIVE = 'Draft the renewal follow-up email';
const OTHER_OBJECTIVE = 'Update the roadmap timeline';

const EMPTY_ATHENA_OVERVIEW = AthenaOverviewOut.parse({
  counts: { needsYou: 0, working: 0, finished: 0 },
  currentChat: null,
  sessions: { needsYou: [], working: [], finished: [] },
});
const EMPTY_ATHENA_PULSE = AthenaPulseOut.parse({ needsYou: 0, working: 0 });

function entry(overrides: Partial<TaskActivityOut> = {}): TaskActivityOut {
  return {
    id: 'audit:01ARZ3NDEKTSV4RRFFQ69G5F01',
    taskId: TASK_ID,
    actorId: ActorId.parse('01ARZ3NDEKTSV4RRFFQ69G5F99'),
    actorName: 'Ada Lovelace',
    type: 'updated',
    category: 'task',
    change: { field: 'state', label: 'Status', from: 'Todo', to: 'In progress' },
    body: null,
    subjectTaskId: null,
    subjectTaskTitle: null,
    createdAt: '2026-08-24T12:00:00.000Z',
    ...overrides,
  };
}

/** Render under a fresh, retry-free `QueryClient` — the Athena block drives a real live query. */
function renderWithProviders(ui: ReactElement): ReturnType<typeof render> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function renderFeed(): void {
  renderWithProviders(<TaskActivityFeed orgId={ORG_ID} taskId={TASK_ID} />);
}

beforeEach(() => {
  queryState.data = { pages: [{ items: [] }] };
  queryState.isPending = false;
  queryState.isError = false;
  queryState.error = undefined;
  queryState.hasNextPage = false;
  queryState.isFetchingNextPage = false;
  queryState.isFetchNextPageError = false;
  queryState.fetchNextPage.mockReset();

  athenaQueueGet.mockReset().mockResolvedValue(okResponse(EMPTY_ATHENA_OVERVIEW));
  athenaSessionGet.mockReset();
  athenaPulseGet.mockReset().mockResolvedValue(okResponse(EMPTY_ATHENA_PULSE));
});
afterEach(cleanup);

describe('TaskActivityFeed', () => {
  it('renders comments and task changes in one chronological Activity list', () => {
    queryState.data = {
      pages: [
        {
          items: [
            entry({
              id: 'comment:01ARZ3NDEKTSV4RRFFQ69G5F02',
              type: 'comment',
              category: 'comment',
              change: null,
              body: 'The customer confirmed the scope.',
              createdAt: '2026-08-24T11:00:00.000Z',
            }),
            entry(),
          ],
        },
      ],
    };

    renderFeed();

    const activity = screen.getByRole('region', { name: 'Activity' });
    const rows = within(activity).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('The customer confirmed the scope.');
    expect(rows[1]).toHaveTextContent('changed Status from Todo to In progress');
  });

  it('uses application-owned copy when the Activity read fails', () => {
    queryState.data = undefined;
    queryState.isError = true;
    queryState.error = new Error('database refused the connection');

    renderFeed();

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('database refused the connection')).not.toBeInTheDocument();
  });

  it('appends the next chronological page when the user loads newer Activity', () => {
    const earlier = entry({ id: 'audit:01ARZ3NDEKTSV4RRFFQ69G5F10' });
    const later = entry({
      id: 'audit:01ARZ3NDEKTSV4RRFFQ69G5F11',
      change: { field: 'priority', label: 'Priority', from: 'Low', to: 'High' },
    });
    queryState.data = { pages: [{ items: [earlier], nextCursor: 'next-page' }] };
    queryState.hasNextPage = true;
    queryState.fetchNextPage.mockImplementation(() => {
      queryState.data = {
        pages: [{ items: [earlier], nextCursor: 'next-page' }, { items: [later] }],
      };
    });

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <TaskActivityFeed orgId={ORG_ID} taskId={TASK_ID} />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Load newer activity' }));
    expect(queryState.fetchNextPage).toHaveBeenCalledOnce();

    rerender(
      <QueryClientProvider client={client}>
        <TaskActivityFeed orgId={ORG_ID} taskId={TASK_ID} />
      </QueryClientProvider>,
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText(/changed Priority from Low to High/)).toBeInTheDocument();
  });

  it('uses newer-direction application copy when loading the next page fails', () => {
    queryState.data = { pages: [{ items: [entry()] }] };
    queryState.hasNextPage = true;
    queryState.isFetchNextPageError = true;
    queryState.error = new Error('upstream cursor failure');

    renderFeed();

    // The loaded entries stay on screen beside the banner.
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0);
    expect(screen.queryByText('upstream cursor failure')).not.toBeInTheDocument();
  });

  it("shows this task's delegated Athena work, and not another task's", async () => {
    const matchingSummary = {
      id: MATCHING_JOB_ID,
      kind: 'job' as const,
      status: 'completed' as const,
      queueState: 'finished' as const,
      objective: MATCHING_OBJECTIVE,
      context: { source: { type: 'task' as const, id: TASK_ID, label: 'This task' } },
      workspace: null,
      startedAt: '2026-08-24T10:00:00.000Z',
      endedAt: '2026-08-24T10:05:00.000Z',
      createdAt: '2026-08-24T10:00:00.000Z',
    };
    const otherSummary = {
      ...matchingSummary,
      id: OTHER_JOB_ID,
      objective: OTHER_OBJECTIVE,
      context: { source: { type: 'task' as const, id: OTHER_TASK_ID, label: 'Another task' } },
    };
    athenaQueueGet.mockResolvedValue(
      okResponse(
        AthenaOverviewOut.parse({
          counts: { needsYou: 0, working: 0, finished: 2 },
          currentChat: null,
          sessions: { needsYou: [], working: [], finished: [matchingSummary, otherSummary] },
        }),
      ),
    );
    athenaSessionGet.mockResolvedValue(
      okResponse(AthenaSessionDetailOut.parse({ ...matchingSummary, activities: [] })),
    );

    renderFeed();

    expect(await screen.findByRole('article', { name: MATCHING_OBJECTIVE })).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: OTHER_OBJECTIVE })).not.toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(1);
  });
});
