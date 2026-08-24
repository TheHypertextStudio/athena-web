import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ObjectRef } from '../../../src/lib/actions/object';
import { ObjectListRow } from '../../../src/components/objects/object-list-row';

const project: ObjectRef = {
  kind: 'project',
  id: 'project-1',
  organizationId: 'org-1',
  title: 'Urbanist tech program startup',
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ObjectListRow', () => {
  it('keeps identity, navigation, supporting context, and state in one standard object row', async () => {
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    render(
      <ObjectListRow
        object={project}
        href="/orgs/org-1/projects/project-1"
        icon={<span data-testid="project-glyph">P</span>}
        description="Project · inherited"
        trailing="Active"
      />,
    );

    const row = screen.getByTestId('object-list-row');
    expect(row).toHaveAttribute('data-object-kind', 'project');
    expect(row).not.toHaveAttribute('draggable');
    expect(row).toHaveAttribute('data-drag-state', 'idle');
    expect(row).toHaveClass('cursor-grab');

    const identity = screen.getByTestId('object-identity-target');
    expect(identity).toHaveClass('size-10');
    expect(identity).toContainElement(screen.getByTestId('project-glyph'));

    expect(screen.getByRole('link', { name: 'Urbanist tech program startup' })).toHaveAttribute(
      'href',
      '/orgs/org-1/projects/project-1',
    );
    expect(screen.getByText('Project · inherited')).toBeVisible();
    expect(screen.getByText('Active')).toBeVisible();
    expect(screen.queryByText(/\b1\b/)).not.toBeInTheDocument();

    await userEvent.click(identity);
    expect(anchorClick).toHaveBeenCalledOnce();
    const syntheticAnchor = anchorClick.mock.instances[0];
    expect(syntheticAnchor).toHaveAttribute('href', '/orgs/org-1/projects/project-1');
  });
});
