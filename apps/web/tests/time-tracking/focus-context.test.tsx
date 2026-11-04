import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { TaskDetail } from '@docket/work/task-model';
import FocusTaskContext from '../../src/components/time-tracking/focus-task-context';
vi.mock('../../src/components/docket-link', () => ({
  default: (props: { href: string; children: React.ReactNode }) => <a {...props} />,
}));
afterEach(cleanup);
const task = {
  id: 'task',
  organizationId: 'org',
  title: 'Write the brief',
  priority: 'none',
  description: '## Outcome\n\nA short brief with [research](https://example.com/research).',
  subtasks: [],
  blockedBy: [{ id: 'research', title: 'Finish research', state: 'todo' }],
  blocking: [{ id: 'review', title: 'Review the brief', state: 'todo' }],
  relatedTasks: [],
} as unknown as TaskDetail;
it('renders the actual task document and linked dependencies in expanded Focus', () => {
  render(<FocusTaskContext task={task} workflowState={null} expanded />);
  expect(screen.getByRole('heading', { name: 'Outcome' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'research' })).toHaveAttribute(
    'href',
    'https://example.com/research',
  );
  expect(screen.getByRole('link', { name: 'Finish research' })).toHaveAttribute(
    'href',
    '/orgs/org/tasks/research',
  );
  expect(screen.getByRole('heading', { name: 'Unblocks' })).toBeVisible();
});
it('offers a real task destination when the work has no description', () => {
  render(<FocusTaskContext task={{ ...task, description: null }} workflowState={null} expanded />);
  expect(screen.getByRole('link', { name: 'Add task details' })).toHaveAttribute(
    'href',
    '/orgs/org/tasks/task',
  );
});
