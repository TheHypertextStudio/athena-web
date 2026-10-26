import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { ProjectBreadcrumb } from '@/components/project-detail/project-breadcrumb';

vi.mock('@/components/docket-link', () => ({
  default: (props: ComponentProps<'a'>) => <a {...props} />,
}));

describe('ProjectBreadcrumb', () => {
  it('returns to the workspace project collection when there is no resolved program', () => {
    render(<ProjectBreadcrumb orgId="org" projectLabel="Projects" />);
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Projects' })).toHaveAttribute(
      'href',
      '/orgs/org/projects',
    );
  });

  it('keeps the collection route while honoring workspace vocabulary', () => {
    render(<ProjectBreadcrumb orgId="org" projectLabel="Campaigns" />);
    expect(screen.getByRole('link', { name: 'Campaigns' })).toHaveAttribute(
      'href',
      '/orgs/org/projects',
    );
  });
});
