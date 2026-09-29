import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

const assignmentPost = vi.hoisted(() => vi.fn());
vi.mock('../../src/lib/api', () => ({
  api: { v1: { me: { athena: { assignments: { $post: assignmentPost } } } } },
}));

const { TaskAthenaAssignmentLauncher, assignmentTargetFromContext } =
  await import('../../src/components/athena/task-athena-assignment-launcher');

afterEach(() => {
  cleanup();
  assignmentPost.mockReset();
});

function openAssignment(): HTMLElement {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <TaskAthenaAssignmentLauncher
        organizationId="01ARZ3NDEKTSV4RRFFQ69G5FAV"
        taskId="01ARZ3NDEKTSV4RRFFQ69G5FAW"
        taskTitle="Review launch plan"
      />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Work on this task' }));
  return screen.getByRole('dialog', { name: 'Ask Athena to work on this task' });
}

describe('Athena task assignment launcher', () => {
  it('offers durable work only for an attached task in the current workspace', () => {
    const task = {
      workspaceId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      source: {
        type: 'task' as const,
        id: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
        label: 'Review launch plan',
      },
    };
    expect(assignmentTargetFromContext(task, true)).toEqual({
      organizationId: task.workspaceId,
      taskId: task.source.id,
      taskTitle: task.source.label,
    });
    expect(assignmentTargetFromContext(task, false)).toBeNull();
    expect(
      assignmentTargetFromContext({ ...task, source: { type: 'project', id: 'project_1' } }, true),
    ).toBeNull();
  });

  it('starts one durable task assignment and keeps its proposal for review', async () => {
    let settle: ((value: Response) => void) | undefined;
    assignmentPost.mockReturnValue(
      new Promise<Response>((resolve) => {
        settle = resolve;
      }),
    );
    const dialog = openAssignment();
    const start = within(dialog).getByRole('button', { name: 'Start work' });
    expect(start).toBeDisabled();

    fireEvent.change(within(dialog).getByRole('textbox', { name: 'What should Athena do?' }), {
      target: { value: 'Propose a concise status comment. Do not post it.' },
    });
    fireEvent.click(start);
    await vi.waitFor(() => {
      expect(assignmentPost).toHaveBeenCalledOnce();
    });
    expect(assignmentPost).toHaveBeenCalledWith({
      json: {
        organizationId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        entityType: 'task',
        entityId: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
        objective: 'Propose a concise status comment. Do not post it.',
      },
    });
    expect(start).toBeDisabled();
    fireEvent.click(start);
    expect(assignmentPost).toHaveBeenCalledOnce();

    settle?.(
      new Response(JSON.stringify({ id: 'assignment_1' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('keeps the objective and shows a Settings recovery route after failure', async () => {
    assignmentPost.mockResolvedValue(
      new Response(JSON.stringify({ code: 'lattice_unavailable', status: 503 }), {
        status: 503,
        headers: { 'content-type': 'application/problem+json' },
      }),
    );
    const dialog = openAssignment();
    const objective = 'Propose a status comment; leave it for review.';
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'What should Athena do?' }), {
      target: { value: objective },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start work' }));

    expect(await within(dialog).findByRole('alert')).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: 'What should Athena do?' })).toHaveValue(
      objective,
    );
    expect(within(dialog).getByRole('link', { name: 'Check Athena Settings' })).toHaveAttribute(
      'href',
      '/settings/athena',
    );
  });
});
