import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { ProjectBreadcrumb } from '@/components/project-detail/project-breadcrumb';

vi.mock('@/components/docket-link', () => ({
  default: (props: ComponentProps<'a'>) => <a {...props} />,
}));

describe('ProjectBreadcrumb', () => {
  it('returns to the workspace project collection when there is no resolved program', () => {
    render(<ProjectBreadcrumb orgId="org" projectLabel="Projects" programLabel="Programs" />);
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Projects' })).toHaveAttribute(
      'href',
      '/orgs/org/projects',
    );
  });

  it('links to the actual program without confusing it with a work type', () => {
    const name = 'Community gatherings and neighborhood access';
    render(
      <ProjectBreadcrumb
        orgId="org"
        projectLabel="Projects"
        programLabel="Portfolios"
        program={{ id: 'program', name }}
      />,
    );
    expect(screen.getByRole('link', { name: 'Portfolios' })).toHaveAttribute(
      'href',
      '/orgs/org/programs',
    );
    expect(screen.getByRole('link', { name })).toHaveAttribute(
      'href',
      '/orgs/org/programs/program',
    );
    expect(screen.queryByText('Projects')).not.toBeInTheDocument();
  });
});
