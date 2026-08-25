import '@testing-library/jest-dom/vitest';

import type { TaskDetail } from '@docket/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('../../src/components/editor/apply-description-template', () => ({
  TemplateAwareEntityDocument: ({ value }: { readonly value: string | null | undefined }) => (
    <div data-testid="task-description">{value}</div>
  ),
}));

const { TaskDetails } = await import('../../src/components/task-detail/task-details');

afterEach(cleanup);

beforeEach(() => {
  expandPost.mockReset();
  undoPost.mockReset();
});

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

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

function renderDetails(
  options: Partial<React.ComponentProps<typeof TaskDetails>> = {},
): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <TaskDetails
        orgId="org_1"
        taskId="task_1"
        task={task()}
        canEdit
        onSave={() => undefined}
        details={<p>Schedule and placement</p>}
        {...options}
      />
    </QueryClientProvider>,
  );
  return client;
}

describe('TaskDetails', () => {
  it('keeps the task description first and puts secondary details in an inline disclosure', () => {
    renderDetails();

    const description = screen.getByTestId('task-description');
    const details = screen.getByText('Schedule and placement');
    expect(description.compareDocumentPosition(details)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getByText('Details')).toBeInTheDocument();
    expect(details.closest('details')).not.toHaveAttribute('open');
    expect(document.querySelector('aside')).toBeNull();
  });

  it('expands the existing description in place and offers one undo', async () => {
    expandPost.mockResolvedValue(
      jsonResponse({
        task: task({ description: '## Goal\n\nThe expanded definition.' }),
        undoToken: 'undo_1',
      }),
    );
    undoPost.mockResolvedValue(jsonResponse({ task: task(), undoToken: null }));
    const client = renderDetails();

    fireEvent.click(screen.getByRole('button', { name: 'Expand' }));

    await waitFor(() => {
      expect(expandPost).toHaveBeenCalledWith({
        param: { orgId: 'org_1', id: 'task_1' },
        json: {},
      });
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Description expanded.');
    expect(client.getQueryData<TaskDetail>(['org', 'org_1', 'tasks', 'task_1'])?.description).toBe(
      '## Goal\n\nThe expanded definition.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Undo expansion' }));
    await waitFor(() => {
      expect(undoPost).toHaveBeenCalledWith({
        param: { orgId: 'org_1', id: 'task_1' },
        json: { undoToken: 'undo_1' },
      });
    });
  });

  it('keeps the description in place and gives owned retry feedback when expansion fails', async () => {
    expandPost.mockResolvedValue(jsonResponse({ code: 'conflict' }, 409));
    renderDetails();

    const button = screen.getByRole('button', { name: 'Expand' });
    fireEvent.click(button);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not expand the description. Try again.',
    );
    expect(button).not.toBeDisabled();
    expect(screen.getByTestId('task-description')).toHaveTextContent('The current definition.');
  });
});
