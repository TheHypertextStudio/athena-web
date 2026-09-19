import '@testing-library/jest-dom/vitest';

import type { TaskDetail } from '@docket/work/task-model';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DescriptionExpansion } from '../../src/components/task-detail/use-description-expansion';

vi.mock('../../src/components/editor/apply-description-template', () => ({
  TemplateAwareEntityDocument: ({ value }: { readonly value: string | null | undefined }) => (
    <div data-testid="task-description">{value}</div>
  ),
}));

const { TaskDetails } = await import('../../src/components/task-detail/task-details');

afterEach(cleanup);

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

/** An idle expansion with every action observable; `overrides` reports an outcome. */
function expansionFor(overrides: Partial<DescriptionExpansion> = {}): DescriptionExpansion {
  return {
    pending: false,
    notice: null,
    undoToken: null,
    expand: vi.fn(),
    undo: vi.fn(),
    ...overrides,
  };
}

function renderDetails(expansion: DescriptionExpansion = expansionFor()): void {
  render(
    <TaskDetails
      orgId="org_1"
      task={task()}
      canEdit
      onSave={() => undefined}
      expansion={expansion}
    />,
  );
}

describe('TaskDetails', () => {
  it('renders the description as the whole section, with no heading, button, or disclosure', () => {
    renderDetails();

    expect(screen.getByTestId('task-description')).toHaveTextContent('The current definition.');
    expect(screen.getByRole('region', { name: 'Description' })).toBeInTheDocument();
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(document.querySelector('details')).toBeNull();
    expect(document.querySelector('aside')).toBeNull();
  });

  it('reports an expansion and offers its one undo', () => {
    const expansion = expansionFor({ notice: 'Description expanded.', undoToken: 'undo_1' });
    renderDetails(expansion);

    expect(screen.getByRole('status')).toHaveTextContent('Description expanded.');
    fireEvent.click(screen.getByRole('button', { name: 'Undo expansion' }));

    expect(expansion.undo).toHaveBeenCalledOnce();
  });

  it('reports an expansion that changed nothing without offering an undo', () => {
    renderDetails(expansionFor({ notice: 'No changes needed.' }));

    expect(screen.getByRole('status')).toHaveTextContent('No changes needed.');
    expect(screen.queryByRole('button', { name: 'Undo expansion' })).not.toBeInTheDocument();
  });

  it('holds the undo while a request is in flight', () => {
    renderDetails(
      expansionFor({ notice: 'Description expanded.', undoToken: 'undo_1', pending: true }),
    );

    expect(screen.getByRole('button', { name: 'Undo expansion' })).toBeDisabled();
  });
});
