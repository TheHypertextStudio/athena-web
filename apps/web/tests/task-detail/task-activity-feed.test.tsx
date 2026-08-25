/** Behavior tests for the one task Activity feed. */
import '@testing-library/jest-dom/vitest';

import { ActorId, TaskId, type TaskActivityOut } from '@docket/types';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

const { TaskActivityFeed } = await import('../../src/components/task-detail/task-activity-feed');

const ORG_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
const TASK_ID = TaskId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV');

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

function renderFeed(): void {
  render(<TaskActivityFeed orgId={ORG_ID} taskId={TASK_ID} />);
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

    expect(screen.getByRole('alert')).toHaveTextContent('Could not load this task activity.');
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

    const { rerender } = render(<TaskActivityFeed orgId={ORG_ID} taskId={TASK_ID} />);
    fireEvent.click(screen.getByRole('button', { name: 'Load newer activity' }));
    expect(queryState.fetchNextPage).toHaveBeenCalledOnce();

    rerender(<TaskActivityFeed orgId={ORG_ID} taskId={TASK_ID} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText(/changed Priority from Low to High/)).toBeInTheDocument();
  });

  it('uses newer-direction application copy when loading the next page fails', () => {
    queryState.data = { pages: [{ items: [entry()] }] };
    queryState.hasNextPage = true;
    queryState.isFetchNextPageError = true;
    queryState.error = new Error('upstream cursor failure');

    renderFeed();

    expect(screen.getByRole('alert')).toHaveTextContent('Could not load newer activity.');
    expect(screen.queryByText('upstream cursor failure')).not.toBeInTheDocument();
  });
});
