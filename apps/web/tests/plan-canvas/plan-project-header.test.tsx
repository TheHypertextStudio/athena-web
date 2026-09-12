import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { PlanProjectNodeData } from '../../src/components/plan-canvas/plan-nodes';
import {
  PlanAlsoIn,
  PlanProjectHeader,
} from '../../src/components/plan-canvas/plan-project-header';

const NODE: PlanProjectNodeData = {
  ref: 'p1',
  kind: 'project',
  orgId: 'org_1',
  title: 'Donor outreach',
  status: 'draft',
  href: null,
  entered: false,
  changedFields: [],
  canEdit: true,
  summary: null,
  lead: { kind: 'human', name: 'Sam Rivera', avatarUrl: null },
  targetDate: '2026-04-30',
  taskCount: 3,
  alsoIn: [],
  canAddTask: true,
};

describe('PlanProjectHeader', () => {
  it('shows the lead as an avatar with their name, the target, and the count', () => {
    render(<PlanProjectHeader node={NODE} changed={new Set()} />);
    expect(screen.getByTitle('Sam Rivera')).toBeInTheDocument();
    expect(screen.getByText('Sam Rivera')).toBeInTheDocument();
    expect(screen.getByText(/3 tasks/)).toBeInTheDocument();
    expect(screen.getByText(/Apr 2026/)).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('omits an unset lead rather than naming its absence', () => {
    render(
      <PlanProjectHeader node={{ ...NODE, lead: null, targetDate: null }} changed={new Set()} />,
    );
    expect(screen.queryByText(/lead/i)).toBeNull();
    expect(screen.getByText('3 tasks')).toBeInTheDocument();
  });

  it('opens the real record once created and sweeps a changed title', () => {
    render(
      <PlanProjectHeader
        node={{ ...NODE, status: 'confirmed', href: '/orgs/org_1/projects/prj_1' }}
        changed={new Set(['title'])}
      />,
    );
    expect(screen.getByRole('link', { name: /open donor outreach/i })).toHaveAttribute(
      'href',
      '/orgs/org_1/projects/prj_1',
    );
    expect(screen.getByText('Donor outreach')).toHaveAttribute('data-changed', 'true');
    expect(screen.getByText(/created/i)).toHaveAttribute('data-plan-state', 'confirmed');
  });
});

describe('PlanAlsoIn', () => {
  it('renders nothing for a project in one initiative', () => {
    const { container } = render(<PlanAlsoIn names={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('names a single other initiative and counts several, listing them all on the chip', () => {
    const { rerender } = render(<PlanAlsoIn names={['Brand refresh']} />);
    expect(screen.getByTestId('plan-also-in')).toHaveTextContent('Brand refresh');
    rerender(<PlanAlsoIn names={['Brand refresh', 'Spring gala', 'Q3 push']} />);
    const chip = screen.getByTestId('plan-also-in');
    expect(chip).toHaveTextContent('+3');
    expect(chip).toHaveAttribute('title', 'Also in Brand refresh, Spring gala, Q3 push');
  });
});
