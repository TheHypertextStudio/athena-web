/**
 * Expanding a task's description and undoing it, as the overflow menu and the undo strip share it.
 */
import '@testing-library/jest-dom/vitest';

import { Toaster, dismissAllNotices } from '@docket/ui/components';
import type { TaskDetail } from '@docket/work/task-model';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { JSX } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { okResponse, problemResponse } from '../support/query';

const { expandPost, undoPost } = vi.hoisted(() => ({
  expandPost: vi.fn(),
  undoPost: vi.fn(),
}));

vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        ':orgId': {
          tasks: {
            ':id': {
              expand: { $post: expandPost, undo: { $post: undoPost } },
            },
          },
        },
      },
    },
  },
}));

const { useDescriptionExpansion } =
  await import('../../src/components/task-detail/use-description-expansion');

afterEach(() => {
  cleanup();
  act(() => {
    dismissAllNotices();
  });
});

beforeEach(() => {
  expandPost.mockReset();
  undoPost.mockReset();
});

function task(overrides: Partial<TaskDetail> = {}): TaskDetail {
  return {
    id: 'task_1',
    organizationId: 'org_1',
    title: 'Ship it',
    description: 'The current definition.',
    teamId: 'team_1',
    state: 'todo',
    priority: 'none',
    provenance: { source: 'native' },
    createdAt: '2026-08-25T00:00:00.000Z',
    labels: [],
    blocking: [],
    blockedBy: [],
    subtasks: [],
    ...overrides,
  } as TaskDetail;
}

/** Drives the hook through two buttons and prints what it reports. */
function Harness(): JSX.Element {
  const expansion = useDescriptionExpansion('org_1', 'task_1');
  return (
    <div>
      <button type="button" onClick={expansion.expand}>
        expand
      </button>
      <button type="button" onClick={expansion.undo}>
        undo
      </button>
      <output data-testid="notice">{expansion.notice}</output>
      <output data-testid="token">{expansion.undoToken}</output>
    </div>
  );
}

function renderHarness(): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <Harness />
      <Toaster />
    </QueryClientProvider>,
  );
  return client;
}

describe('useDescriptionExpansion', () => {
  it('expands the description in place and keeps the token that undoes it', async () => {
    expandPost.mockResolvedValue(
      okResponse({
        task: task({ description: '## Goal\n\nThe expanded definition.' }),
        undoToken: 'undo_1',
      }),
    );
    const client = renderHarness();

    fireEvent.click(screen.getByRole('button', { name: 'expand' }));

    await waitFor(() => {
      expect(expandPost).toHaveBeenCalledWith({
        param: { orgId: 'org_1', id: 'task_1' },
        json: {},
      });
    });
    await waitFor(() => {
      expect(screen.getByTestId('token')).toHaveTextContent('undo_1');
    });
    expect(client.getQueryData<TaskDetail>(['org', 'org_1', 'tasks', 'task_1'])?.description).toBe(
      '## Goal\n\nThe expanded definition.',
    );
  });

  it('undoes the expansion with the token it kept, then holds no token', async () => {
    expandPost.mockResolvedValue(okResponse({ task: task(), undoToken: 'undo_1' }));
    undoPost.mockResolvedValue(okResponse({ task: task(), undoToken: null }));
    renderHarness();

    fireEvent.click(screen.getByRole('button', { name: 'expand' }));
    await waitFor(() => {
      expect(screen.getByTestId('token')).toHaveTextContent('undo_1');
    });
    fireEvent.click(screen.getByRole('button', { name: 'undo' }));

    await waitFor(() => {
      expect(undoPost).toHaveBeenCalledWith({
        param: { orgId: 'org_1', id: 'task_1' },
        json: { undoToken: 'undo_1' },
      });
    });
    await waitFor(() => {
      expect(screen.getByTestId('token')).toBeEmptyDOMElement();
    });
  });

  it('does nothing when there is no expansion to undo', () => {
    renderHarness();

    fireEvent.click(screen.getByRole('button', { name: 'undo' }));

    expect(undoPost).not.toHaveBeenCalled();
  });

  it('reports a failed expansion as a notice and leaves no outcome behind', async () => {
    expandPost.mockResolvedValue(problemResponse('server detail', 409, 'conflict'));
    renderHarness();

    fireEvent.click(screen.getByRole('button', { name: 'expand' }));

    const notice = await screen.findByRole('alert');
    expect(notice).not.toHaveTextContent(/server detail/);
    expect(screen.getByTestId('notice')).toBeEmptyDOMElement();
    expect(screen.getByTestId('token')).toBeEmptyDOMElement();
  });
});
