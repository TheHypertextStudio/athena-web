import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

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
});

describe('ObjectListRow', () => {
  it('keeps identity, navigation, supporting context, and state in one standard object row', () => {
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
    expect(row).toHaveAttribute('draggable', 'true');

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
  });
});
