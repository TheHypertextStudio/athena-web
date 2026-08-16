/**
 * Behavior tests for the task detail Activity section.
 *
 * @remarks
 * The bar here: every task, including one created seconds ago, shows an Activity
 * section carrying at least its creation event, with an actor, action text, and a relative
 * timestamp. The read is mocked at the query layer so each state (loading, empty, populated,
 * failed) can be rendered deterministically.
 */
import '@testing-library/jest-dom/vitest';

import type { TaskActivityOut } from '@docket/types';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as QueryModule from '../../src/lib/query';

const queryState = vi.hoisted<{
  data: { items: readonly unknown[] } | undefined;
  isPending: boolean;
  isError: boolean;
  error: unknown;
}>(() => ({ data: { items: [] }, isPending: false, isError: false, error: undefined }));

vi.mock('../../src/lib/query', async (importOriginal) => {
  const actual = await importOriginal<typeof QueryModule>();
  return {
    ...actual,
    useApiListQuery: () => ({
      data: queryState.data,
      isPending: queryState.isPending,
      isError: queryState.isError,
      error: queryState.error,
      isFetching: false,
      isPlaceholderData: false,
      refetch: vi.fn(),
    }),
  };
});

const { TaskActivitySection } =
  await import('../../src/components/task-detail/task-activity-section');

const ORG_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
const TASK_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

/** Build one activity entry with sensible defaults. */
function entry(overrides: Partial<TaskActivityOut> = {}): TaskActivityOut {
  return {
    id: '01ARZ3NDEKTSV4RRFFQ69G5F01',
    taskId: TASK_ID,
    actorId: '01ARZ3NDEKTSV4RRFFQ69G5F99',
    actorName: 'Ada Lovelace',
    type: 'updated',
    change: { field: 'state', label: 'Status', from: 'Todo', to: 'In progress' },
    createdAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
    ...overrides,
  } as TaskActivityOut;
}

function renderSection(): void {
  render(<TaskActivitySection orgId={ORG_ID} taskId={TASK_ID} />);
}

beforeEach(() => {
  queryState.data = { items: [] };
  queryState.isPending = false;
  queryState.isError = false;
  queryState.error = undefined;
});
afterEach(cleanup);

describe('TaskActivitySection', () => {
  it('shows the creation event on a task that has no other history yet', () => {
    const createdAt = new Date(Date.now() - 90 * 60_000).toISOString();
    queryState.data = {
      items: [entry({ type: 'created', change: null, createdAt, actorName: 'Ada Lovelace' })],
    };
    renderSection();

    const section = screen.getByRole('region', { name: 'Activity' });
    expect(within(section).getByRole('heading', { name: 'Activity' })).toBeInTheDocument();
    const item = within(section).getByRole('listitem');
    expect(item).toHaveTextContent('Ada Lovelace created this task');
    // Relative on the face, exact on hover — a reader scans "1h ago", an auditor needs the instant.
    const stamp = within(item).getByText(/ago$/);
    expect(stamp).toHaveAttribute('title', createdAt);
  });

  it('narrates set, cleared and changed differently', () => {
    queryState.data = {
      items: [
        entry({
          id: 'a1',
          change: { field: 'assigneeId', label: 'Assignee', from: null, to: 'Grace' },
        }),
        entry({
          id: 'a2',
          change: { field: 'dueDate', label: 'Due date', from: '2026-09-01', to: null },
        }),
        entry({
          id: 'a3',
          change: { field: 'state', label: 'Status', from: 'Todo', to: 'In progress' },
        }),
      ],
    };
    renderSection();

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('set Assignee to Grace');
    // A cleared value is narrated as a clear — never "changed … to null" and never a bare dash.
    expect(items[1]).toHaveTextContent('cleared Due date');
    expect(items[1]).not.toHaveTextContent('null');
    expect(items[2]).toHaveTextContent('changed Status from Todo to In progress');
  });

  it('renders one entry per change, in the order the server returned them', () => {
    queryState.data = {
      items: [
        entry({ id: 'c0', type: 'created', change: null }),
        entry({ id: 'c1', change: { field: 'title', label: 'Title', from: 'A', to: 'B' } }),
        entry({
          id: 'c2',
          change: { field: 'priority', label: 'Priority', from: 'None', to: 'High' },
        }),
      ],
    };
    renderSection();

    const text = screen.getAllByRole('listitem').map((item) => item.textContent);
    expect(text[0]).toContain('created this task');
    expect(text[1]).toContain('changed Title from A to B');
    expect(text[2]).toContain('changed Priority from None to High');
  });

  it('names an unattributed change without inventing an identity', () => {
    queryState.data = {
      items: [entry({ actorId: null, actorName: null })],
    };
    renderSection();
    expect(screen.getByRole('listitem')).toHaveTextContent('Someone changed Status');
  });

  it('shows application-owned copy when there is no history at all', () => {
    queryState.data = { items: [] };
    renderSection();
    expect(screen.getByText('Nothing has happened to this task yet.')).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  it('shows the section heading while the history is still loading', () => {
    queryState.isPending = true;
    queryState.data = undefined;
    renderSection();
    expect(screen.getByRole('heading', { name: 'Activity' })).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  it('never renders the underlying failure text when the read fails', () => {
    queryState.isError = true;
    queryState.data = undefined;
    queryState.error = new Error(
      'ECONNREFUSED 127.0.0.1:5432 relation "audit_event" does not exist',
    );
    renderSection();

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent("Could not load this task's history.");
    expect(alert).not.toHaveTextContent('ECONNREFUSED');
    expect(alert).not.toHaveTextContent('audit_event');
  });
});
